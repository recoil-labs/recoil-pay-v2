import { useState } from 'react';
import { Copy, Eye } from 'lucide-react';
import { Button } from './ui';
import { openCode } from '../crypto/sealedCode';
import { useEncryptionKey } from '../crypto/useEncryptionKey';
import type { Trade } from '../types/trades';

/* Opening a code that was sealed to you.
 *
 * The decryption happens here, in the browser, with a key derived from a
 * wallet signature. Nothing on the server can do this — it holds the
 * ciphertext and no key that opens it, which is the point.
 *
 * Shown to whoever is the card RECEIVER on a trade. For a merchant buying a
 * card that is how they redeem it before attesting; for a user buying one it
 * is the thing they paid for.
 */
export function RevealCode({ trade }: { trade: Trade }) {
  const { unlock } = useEncryptionKey();
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!trade.sealedCode) return null;

  async function reveal() {
    setBusy(true);
    setError(null);
    try {
      const { privateKey } = await unlock();
      setCode(openCode(trade.sealedCode!, privateKey));
    } catch (e) {
      // The most likely cause by far is signing from a different wallet than
      // the one that funded escrow, which derives a different key. Say so
      // rather than reporting a cipher error nobody can act on.
      setError(
        e instanceof Error && /decrypt|tag|invalid/i.test(e.message)
          ? 'Could not open this code. Make sure you are using the same wallet you funded the trade with.'
          : e instanceof Error
            ? e.message
            : 'could not open the code',
      );
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard is blocked in some contexts; the code is on screen anyway.
    }
  }

  return (
    <div className="rounded-[8px] border border-hairline bg-raised px-4 py-4">
      {code ? (
        <>
          <p className="text-[12px] text-muted">Your code</p>
          <p className="mt-1.5 font-mono text-[15px] break-all text-ink">{code}</p>
          <Button variant="secondary" className="mt-3" onClick={copy}>
            <Copy size={13} strokeWidth={1.75} />
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </>
      ) : (
        <>
          <p className="text-[13px] leading-relaxed text-secondary">
            This code is encrypted to you. Signing with your wallet unlocks it
            here in your browser — the signature never leaves this page, and
            we have no key that opens it.
          </p>
          {error && <p className="mt-2 text-[12px] text-danger">{error}</p>}
          <Button className="mt-3" onClick={reveal} disabled={busy}>
            <Eye size={13} strokeWidth={1.75} />
            {busy ? 'Unlocking…' : 'Reveal code'}
          </Button>
        </>
      )}
    </div>
  );
}
