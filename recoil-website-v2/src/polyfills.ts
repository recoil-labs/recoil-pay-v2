/**
 * Browser polyfills for wallet libraries written for Node.
 *
 * The Solana wallet adapters (Ledger's hardware transport in particular)
 * use Node's global `Buffer`, which browsers don't have. Without this, the
 * app throws "Buffer is not defined" while loading and renders a blank page.
 *
 * Must stay the FIRST import in main.tsx: ES modules run in import order,
 * so this has to execute before any module that touches `Buffer`.
 */
import { Buffer } from 'buffer';

const g = globalThis as typeof globalThis & { Buffer?: typeof Buffer };
if (!g.Buffer) g.Buffer = Buffer;
