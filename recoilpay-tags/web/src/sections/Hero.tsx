import { ClaimField } from '../components/ClaimField.tsx';
import { Eyebrow, Reveal } from '../components/Reveal.tsx';

export function Hero({ onReserve }: { onReserve: (tag: string) => void }) {
  return (
    <Reveal as="div" className="mx-auto max-w-[1120px] px-5 pb-24 pt-20 sm:px-8 sm:pb-32 sm:pt-28">
      <Reveal.Item>
        <Eyebrow>/reserve</Eyebrow>
      </Reveal.Item>
      <Reveal.Item>
        <h1 className="heading mt-5 max-w-[20ch] text-[clamp(40px,6.4vw,76px)]">Your wallet, but it has a name.</h1>
      </Reveal.Item>
      <Reveal.Item>
        <p className="mt-6 max-w-[52ch] text-[17px] text-secondary">
          Reserve your tag now. Use it everywhere once RecoilPay send goes live — one name for every chain and token, with the right address
          chosen automatically.
        </p>
      </Reveal.Item>
      <Reveal.Item className="mt-10 max-w-[640px]">
        <ClaimField id="claim-hero" autoFocus demo onReserve={onReserve} />
      </Reveal.Item>
    </Reveal>
  );
}
