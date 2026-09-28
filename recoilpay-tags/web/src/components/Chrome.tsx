/** The RecoilPay lockup with a quiet mono label for this surface — the same shape as recoilpay.com's. */
export function Logo() {
  return (
    <a href="/" className="inline-flex select-none items-center gap-2" aria-label="RecoilPay Tags — home">
      <img src="/logo.png" alt="" width={22} height={22} className="shrink-0 rounded-[22%]" />
      <span className="flex items-baseline gap-1.5">
        <span className="text-[18px] font-[500] leading-none tracking-[-0.0074em] text-ink">
          Recoil<span className="text-accent">Pay</span>
        </span>
        <span className="mono text-[10px] leading-none text-muted">tags</span>
      </span>
    </a>
  );
}

export function Header() {
  return (
    <header className="mx-auto flex max-w-[1120px] items-center justify-between px-5 pt-[max(20px,env(safe-area-inset-top))] sm:px-8">
      <Logo />
      <a href="https://recoilpay.com" className="text-[14px] text-secondary transition-colors hover:text-ink">
        recoilpay.com <span aria-hidden="true">↗</span>
      </a>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="mx-auto max-w-[1120px] px-5 pb-[max(32px,env(safe-area-inset-bottom))] sm:px-8">
      <div className="flex flex-col gap-3 border-t border-hairline pt-6 text-[13px] text-muted sm:flex-row sm:items-center sm:justify-between">
        <p>Tags are reservations. Sending to a tag arrives with RecoilPay send.</p>
        <p className="mono">© {new Date().getFullYear()} RecoilPay</p>
      </div>
    </footer>
  );
}
