//! Persistent identity store for the fill-worker.
//!
//! The worker's "identity" is the `solver_id` + private key it uses to
//! authenticate with the aggregator. We persist it to a JSON file so that:
//!
//! - The worker can survive restarts without losing identity.
//! - The dashboard can push a fresh identity via `PUT /identity` and the
//!   worker swaps its signer at runtime.
//!
//! The store holds the active signer behind an `RwLock` so reads are cheap
//! and the order loop can grab the current signer on every iteration without
//! blocking on writes.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::RwLock;
use tracing::{info, warn};

use crate::signer::{LocalSigner, OrderSigner, SigningError};

#[derive(Debug, Error)]
pub enum IdentityStoreError {
	#[error("io error: {0}")]
	Io(#[from] std::io::Error),
	#[error("json error: {0}")]
	Json(#[from] serde_json::Error),
	#[error("signing error: {0}")]
	Signing(#[from] SigningError),
	#[error("identity not loaded")]
	NotLoaded,
}

/// On-disk identity file format. Kept intentionally tiny — just enough to
/// reconstruct the signer + know which operator this worker represents.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistedIdentity {
	pub solver_id: String,
	/// EVM private key in 0x-prefixed hex. Sensitive — anyone with this
	/// key can sign fills as this operator. The file should be chmod 0600
	/// on disk.
	pub private_key: String,
	/// Wallet address derived from `private_key`. Cached here so the
	/// dashboard can display it without re-deriving on every request.
	pub wallet_address: String,
	/// Unix timestamp (seconds) of when the identity was set. Helps with
	/// debugging and audit trails.
	#[serde(default)]
	pub set_at: u64,
}

/// Status snapshot returned by `IdentityStore::status()`. Safe to send
/// over HTTP — never includes the private key.
#[derive(Debug, Clone, Serialize)]
pub struct IdentityStatus {
	pub loaded: bool,
	pub solver_id: Option<String>,
	pub wallet_address: Option<String>,
	pub set_at: Option<u64>,
	pub last_register_error: Option<String>,
}

/// In-memory + on-disk store for the worker's signing identity.
pub struct IdentityStore {
	file_path: PathBuf,
	inner: RwLock<Option<PersistedIdentity>>,
	signer: RwLock<Option<Arc<dyn OrderSigner>>>,
	/// Latest aggregator-registration error, surfaced to the dashboard via
	/// `IdentityStatus`. Cleared on the next successful registration.
	last_register_error: RwLock<Option<String>>,
}

impl IdentityStore {
	/// Open the store, loading any existing identity from `file_path`.
	/// If the file doesn't exist, the store starts empty (no identity).
	pub async fn open(file_path: impl Into<PathBuf>) -> Result<Arc<Self>, IdentityStoreError> {
		let file_path = file_path.into();
		let inner = if file_path.exists() {
			match Self::load_from_disk(&file_path).await {
				Ok(id) => {
					info!(
						solver_id = %id.solver_id,
						wallet = %id.wallet_address,
						"loaded persisted identity from disk"
					);
					Some(id)
				}
				Err(e) => {
					warn!(
						path = %file_path.display(),
						error = %e,
						"failed to load persisted identity, starting fresh"
					);
					None
				}
			}
		} else {
			None
		};

		let signer = match &inner {
			Some(id) => match LocalSigner::new(&id.private_key) {
				Ok(s) => Some(s.into_arc() as Arc<dyn OrderSigner>),
				Err(e) => {
					warn!(error = %e, "persisted identity has invalid private key; starting with no signer");
					None
				}
			},
			None => None,
		};

		Ok(Arc::new(Self {
			file_path,
			inner: RwLock::new(inner),
			signer: RwLock::new(signer),
			last_register_error: RwLock::new(None),
		}))
	}

	async fn load_from_disk(path: &Path) -> Result<PersistedIdentity, IdentityStoreError> {
		let bytes = tokio::fs::read(path).await?;
		let id: PersistedIdentity = serde_json::from_slice(&bytes)?;
		Ok(id)
	}

	/// Set the worker's identity. Persists to disk atomically (write to
	/// `<path>.tmp` then rename) and swaps the in-memory signer.
	///
	/// Returns the new `IdentityStatus` so callers can confirm what changed.
	pub async fn set_identity(
		self: &Arc<Self>,
		solver_id: String,
		private_key: String,
	) -> Result<IdentityStatus, IdentityStoreError> {
		if solver_id.is_empty() {
			return Err(IdentityStoreError::Signing(SigningError::InvalidKey(
				"solver_id cannot be empty".into(),
			)));
		}
		if private_key.is_empty() {
			return Err(IdentityStoreError::Signing(SigningError::InvalidKey(
				"private_key cannot be empty".into(),
			)));
		}

		// Build a fresh signer to validate the key before persisting.
		let new_signer = LocalSigner::new(&private_key)?;
		let wallet_address = format!("{:#x}", new_signer.address());
		let persisted = PersistedIdentity {
			solver_id: solver_id.clone(),
			private_key,
			wallet_address: wallet_address.clone(),
			set_at: std::time::SystemTime::now()
				.duration_since(std::time::UNIX_EPOCH)
				.map(|d| d.as_secs())
				.unwrap_or(0),
		};

		// Atomic write: write to .tmp then rename. Avoids a half-written
		// file if the process is killed mid-write.
		//
		// Ensure the parent directory exists before writing. Render's
		// `pserv` containers start with an empty filesystem — the
		// configured `FILL_WORKER_DATA_DIR` (default `/var/lib/fill-worker`)
		// won't exist on first boot. Without this `mkdir -p`, the first
		// `set_identity` call fails with `ENOENT`.
		if let Some(parent) = self.file_path.parent() {
			if !parent.as_os_str().is_empty() {
				tokio::fs::create_dir_all(parent).await?;
			}
		}
		let tmp = self.file_path.with_extension("json.tmp");
		tokio::fs::write(&tmp, serde_json::to_vec_pretty(&persisted)?).await?;
		tokio::fs::rename(&tmp, &self.file_path).await?;

		// Best-effort: tighten permissions. On Linux this is a chmod call,
		// which only succeeds when running as the file owner. Render's
		// container is single-user, so this is essentially always fine.
		#[cfg(unix)]
		{
			use std::os::unix::fs::PermissionsExt;
			let perms = std::fs::Permissions::from_mode(0o600);
			let _ = std::fs::set_permissions(&self.file_path, perms);
		}

		{
			let mut inner = self.inner.write().await;
			*inner = Some(persisted);
		}
		{
			let mut signer = self.signer.write().await;
			*signer = Some(new_signer.into_arc());
		}
		{
			let mut err = self.last_register_error.write().await;
			*err = None;
		}

		info!(
			solver_id = %solver_id,
			wallet = %wallet_address,
			"identity installed and persisted"
		);
		Ok(self.status().await)
	}

	/// Drop the identity and persist an empty store. The worker reverts
	/// to "no signer" mode — it stays running and accepts new `PUT /identity`
	/// calls.
	pub async fn clear_identity(self: &Arc<Self>) -> Result<(), IdentityStoreError> {
		{
			let mut inner = self.inner.write().await;
			*inner = None;
		}
		{
			let mut signer = self.signer.write().await;
			*signer = None;
		}
		if self.file_path.exists() {
			tokio::fs::remove_file(&self.file_path).await?;
		}
		Ok(())
	}

	/// Cheap clone of the current signer, if any. Returns `None` until
	/// identity is set.
	pub async fn current_signer(&self) -> Option<Arc<dyn OrderSigner>> {
		self.signer.read().await.clone()
	}

	pub async fn solver_id(&self) -> Option<String> {
		self.inner.read().await.as_ref().map(|i| i.solver_id.clone())
	}

	pub async fn wallet_address(&self) -> Option<String> {
		self.inner.read().await.as_ref().map(|i| i.wallet_address.clone())
	}

	pub async fn status(&self) -> IdentityStatus {
		let inner = self.inner.read().await;
		let err = self.last_register_error.read().await.clone();
		IdentityStatus {
			loaded: inner.is_some(),
			solver_id: inner.as_ref().map(|i| i.solver_id.clone()),
			wallet_address: inner.as_ref().map(|i| i.wallet_address.clone()),
			set_at: inner.as_ref().map(|i| i.set_at),
			last_register_error: err,
		}
	}

	pub async fn record_register_error(&self, msg: String) {
		*self.last_register_error.write().await = Some(msg);
	}
}
