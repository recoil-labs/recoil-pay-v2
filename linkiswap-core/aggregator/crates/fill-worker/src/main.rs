//! Fill-worker entry point.
//!
//! Boots the operator-side service that fills orders placed against quotes
//! the operator published via the dashboard.
//!
//! ## Multi-tenant identity model
//!
//! This worker is **multi-tenant**: it serves all operators on the
//! platform, dispatched by quote. The aggregator holds each operator's
//! fill-wallet private key in encrypted form (see `FILL_WALLET_ENCRYPTION_KEY`
//! in the aggregator's env) and signs fills on behalf of whichever
//! operator owns the winning quote. The worker itself never holds
//! per-operator keys.
//!
//! ## Lifecycle
//!
//! 1. Worker boots, reads `AGGREGATOR_URL` + `CHAIN_RPCS` from env.
//! 2. Worker connects to the aggregator over the signed WebSocket
//!    (`/ws/orders`) and waits for fillable orders.
//! 3. When an order arrives, the worker builds the unsigned EIP-1559
//!    transaction, calls
//!    `POST /solver-api/operators/{id}/sign-fill` on the aggregator to
//!    get the signature back, then broadcasts the signed envelope via
//!    the configured chain RPC.

use std::sync::Arc;

use fill_worker::{
	broadcaster::AggregatorBroadcaster,
	chain_rpc::ChainBroadcaster,
	http_api, Broadcaster, FillWorker, FillWorkerConfig, FillWorkerError,
	FillWorkerResult, IdentityStore,
};
use tracing::{info, warn};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
	// Tracing.
	let env_filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
	tracing_subscriber::fmt().with_env_filter(env_filter).init();

	// Config.
	let config = FillWorkerConfig::from_env()?;
	info!(
		aggregator = %config.aggregator_url,
		public_url = %config.public_url,
		chain_rpcs_configured = config.chain_rpcs.len(),
		"starting fill-worker (multi-tenant, signs fills via aggregator)"
	);

	// Open the identity store. If a previous run persisted an identity, we
	// pick it up here so a worker restart doesn't lose state.
	//
	// The data directory must be writable by the running user. Render's
	// production images run as `nonroot`, so we default to a path under
	// the user's home directory (`/home/nonroot/.fill-worker`). Operators
	// can override via `FILL_WORKER_DATA_DIR` if they want a different
	// location. We probe writability with a `touch`; if the configured
	// path isn't writable, we transparently fall back to `/tmp/fill-worker`
	// rather than crashlooping on a `Permission denied` write.
	let data_dir = std::env::var("FILL_WORKER_DATA_DIR")
		.unwrap_or_else(|_| "/home/nonroot/.fill-worker".to_string());
	let identity_path = std::path::PathBuf::from(&data_dir).join("identity.json");
	if !try_ensure_writable(&identity_path).await {
		warn!(
			configured = %data_dir,
			"FILL_WORKER_DATA_DIR is not writable; falling back to /tmp/fill-worker"
		);
		let fallback = std::path::PathBuf::from("/tmp/fill-worker").join("identity.json");
		try_ensure_writable(&fallback).await;
		let identity = IdentityStore::open(&fallback).await?;
		bootstrap_if_empty(&identity).await?;
		return run_worker(config, identity).await;
	}
	let identity = IdentityStore::open(&identity_path).await?;

	bootstrap_if_empty(&identity).await?;

	return run_worker(config, identity).await;
}

