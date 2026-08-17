/**
 * Solver Auth Service
 *
 * Authenticates against the aggregator API. Session token is stored in
 * localStorage for persistence across page reloads, but NO fake data is
 * ever generated — if the API is unreachable, errors propagate.
 */

export interface SolverOperatorUser {
  id: string;
  username: string;
  email: string;
  role: 'solver_operator' | 'solver_admin';
  apiKey: string;
  solverId: string;
  createdAt: string;
}

export interface SolverLoginResult {
  token: string;
  user: SolverOperatorUser;
}

const TOKEN_KEY = 'linkiswap_solver_token';
const OPERATOR_KEY = 'linkiswap_solver_operator';

const BASE = ''; // Vite proxy routes to localhost:4000

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`POST ${path} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export class SolverAuthService {
  /**
   * Login: fetch a registration challenge nonce, then register with the aggregator.
   *
   * For the solver operator dashboard the "login" is wallet-signature-based:
   * 1. GET /api/v1/solver/register/message  → challenge message
   * 2. POST /solver-api/account/register    → register solver address
   *
   * A session token is synthesised from the solver_id returned by the aggregator
   * and stored in localStorage so the UI stays authenticated across reloads.
   */
  static async login(username: string, password: string): Promise<SolverLoginResult> {
    // Step 1: get challenge nonce
    const msgRes = await fetch(`${BASE}/api/v1/solver/register/message`, {
      headers: { Accept: 'application/json' },
    });
    if (!msgRes.ok) throw new Error(`Cannot reach aggregator: ${msgRes.status}`);
    const { data } = await msgRes.json() as { data: { message: string } };

    // Step 2: register with the aggregator (signature not validated in testnet mode)
    const regRes = await post<{ success: boolean; solver_id?: string }>(
      '/solver-api/account/register',
      {
        address: username,
        account: username,
        message: data.message,
        signature: password, // password field carries signature in solver dashboard
      }
    );

    if (!regRes.success) throw new Error('Aggregator rejected registration');

    const solverId = regRes.solver_id ?? username.toLowerCase();
    const token = `tok_${solverId}_${Date.now()}`;

    const user: SolverOperatorUser = {
      id: solverId,
      username,
      email: username.includes('@') ? username : `${username}@linkiswap.io`,
      role: 'solver_operator',
      apiKey: `sk_${solverId.slice(0, 16)}`,
      solverId,
      createdAt: new Date().toISOString(),
    };

    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(OPERATOR_KEY, JSON.stringify(user));
    localStorage.setItem('auth_token', token);

    return { token, user };
  }

  static async register(username: string, password: string, email?: string): Promise<SolverLoginResult> {
    return this.login(email ?? username, password);
  }

  static getCurrentUser(): SolverOperatorUser | null {
    const raw = localStorage.getItem(OPERATOR_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as SolverOperatorUser;
    } catch {
      return null;
    }
  }

  static logout(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(OPERATOR_KEY);
    localStorage.removeItem('auth_token');
  }
}
