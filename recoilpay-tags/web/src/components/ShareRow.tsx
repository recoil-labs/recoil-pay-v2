import { AnimatePresence, motion } from 'framer-motion';
import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import { tagUrl } from '../lib/api.ts';
import { T, useMotion } from '../lib/motion.ts';

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Older Safari and non-secure contexts.
    const el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', '');
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    el.remove();
  }
}

/** Copy feedback is the label itself cross-fading to "copied" for 1.2s — no toast. */
export function CopyButton({ text, label, className = '' }: { text: string; label: string; className?: string }) {
  const { t } = useMotion();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <button
      type="button"
      onClick={async () => {
        await copyText(text);
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1200);
      }}
      className={`relative inline-grid h-10 place-items-center rounded-md border border-hairline px-4 text-[14px] text-ink transition-colors hover:border-accent/60 ${className}`}
    >
      {/* Both labels occupy the same cell so the button never changes width. */}
      <span className="invisible col-start-1 row-start-1" aria-hidden="true">
        {label.length > 'copied'.length ? label : 'copied'}
      </span>
      <AnimatePresence initial={false}>
        <motion.span
          key={copied ? 'copied' : 'label'}
          className={`col-start-1 row-start-1 ${copied ? 'text-success' : ''}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={t(T.swap)}
        >
          {copied ? 'copied' : label}
        </motion.span>
      </AnimatePresence>
      <span className="sr-only" aria-live="polite">
        {copied ? 'Copied to clipboard' : ''}
      </span>
    </button>
  );
}

export function ShareRow({ tag }: { tag: string }) {
  const { t } = useMotion();
  const url = tagUrl(tag);
  const post = `I reserved @${tag} on @RecoilPay`;
  const [qr, setQr] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);

  useEffect(() => {
    QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#e9e9ed', light: '#00000000' } }).then(setQr, () =>
      setQr(null),
    );
  }, [url]);

  return (
    <div className="flex flex-col gap-4">
      <div className="mono flex items-center justify-between gap-3 rounded-md border border-hairline bg-ground px-3 py-2.5 text-[13px] text-secondary">
        <span className="truncate">{url.replace(/^https?:\/\//, '')}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <CopyButton text={url} label="copy link" />
        <a
          href={`https://x.com/intent/post?text=${encodeURIComponent(post)}&url=${encodeURIComponent(url)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-10 items-center rounded-md border border-hairline px-4 text-[14px] text-ink transition-colors hover:border-accent/60"
        >
          post on X
        </a>
        <CopyButton text={`${post} ${url}`} label="copy post" />
        {qr && (
          <button
            type="button"
            aria-expanded={showQr}
            onClick={() => setShowQr((s) => !s)}
            className="inline-flex h-10 items-center rounded-md border border-hairline px-4 text-[14px] text-ink transition-colors hover:border-accent/60"
          >
            {showQr ? 'hide QR' : 'QR code'}
          </button>
        )}
      </div>
      <AnimatePresence initial={false}>
        {showQr && qr && (
          <motion.div
            className="overflow-hidden"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={t(T.row)}
          >
            <div className="flex items-center gap-4 pt-1">
              {/* Our own generated SVG — no user content goes into it. */}
              <div className="size-[132px] rounded-md border border-hairline bg-ground p-3 [&_svg]:size-full" dangerouslySetInnerHTML={{ __html: qr }} />
              <p className="max-w-[22ch] text-[13px] text-muted">
                Scan to open <span className="mono text-secondary">@{tag}</span>’s page.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