/// If no identity is on disk, mint a fresh secp256k1 keypair and persist
/// it. Used on first boot; subsequent restarts skip this because
/// `IdentityStore::open` loaded the persisted identity.
async fn bootstrap_if_empty(identity: &Arc<IdentityStore>) -> FillWorkerResult<()> {
	if identity.solver_id().await.is_some() {
		return Ok(());
	}
	let fresh = fill_worker::signer::LocalSigner::generate_random();
	let wallet = format!("{:#x}", <_ as fill_worker::OrderSigner>::address(&fresh));
	// Derive the worker's `solver_id` from the wallet address so it
	// matches the `x-solver-id` header that `sign_request` will
	// produce (lower-case hex with `solver-` prefix).
	let solver_id = format!("solver-{}", wallet.trim_start_matches("0x").to_lowercase());
	let pk_hex = fresh.private_key_hex();
	identity
		.set_identity(solver_id.clone(), pk_hex)
		.await
		.map_err(|e| FillWorkerError::Config(format!("bootstrap identity: {e}")))?;
	info!(
		solver_id = %solver_id,
		wallet = %wallet,
		"bootstrapped fresh worker identity and persisted to disk"
	);
	Ok(())
}

/// Verify that the configured identity-store path is writable. Returns
/// `true` if the parent directory already exists (or was successfully
/// created) **and** a probe write succeeded; `false` otherwise. The
/// worker uses this to fall back to `/tmp/fill-worker` if a misconfigured
/// `FILL_WORKER_DATA_DIR` points at a path the running user can't write
/// to (e.g. `/var/lib/fill-worker` under Render's `nonroot` user).
async fn try_ensure_writable(identity_path: &std::path::Path) -> bool {
	let Some(parent) = identity_path.parent() else {
		return false;
	};
	if parent.as_os_str().is_empty() {
		// Identity file is in the current working directory — almost
		// always writable, but only if `.` is writable. Skip the mkdir
		// step and trust the eventual write attempt to surface a real
		// error.
		return true;
	}
	if tokio::fs::create_dir_all(parent).await.is_err() {
		return false;
	}
	// Probe: write a tiny file then delete it. If this succeeds, the
	// subsequent real `set_identity` write will also succeed.
	let probe = parent.join(".write_probe");
	match tokio::fs::write(&probe, b"probe").await {
		Ok(()) => {
			let _ = tokio::fs::remove_file(&probe).await;
			true
		}
		Err(_) => false,
	}
}

/// Common tail of `main`: build the broadcaster, spawn the HTTP API
/// task, bridge identity changes to the broadcaster, then run the
/// orchestrator. Extracted so the writable-path fallback branch can
/// share the same wiring.
async fn run_worker(
	config: FillWorkerConfig,
	identity: Arc<IdentityStore>,
) -> Result<(), Box<dyn std::error::Error>> {
	// Build a chain broadcaster from CHAIN_RPCS.
	let chain_rpc = Arc::new(ChainBroadcaster::from_rpc_map(config.chain_rpcs.clone())?);

	// Aggregator HTTP broadcaster — operator_id + signer will be (re)bound
	// at runtime by the identity-watcher task below.
	let broadcaster_concrete = Arc::new(
		AggregatorBroadcaster::new(&config.aggregator_url)
			.with_chain_rpc(chain_rpc)
			.with_worker_token(config.worker_token.clone()),
	);
	// Coerce to the trait object so `FillWorker` can hold it generically.
	let broadcaster: Arc<dyn fill_worker::Broadcaster> = broadcaster_concrete.clone();

	// HTTP API: dashboard uses this to install/rotate identity.
	let api_addr = parse_bind_addr(&config.public_url);
	let api_store = identity.clone();
	let api_handle = tokio::spawn(async move {
		if let Err(e) = http_api::serve(api_store, api_addr).await {
			tracing::error!(error = %e, "fill-worker HTTP API exited with error");
		}
	});

	// Bridge: watch the identity store. When solver_id changes, re-bind
	// the broadcaster's operator_id + signer so subsequent aggregator calls
	// carry the right signature + path.
	//
	// First pass runs immediately so the orchestrator (which starts on
	// the line below) finds a signer already bound — otherwise its
	// initial `subscribe_orders` returns
	// `subscribe_orders requires a signer; call with_signer() before
	// running` and the worker burns CPU in a tight restart loop.
	let bridge_broadcaster: Arc<AggregatorBroadcaster> = broadcaster_concrete.clone();
	let bridge_identity = identity.clone();
	let bridge_public_url = config.public_url.clone();

	// Bind the initial identity synchronously so the orchestrator's
	// first `subscribe_orders` call doesn't race against the bridge
	// task's first 1-second-sleep tick.
	if let Some(initial_solver_id) = identity.solver_id().await {
		broadcaster_concrete.set_operator_id(initial_solver_id.clone());
		if let Some(signer) = identity.current_signer().await {
			broadcaster_concrete.set_signer(signer);
		}
		if let Err(e) = broadcaster_concrete
			.set_worker_url(&initial_solver_id, bridge_public_url.clone())
			.await
		{
			warn!(
				error = %e,
				"initial aggregator registration failed; will retry in bridge loop"
			);
			identity.record_register_error(e.to_string()).await;
		} else {
			identity.record_register_error(String::new()).await;
		}
	}

	tokio::spawn(async move {
		let mut last_solver_id: Option<String> = None;
		let mut first_tick = true;
		loop {
			if !first_tick {
				tokio::time::sleep(std::time::Duration::from_secs(1)).await;
			}
			first_tick = false;
			let current = bridge_identity.solver_id().await;
			if current != last_solver_id {
				if let Some(sid) = &current {
					info!(solver_id = %sid, "identity changed; re-binding broadcaster");
					bridge_broadcaster.set_operator_id(sid.clone());
					if let Some(signer) = bridge_identity.current_signer().await {
						bridge_broadcaster.set_signer(signer);
					}
					// Try registering the worker URL with the aggregator.
					if let Err(e) = bridge_broadcaster
						.set_worker_url(sid, bridge_public_url.clone())
						.await
					{
						warn!(
							error = %e,
							"aggregator re-register failed (likely operator not registered yet)"
						);
						bridge_identity
							.record_register_error(e.to_string())
							.await;
					} else {
						bridge_identity.record_register_error(String::new()).await;
					}
				}
				last_solver_id = current;
			}
		}
	});

    // Run the orchestrator.
    let worker = Arc::new(FillWorker::new(config, broadcaster, identity));
    worker.run().await?;

    api_handle.abort();
    Ok(())
}

