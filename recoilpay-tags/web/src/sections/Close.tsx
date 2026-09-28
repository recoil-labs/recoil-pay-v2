import { useEffect, useState } from 'react';
import { ClaimField } from '../components/ClaimField.tsx';
import { Eyebrow, Reveal } from '../components/Reveal.tsx';
import { api } from '../lib/api.ts';

export function Close({ onReserve }: { onReserve: (tag: string) => void }) {
  // A real count or nothing — never a made-up number or a countdown.
  const [reserved, setReserved] = useState<number | null>(null);
  useEffect(() => {
    api.stats().then((s) => setReserved(s.reserved), () => {});
  }, []);

  return (
    <section aria-label="Reserve your tag" className="border-t border-hairline">
      <Reveal as="div" className="mx-auto max-w-[1120px] px-5 py-24 sm:px-8 sm:py-32">
        <Reveal.Item>
          <Eyebrow>/reserve</Eyebrow>
        </Reveal.Item>
        <Reveal.Item>
          <h2 className="heading mt-5 max-w-[20ch] text-[clamp(30px,4vw,48px)]">Take yours before someone else does.</h2>
        </Reveal.Item>
        <Reveal.Item>
          <p className="mt-5 max-w-[52ch] text-[16px] text-secondary">
            Free, and it takes a minute — connect a wallet and sign. Up to three tags per wallet. Reservations don’t expire.
          </p>
        </Reveal.Item>
        <Reveal.Item className="mt-10 max-w-[640px]">
          <ClaimField id="claim-close" onReserve={onReserve} />
        </Reveal.Item>
        {reserved !== null && reserved > 0 && (
          <Reveal.Item>
            <p className="mono mt-4 text-[13px] text-muted">{reserved.toLocaleString('en-US')} tags reserved so far</p>
          </Reveal.Item>
        )}
      </Reveal>
    </section>
  );
}
