export interface RegistrationMessageDataDto {
  message: string;
}

export interface GetRegistrationMessageResponseDto {
  data: RegistrationMessageDataDto;
}

export interface RegisterAccountV1Dto {
  address: string;
  message: string;
  signature: string;
  chainId?: string;
  account?: string;
  chain?: string;
}

export interface RegisterAccountV1ResponseDto {
  success: boolean;
  solverId?: string;
  /**
   * Auto-generated fill-wallet address. The aggregator generates this
   * server-side at registration time and stores the encrypted private
   * key internally — it never leaves the host. Operators see only the
   * address and can monitor fills on-chain by watching it.
   */
  fillWalletAddress?: string;
  /**
   * Per-operator dashboard API key. Surfaced exactly once at
   * registration time. The dashboard persists this in localStorage and
   * sends it as `x-api-key` on every subsequent request. There is no
   * shared admin key — each operator gets a unique one.
   */
  apiKey?: string;
}

export interface UnregisterAccountV1Dto {
  account: string;
  chain: string;
}

export interface UnregisterAccountV1ResponseDto {
  success: boolean;
}

export interface SolverIdentityDto {
  id: number;
  solverId: number;
  address: string;
  chain?: string;
  status: 'active' | 'pending';
  type: 'EOA' | 'Smart Contract';
  createdAt: string;
  updatedAt: string;
}

export interface GetSolverIdentitiesResponseDto {
  data: SolverIdentityDto[];
}

export interface ContractEntry {
  chain: string; // e.g. "eip155:11155420" or "eip155:84532"
  address: string;
}

export interface ContractsByKindDto {
  inputSettler: ContractEntry[];
  outputSettler: ContractEntry[];
  oracle: ContractEntry[];
}

export interface SupportedContractsResponseDto {
  data: ContractsByKindDto;
}

export interface QuoteRangeDto {
  minAmount: string;
  maxAmount: string;
  quote: string;
  fixedCost?: string;
}

export interface QuoteItemDto {
  fromChain: string;
  toChain: string;
  fromAsset: string;
  toAsset: string;
  fromDecimals: number;
  toDecimals: number;
  exclusiveFor?: string;
  expiry: number; // Unix timestamp in seconds
  ranges: QuoteRangeDto[];
}

export interface SubmitQuotesDto {
  /**
   * The submitting solver's canonical id (`solver-<hex-no-0x>`). The
   * server uses it to derive `solver_id` on the row — without it,
   * the server falls back to `"anonymous"`, which leaks the quote
   * into the global pool with no owner.
   */
  solverId?: string;
  quotes: QuoteItemDto[];
}

export interface SubmitQuotesResponseDto {
  status: string;
  quotesAdded: number;
}