/// Extract `host:port` from a URL like `http://linkiswap-fill-worker.render.internal:8080`.
/// Decide the address the worker's HTTP API listens on.
///
/// Always binds `0.0.0.0`. `FILL_WORKER_URL` describes how *others*
/// reach this worker, which is not necessarily an address it can bind —
/// deriving the bind address from it meant a public URL of
/// `http://127.0.0.1:8080` bound loopback only, and any platform health
/// checking from outside the container saw a dead service.
///
/// The port comes from `PORT` when the platform sets it (Cloud Run, and
/// most PaaS), otherwise from `FILL_WORKER_URL`, otherwise 8080.
fn parse_bind_addr(url: &str) -> std::net::SocketAddr {
	let port = std::env::var("PORT")
		.ok()
		.and_then(|p| p.parse::<u16>().ok())
		.or_else(|| {
			url.trim_start_matches("http://")
				.trim_start_matches("https://")
				.split('/')
				.next()
				.and_then(|hp| hp.rsplit(':').next())
				.and_then(|p| p.parse::<u16>().ok())
		})
		.unwrap_or(8080);
	std::net::SocketAddr::from(([0, 0, 0, 0], port))
}

#[cfg(test)]
mod bind_addr_tests {
	use super::parse_bind_addr;

	/// The regression: a loopback public URL must not produce a loopback
	/// bind, or the container is unreachable to its host platform.
	#[test]
	fn always_binds_all_interfaces() {
		for url in [
			"http://127.0.0.1:8080",
			"http://localhost:9000",
			"http://linkiswap-fill-worker.internal:8080",
			"",
		] {
			assert!(
				parse_bind_addr(url).ip().is_unspecified(),
				"{url} must bind 0.0.0.0"
			);
		}
	}

	#[test]
	fn takes_port_from_the_url_when_no_env_override() {
		// PORT is not set in this test process.
		assert_eq!(parse_bind_addr("http://anything:9001").port(), 9001);
		assert_eq!(parse_bind_addr("garbage").port(), 8080);
	}
}