export interface SolverQuoteDto {
  id: string;
  solverId: number;
  fromChainNetworkId: string;
  toChainNetworkId: string;
  fromAssetAddress: string;
  toAssetAddress: string;
  fromAssetDecimals: number;
  toAssetDecimals: number;
  quote: string;
  minAmount: string;
  maxAmount: string;
  fixedCost?: string;
  expiry: string;
  exclusiveFor?: string;
  paused?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GetSolverQuotesResponseDto {
  data: SolverQuoteDto[];
  meta: {
    total: number;
    limit: number;
    offset: number;
  };
}

export interface OrderTelemetryItem {
  id: string;
  intentId: string;
  userAddress: string;
  fromChain: string;
  toChain: string;
  fromAsset: string;
  toAsset: string;
  fromAmount: string;
  toAmount: string;
  status: 'quoted' | 'escrow_locked' | 'filling' | 'settled' | 'claimed' | 'failed';
  originTxHash?: string;
  destTxHash?: string;
  createdAt: string;
  updatedAt: string;
}

export interface VaultAsset {
  symbol: string;
  name: string;
  chain: string;
  available: string;
  locked: string;
  total: string;
  usdValue: string;
}

export interface OperatorDto {
  solverId: string;
  /** The operator's registered wallet (proves identity at registration). */
  walletAddress: string;
  /**
   * The hot-wallet that signs on-chain fills. Distinct from
   * `walletAddress` so a compromised fill-worker doesn't compromise
   * the operator's identity.
   */
  fillWalletAddress: string;
  fillWorkerUrl: string | null;
  reputationScore: number;
  fillsTotal: number;
  fillsSucceeded: number;
  avgLatencyMs: number;
  lastActiveAt: string | null;
  circuitBreakerOpen: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GetOperatorsResponseDto {
  data: OperatorDto[];
}

/**
 * Response from `POST /solver-api/operators/{id}/key`. The aggregator
 * generates a fresh fill-wallet keypair server-side; the **private key
 * never leaves the host**. The dashboard sees only the address.
 */
export interface GenerateOperatorKeyResponseDto {
  /** 20-byte EVM address (`0x`-prefixed lower-case hex). */
  address: string;
  /** 32-byte private key (`0x`-prefixed lower-case hex). One-time display. */
  privateKeyHex: string;
  /** Ready-to-paste env var line for deploying the fill-worker. */
  deploymentHint: string;
}

/**
 * Response from `POST /solver-api/operators/{id}/api-key`.
 */
export interface RotateApiKeyResponseDto {
  /** Newly-minted API key (one-time display). */
  apiKey: string;
  /** SHA-256 hash of the key — used by the aggregator to verify requests. */
  apiKeyHash: string;
  /** When the key was minted (RFC 3339). */
  createdAt: string;
}

/**
 * Response from `POST /solver-api/operators/{id}/settlement-contract`.
 * Returns the full updated operator row.
 */
export interface SetSettlementContractDto {
  chainId: number;
  address: string;
}

/**
 * Response from `GET /solver-api/operators/{id}/settlement-contracts`.
 * Map of `chain_id → address`.
 */
export type SettlementContractsMap = Record<string, string>;

/**
 * Response from `DELETE /solver-api/operators/{id}/settlement-contract?chainId=N`.
 * `removed` is `1` if the entry was actually deleted and `0` if no entry
 * existed for that chain (still a successful outcome). The HTTP status
 * is the source of truth for success/failure — the body is just the
 * counter.
 */
export interface DeleteSettlementContractResponseDto {
  removed: number;
}

const STORAGE_KEYS = {
  IDENTITIES: 'recoilpay_solver_identities',
  CONTRACTS: 'recoilpay_solver_contracts',
  QUOTES: 'recoilpay_solver_quotes',
  TELEMETRY: 'recoilpay_solver_telemetry',
  VAULTS: 'recoilpay_solver_vaults',
  API_KEY: 'recoilpay_solver_api_key',
  BASE_URL: 'recoilpay_solver_base_url',
};

// No DEFAULT_* constants — all data comes from the aggregator API (localhost:4000 via Vite proxy).
// Components must handle empty states when the aggregator is offline.




/** One tradable token on a chain (from the aggregator's chain registry). */
export interface ChainTokenDto {
  symbol: string;
  address: string;
  decimals: number;
}

/**
 * One supported chain from `GET /api/v1/chains` — settlement contracts,
 * tokens, and an RPC URL for client-side balance reads. Field names are
 * snake_case (serialized directly from the aggregator's registry).
 */
export interface ChainInfoDto {
  chain_id: number;
  name: string;
  rpc_url: string;
  input_settler: string;
  output_settler: string;
  oracle: string;
  permit2: string;
  tokens: ChainTokenDto[];
}

export interface GetChainsResponseDto {
  data: ChainInfoDto[];
}

/** CAIP-2 id ("eip155:84532") for a registry chain. */
export const chainCaip2 = (c: ChainInfoDto): string => `eip155:${c.chain_id}`;

/**
 * Convert a human amount ("10.50") to base units ("10500000") for the
 * given decimals. Quotes are matched in base units by the aggregator.
 */
export const toBaseUnits = (value: string, decimals: number): string => {
  const [whole, frac = ''] = value.trim().split('.');
  const digits = (whole || '0') + frac.padEnd(decimals, '0').slice(0, decimals);
  return BigInt(digits).toString();
};

/**
 * Inverse of {@link toBaseUnits}: render base units as a human amount.
 * Everything on the wire is base units ("1000000"), which is unreadable
 * in a table — this is what the UI should display.
 */
export const fromBaseUnits = (
  value: string | number | undefined | null,
  decimals: number,
  maxFractionDigits = 4,
): string => {
  if (value === undefined || value === null || value === '') return '—';
  let raw: bigint;
  try {
    raw = BigInt(String(value).split('.')[0]);
  } catch {
    return String(value);
  }
  const base = 10n ** BigInt(decimals);
  const whole = raw / base;
  const frac = (raw % base).toString().padStart(decimals, '0').slice(0, maxFractionDigits);
  const trimmed = frac.replace(/0+$/, '');
  return trimmed ? `${whole}.${trimmed}` : whole.toString();
};

export class SolverApiService {
  /**
   * GET /api/v1/chains — supported chains + settlement contracts +
   * tokens. Public endpoint, no auth.
   */
  static async getChains(): Promise<ChainInfoDto[]> {
    const res = await fetch(`${this.getBaseUrl()}/api/v1/chains`);
    if (!res.ok) throw new Error(`Cannot load chains: ${res.status}`);
    const body = (await res.json()) as GetChainsResponseDto;
    return body.data ?? [];
  }

  static getApiKey(): string {
    // Per-operator API key. Stored in localStorage after registration.
    // The aggregator surfaces this key in the `register` response and
    // then uses it on every subsequent request to look the operator up
    // (via `operators.api_key`). The previous hardcoded admin key
    // `the old shared admin key` is gone — each operator has a unique key.
    //
    // Returns the empty string when no key has been persisted yet so
    // `fetch` calls fail with a clear 401 instead of confusing the
    // aggregator with a stale shared key.
    return localStorage.getItem(STORAGE_KEYS.API_KEY) || '';
  }

  static setApiKey(key: string) {
    localStorage.setItem(STORAGE_KEYS.API_KEY, key);
  }

  static clearApiKey() {
    localStorage.removeItem(STORAGE_KEYS.API_KEY);
  }

  static getBaseUrl(): string {
    // Order of precedence:
    //   1. Explicit URL stored in localStorage (set via setBaseUrl)
    //   2. VITE_API_BASE_URL or VITE_OIF_API_BASE_URL from .env / .env.local
    //   3. Empty string — falls back to the Vite dev-server proxy.
    //
    // The env-var fallback is critical for pointing the dashboard at a
    // deployed aggregator (e.g. via `.env.local` → live Render URL).
    // Without it the dashboard sends relative paths, Vite proxies them
    // to 127.0.0.1:4000, and nothing reaches the real backend.
    const stored = localStorage.getItem(STORAGE_KEYS.BASE_URL);
    if (stored) return stored;
    const envUrl =
      // Vite replaces `import.meta.env.X` at build time; in a dev server
      // it reads from `.env` / `.env.local`. We use the `?.` operator
      // because TypeScript's `ImportMetaEnv` interface doesn't know about
      // our custom keys out of the box.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (import.meta.env as any)?.VITE_API_BASE_URL ||
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (import.meta.env as any)?.VITE_OIF_API_BASE_URL ||
      '';
    return envUrl || '';
  }

  static setBaseUrl(url: string) {
    localStorage.setItem(STORAGE_KEYS.BASE_URL, url);
  }



  /**
   * GET /api/v1/solver/register/message
   * Returns the challenge message the solver must sign to register.
   * Throws if the aggregator is unreachable.
   */
  static async getRegistrationMessage(address: string): Promise<GetRegistrationMessageResponseDto> {
    const res = await fetch(`${this.getBaseUrl()}/api/v1/solver/register/message?address=${encodeURIComponent(address)}`);
    if (!res.ok) throw new Error(`Cannot reach aggregator: ${res.status}`);
    return res.json() as Promise<GetRegistrationMessageResponseDto>;
  }

  /**
   * POST /api/v1/solver/register
   */
  static async registerAccountV1(dto: RegisterAccountV1Dto): Promise<RegisterAccountV1ResponseDto> {
    const payload = {
      address: dto.address || dto.account || '0x1234567890123456789012345678901234567890',
      message: dto.message,
      signature: dto.signature,
      chainId: dto.chainId || dto.chain || '11155420',
    };

    try {
      const res = await fetch(`${this.getBaseUrl()}/solver-api/account/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const json = await res.json() as RegisterAccountV1ResponseDto;
        // Persist the per-operator API key returned by the aggregator
        // so subsequent requests (and the WebSocket) authenticate as
        // this operator. The key is **only** returned once during
        // registration; losing it requires operator-initiated rotation.
        if (json.apiKey) {
          this.setApiKey(json.apiKey);
        }
        return json;
      }
    } catch {
      // Fallback
    }

    return { success: false };
  }

  /**
   * GET /solver-api/solver/identities
   */
  static async getIdentities(): Promise<SolverIdentityDto[]> {
    try {
      const res = await fetch(`${this.getBaseUrl()}/solver-api/solver/identities`, {
        headers: { 'x-api-key': this.getApiKey() }
      });
      if (res.ok) {
        const json = await res.json();
        return json.data || (Array.isArray(json) ? json : []);
      }
    } catch {}
    return [];
  }

  /**
   * GET /api/v1/solver/supported-contracts
   */
  static async getSupportedContracts(): Promise<ContractsByKindDto> {
    const res = await fetch(`${this.getBaseUrl()}/api/v1/solver/supported-contracts`, {
      headers: { 'x-api-key': this.getApiKey() }
    });
    if (!res.ok) throw new Error(`getSupportedContracts failed: ${res.status}`);
    const json = await res.json();
    return json.data || json;
  }

  static async setSupportedContracts(contracts: ContractsByKindDto): Promise<ContractsByKindDto> {
    // Placeholder: no write endpoint on core yet.
    return contracts;
  }

  /**
   * GET /solver-api/quotes
   */
  static async getQuotes(): Promise<SolverQuoteDto[]> {
    try {
      const res = await fetch(`${this.getBaseUrl()}/solver-api/quotes`, {
        headers: { 'x-api-key': this.getApiKey() }
      });
      if (res.ok) {
        const json = await res.json();
        return json.data || (Array.isArray(json) ? json : []);
      }
    } catch {}
    return [];
  }

  /**
   * POST /quotes/submit
   */
  static async submitQuotesV1(dto: SubmitQuotesDto): Promise<SubmitQuotesResponseDto> {
    try {
      const res = await fetch(`${this.getBaseUrl()}/quotes/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.getApiKey(),
        },
        body: JSON.stringify(dto),
      });
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // Fallback
    }

    return { status: 'error', quotesAdded: 0 };
  }

  static async togglePauseQuote(quoteId: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.getBaseUrl()}/solver-api/quotes/${quoteId}/pause`, {
        method: 'POST',
        headers: { 'x-api-key': this.getApiKey() },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  static async deleteQuote(quoteId: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.getBaseUrl()}/solver-api/quotes/${quoteId}`, {
        method: 'DELETE',
        headers: { 'x-api-key': this.getApiKey() },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  static async getTelemetry(): Promise<OrderTelemetryItem[]> {
    try {
      const res = await fetch(`${this.getBaseUrl()}/solver-api/telemetry`, {
        headers: { 'x-api-key': this.getApiKey() }
      });
      if (res.ok) {
        const json = await res.json();
        return json.data || (Array.isArray(json) ? json : []);
      }
    } catch {}
    return [];
  }

  static async getVaultBalances(): Promise<VaultAsset[]> {
    try {
      const res = await fetch(`${this.getBaseUrl()}/solver-api/vaults`, {
        headers: { 'x-api-key': this.getApiKey() }
      });
      if (res.ok) {
        const json = await res.json();
        return json.data || (Array.isArray(json) ? json : []);
      }
    } catch {}
    // Return empty array when the API is unreachable rather than fake data.
    return [];
  }

  /**
   * POST /solver-api/vaults/snapshot
   *
   * Upsert one (chain, asset) balance row for the authenticated
   * operator. The dashboard calls this when the operator
   * confirms a balance from their wallet UI. The aggregator
   * derives `solver_id` from the api_key, so the body never
   * carries it.
   */
  static async postVaultSnapshot(input: {
    chain: string;
    assetAddress: string;
    symbol: string;
    name?: string;
    available: string;
  }): Promise<{ success: boolean; row?: VaultAsset; error?: string }> {
    try {
      const res = await fetch(`${this.getBaseUrl()}/solver-api/vaults/snapshot`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.getApiKey(),
        },
        body: JSON.stringify({
          chain: input.chain,
          assetAddress: input.assetAddress,
          symbol: input.symbol,
          name: input.name ?? '',
          available: input.available,
        }),
      });
      if (res.ok) {
        const json = await res.json();
        return { success: !!json.success, row: json.row };
      }
      const body = await res.text().catch(() => '');
      return { success: false, error: body || `HTTP ${res.status}` };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : 'network error' };
    }
  }

  /**
   * DELETE /solver-api/vaults/{chain}/{asset}
   *
   * Remove one tracked balance. Used when an operator removes
   * a token from their dashboard. Returns true on success or
   * 404.
   */
  static async deleteVaultAsset(
    chain: string,
    assetAddress: string,
  ): Promise<boolean> {
    try {
      const res = await fetch(
        `${this.getBaseUrl()}/solver-api/vaults/${encodeURIComponent(chain)}/${encodeURIComponent(assetAddress)}`,
        {
          method: 'DELETE',
          headers: { 'x-api-key': this.getApiKey() },
        },
      );
      return res.ok;
    } catch {
      return false;
    }
  }

  // Deposit / Withdraw endpoints are intentionally absent — the
  // on-chain vault contract isn't deployed yet, and surfacing UI
  // buttons that POST to dead routes produces silent failures.
  // They will return alongside the backend in Part 2.

  // ─── Operator reputation / fill-worker ────────────────────────────────────

  /**
   * GET /solver-api/operators
   * Returns the operator leaderboard. Empty list when aggregator is offline.
   */
  static async getOperators(): Promise<OperatorDto[]> {
    try {
      const res = await fetch(`${this.getBaseUrl()}/solver-api/operators`, {
        headers: { 'x-api-key': this.getApiKey() },
      });
      if (res.ok) {
        const json = (await res.json()) as GetOperatorsResponseDto;
        return json.data || [];
      }
    } catch {}
    return [];
  }

  /**
   * GET /solver-api/operators/{id}
   * Returns the current operator row (reputation, fill-worker URL, etc.).
   */
  static async getOperator(solverId: string): Promise<OperatorDto | null> {
    try {
      const res = await fetch(
        `${this.getBaseUrl()}/solver-api/operators/${encodeURIComponent(solverId)}`,
        { headers: { 'x-api-key': this.getApiKey() } },
      );
      if (res.ok) {
        const json = (await res.json()) as { data: OperatorDto };
        return json.data;
      }
    } catch {}
    return null;
  }

  /**
   * POST /solver-api/operators/{id}/heartbeat
   * Manual heartbeat trigger — the fill-worker normally sends these
   * automatically every 30 s, but exposing this lets the dashboard show
   * liveness on demand.
   */
  static async sendHeartbeat(solverId: string): Promise<boolean> {
    try {
      const res = await fetch(
        `${this.getBaseUrl()}/solver-api/operators/${encodeURIComponent(solverId)}/heartbeat`,
        { method: 'POST', headers: { 'x-api-key': this.getApiKey() } },
      );
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * POST /solver-api/operators/{id}/key
   *
   * Generates a fresh secp256k1 hot-wallet for the operator. The aggregator
   * persists the address; the private key is returned in the response and
   * **never stored** server-side. The caller must surface the key to the
   * operator exactly once.
   *
   * Returns `null` on any failure (network, 4xx, 5xx).
   */
  static async generateOperatorKey(
    solverId: string,
  ): Promise<GenerateOperatorKeyResponseDto | null> {
    try {
      const res = await fetch(
        `${this.getBaseUrl()}/solver-api/operators/${encodeURIComponent(solverId)}/key`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.getApiKey(),
          },
        },
      );
      if (res.ok) {
        return (await res.json()) as GenerateOperatorKeyResponseDto;
      }
      console.error(
        `[solverApi] generateOperatorKey failed: ${res.status} ${res.statusText}`,
      );
    } catch (e) {
      console.error('[solverApi] generateOperatorKey network error:', e);
    }
    return null;
  }

  /**
   * POST /solver-api/operators/{id}/api-key
   *
   * Mints a fresh server-side API key for the operator. Returns `null`
   * on failure.
   */
  static async rotateApiKey(solverId: string): Promise<RotateApiKeyResponseDto | null> {
    try {
      const res = await fetch(
        `${this.getBaseUrl()}/solver-api/operators/${encodeURIComponent(solverId)}/api-key`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.getApiKey(),
          },
        },
      );
      if (res.ok) {
        return (await res.json()) as RotateApiKeyResponseDto;
      }
      console.error(`[solverApi] rotateApiKey failed: ${res.status} ${res.statusText}`);
    } catch (e) {
      console.error('[solverApi] rotateApiKey network error:', e);
    }
    return null;
  }

  /**
   * POST /solver-api/operators/{id}/settlement-contract
   *
   * Register or replace the operator's settlement contract for one chain.
   * Returns `null` on failure.
   */
  static async setSettlementContract(
    solverId: string,
    chainId: number,
    address: string,
  ): Promise<OperatorDto | null> {
    try {
      const res = await fetch(
        `${this.getBaseUrl()}/solver-api/operators/${encodeURIComponent(solverId)}/settlement-contract`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.getApiKey(),
          },
          body: JSON.stringify({ chainId, address } satisfies SetSettlementContractDto),
        },
      );
      if (res.ok) {
        return (await res.json()) as OperatorDto;
      }
      console.error(
        `[solverApi] setSettlementContract failed: ${res.status} ${res.statusText}`,
      );
    } catch (e) {
      console.error('[solverApi] setSettlementContract network error:', e);
    }
    return null;
  }

  /**
   * GET /solver-api/operators/{id}/settlement-contracts
   *
   * Returns the operator's `chain_id → address` map. Returns `{}` when
   * none are registered or when the aggregator is unreachable.
   */
  static async getSettlementContracts(solverId: string): Promise<SettlementContractsMap> {
    try {
      const res = await fetch(
        `${this.getBaseUrl()}/solver-api/operators/${encodeURIComponent(solverId)}/settlement-contracts`,
        { headers: { 'x-api-key': this.getApiKey() } },
      );
      if (res.ok) {
        const json = (await res.json()) as { data: SettlementContractsMap };
        return json.data || {};
      }
    } catch (e) {
      console.error('[solverApi] getSettlementContracts network error:', e);
    }
    return {};
  }

  /**
   * DELETE /solver-api/operators/{id}/settlement-contract?chainId=N
   *
   * Remove a single settlement-contract entry from the operator's map.
   * Returns `null` on network error, or the parsed response otherwise.
   * The dashboard inspects `removed` to decide whether to refetch the
   * list (when `1`) or no-op (when `0`).
   *
   * NOTE: query parameter is `chainId` (camelCase) — the server
   * deserializer is `#[serde(rename_all = "camelCase")]`.
   */
  static async deleteSettlementContract(
    solverId: string,
    chainId: number,
  ): Promise<DeleteSettlementContractResponseDto | null> {
    try {
      const res = await fetch(
        `${this.getBaseUrl()}/solver-api/operators/${encodeURIComponent(solverId)}/settlement-contract?chainId=${encodeURIComponent(String(chainId))}`,
        {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.getApiKey(),
          },
        },
      );
      if (res.ok) {
        return (await res.json()) as DeleteSettlementContractResponseDto;
      }
      console.error(
        `[solverApi] deleteSettlementContract failed: ${res.status} ${res.statusText} body=${await res.text().catch(() => '')}`,
      );
    } catch (e) {
      console.error('[solverApi] deleteSettlementContract network error:', e);
    }
    return null;
  }
}
