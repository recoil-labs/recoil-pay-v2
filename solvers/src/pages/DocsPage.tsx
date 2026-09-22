import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

/**
 * Operator handbook.
 *
 * Deliberately a public route: most of this needs reading *before* you
 * register, and registration is what issues the API key the rest of the
 * app is gated on.
 */

interface Section {
  id: string;
  title: string;
  body: React.ReactNode;
}

const Code: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <code className="font-mono text-[12px] bg-[#08122a] border border-[#454556]/40 rounded px-1.5 py-0.5 text-[#bfc2ff]">
    {children}
  </code>
);

const Note: React.FC<{ tone?: 'info' | 'warn'; children: React.ReactNode }> = ({
  tone = 'info',
  children,
}) => (
  <div
    className={`rounded-xl border px-4 py-3 text-[13px] leading-relaxed my-4 ${
      tone === 'warn'
        ? 'border-yellow-400/25 bg-yellow-400/5 text-yellow-100/90'
        : 'border-[#424af6]/25 bg-[#424af6]/5 text-[#c6c5d9]'
    }`}
  >
    {children}
  </div>
);

const Step: React.FC<{ n: number; title: string; children: React.ReactNode }> = ({
  n,
  title,
  children,
}) => (
  <div className="flex gap-4 mb-6">
    <div className="shrink-0 w-7 h-7 rounded-full bg-[#424af6] text-white font-mono text-xs font-bold flex items-center justify-center mt-0.5">
      {n}
    </div>
    <div className="flex-1">
      <h4 className="text-white font-bold text-[15px] mb-1.5">{title}</h4>
      <div className="text-[13px] text-[#c6c5d9] leading-relaxed space-y-2">{children}</div>
    </div>
  </div>
);

const SECTIONS: Section[] = [
  {
    id: 'what-is-this',
    title: 'What you are signing up for',
    body: (
      <>
        <p>
          RecoilPay is a marketplace for cross-chain swaps. Users describe what they want
          ("swap 100 USDC on OP Sepolia for USDC on Base Sepolia") and{' '}
          <b className="text-white">you compete to fill it with your own inventory</b>. You
          are the liquidity.
        </p>
        <p className="mt-3">
          You do not run any infrastructure. You publish standing offers ("quotes") from
          this dashboard, and the platform's hosted worker executes the on-chain settlement
          on your behalf when one of your offers wins an order.
        </p>
        <p className="mt-3">Your side of the deal is three things:</p>
        <ul className="list-disc pl-5 mt-2 space-y-1">
          <li>Register once with your wallet.</li>
          <li>Keep a funded fill-wallet (gas + token inventory).</li>
          <li>Keep useful quotes published.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'how-a-swap-works',
    title: 'How a swap actually settles',
    body: (
      <>
        <p>
          Worth understanding before you fund anything, because it explains exactly which
          chains need gas and which need inventory.
        </p>
        <p className="mt-3">
          A swap is <b className="text-white">three on-chain transactions across two
          chains</b>, all executed by the platform using your fill-wallet:
        </p>
        <div className="mt-4 space-y-3">
          <div className="rounded-xl border border-[#454556]/25 bg-[#111b33]/50 p-4">
            <div className="text-white font-bold text-[13px] mb-1">
              1. Escrow — on the <span className="text-[#bfc2ff]">origin</span> chain
            </div>
            <p className="text-[12px] text-[#c6c5d9]">
              The user's tokens are pulled into an escrow contract using the signature they
              produced when accepting your quote. Their funds are now locked — not yours,
              not ours. Costs you gas only.
            </p>
          </div>
          <div className="rounded-xl border border-[#454556]/25 bg-[#111b33]/50 p-4">
            <div className="text-white font-bold text-[13px] mb-1">
              2. Deliver — on the <span className="text-[#bfc2ff]">destination</span> chain
            </div>
            <p className="text-[12px] text-[#c6c5d9]">
              Your fill-wallet sends the agreed output tokens to the user. This is where
              your inventory is spent, so the destination chain needs both gas and tokens.
            </p>
          </div>
          <div className="rounded-xl border border-[#454556]/25 bg-[#111b33]/50 p-4">
            <div className="text-white font-bold text-[13px] mb-1">
              3. Claim — back on the <span className="text-[#bfc2ff]">origin</span> chain
            </div>
            <p className="text-[12px] text-[#c6c5d9]">
              Once delivery is attested, the escrowed input is released to you. This is how
              you get paid, and it is what makes the trade profitable: you paid out slightly
              less than you claimed.
            </p>
          </div>
        </div>
        <Note>
          The user is never exposed to your failure. If delivery never happens, the escrow
          is not claimable by you and the user reclaims their funds after the order expires.
        </Note>
      </>
    ),
  },
  {
    id: 'onboarding',
    title: 'Onboarding, step by step',
    body: (
      <>
        <Step n={1} title="Connect your wallet">
          <p>
            Your wallet is your identity. There is no email or password, and you are never
            asked for a private key. Any EVM wallet works.
          </p>
        </Step>
        <Step n={2} title="Pick a handle">
          <p>A display name for your solver. Cosmetic — it does not affect matching.</p>
        </Step>
        <Step n={3} title="Sign one message">
          <p>
            You sign a plain text message (EIP-191) proving you control the address. This
            is a <b className="text-white">signature, not a transaction</b> — it costs no
            gas and grants no spending permission.
          </p>
        </Step>
        <Step n={4} title="Registration completes">
          <p>Two things are created for you:</p>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li>
              An <b className="text-white">API key</b>, stored in this browser. It is how
              the dashboard authenticates as you.
            </li>
            <li>
              A <b className="text-white">fill-wallet</b> — a fresh address that executes
              your settlements.
            </li>
          </ul>
        </Step>
        <Note tone="warn">
          Your API key lives in this browser's local storage. Clearing site data logs you
          out, and you will need to re-register to get a new key. Registering again with the
          same wallet returns you to the same operator account.
        </Note>
      </>
    ),
  },
  {
    id: 'fill-wallet',
    title: 'Funding your fill-wallet',
    body: (
      <>
        <p>
          The fill-wallet is the address that performs all three settlement transactions.
          Find it under <b className="text-white">Fill Wallet</b>, where live on-chain
          balances are shown per chain.
        </p>
        <Note tone="warn">
          The platform holds this wallet's private key (encrypted) so it can sign
          settlements without you being online. Treat it as a hot wallet: fund it with
          working capital, not your treasury.
        </Note>
        <p className="mt-4">You need two different things:</p>
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-left text-[12px]">
            <thead>
              <tr className="border-b border-[#454556]/30 text-[#8f8fa2] uppercase tracking-wider">
                <th className="pb-2 pr-4 font-bold">What</th>
                <th className="pb-2 pr-4 font-bold">Which chains</th>
                <th className="pb-2 font-bold">Why</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#454556]/20 text-[#c6c5d9]">
              <tr>
                <td className="py-2.5 pr-4 text-white font-bold">Native gas</td>
                <td className="py-2.5 pr-4">Every chain you quote — both sides</td>
                <td className="py-2.5">
                  Escrow and claim run on the origin chain; delivery runs on the
                  destination. All three cost gas.
                </td>
              </tr>
              <tr>
                <td className="py-2.5 pr-4 text-white font-bold">Token inventory</td>
                <td className="py-2.5 pr-4">Destination chains only</td>
                <td className="py-2.5">
                  This is what you hand the user. You get repaid on the origin chain moments
                  later.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <Note>
          The Fill Wallet tab warns about missing inventory on <i>every</i> chain, including
          ones you only ever use as an origin. If you only quote OP&nbsp;→&nbsp;Base, an
          inventory warning on OP Sepolia is harmless — you never pay out there.
        </Note>
      </>
    ),
  },
  {
    id: 'quotes',
    title: 'Publishing quotes',
    body: (
      <>
        <p>
          A quote is a standing offer: "I will fill this route, at this price, for orders
          this big, until this time." Published from <b className="text-white">Quotes</b>.
        </p>
        <h4 className="text-white font-bold text-[14px] mt-5 mb-2">The fields</h4>
        <ul className="space-y-3">
          <li>
            <b className="text-white">Route</b> — source and destination chain plus token.
            The dropdowns only offer routes the settlement layer can actually execute, so
            you cannot publish something unfillable.
          </li>
          <li>
            <b className="text-white">Order size range</b> — the smallest and largest order
            you will accept. Orders outside the range simply do not match you. Enter human
            amounts; the conversion to base units is handled for you.
          </li>
          <li>
            <b className="text-white">Margin</b> — your percentage cut. 0.15% means the user
            receives 99.85% of their input, before the flat fee.
          </li>
          <li>
            <b className="text-white">Gas fee</b> — a flat amount deducted from every fill
            to cover the gas you spend settling it. It is the same whether the order is 1
            token or 10,000, so it dominates the price on small orders. Keep it near your
            real cost.
          </li>
          <li>
            <b className="text-white">Expiry</b> — how long the offer stays live. Presets
            from 15 minutes to 7 days, or a custom duration. You are committing to this
            price for the whole window, so long windows on volatile pairs carry real risk.
            Stablecoin pairs are far safer to leave up.
          </li>
        </ul>
        <Note>
          The <b>What the user receives</b> preview shows the effective price at both ends
          of your size range and warns when it drops below 95% of input. If your smallest
          order looks terrible there, your flat fee is too high for that size.
        </Note>
      </>
    ),
  },
  {
    id: 'matching',
    title: 'How your quote gets chosen',
    body: (
      <>
        <p>When a user asks for a price, your quote is filtered out unless all of these hold:</p>
        <ul className="list-disc pl-5 mt-2 space-y-1">
          <li>The chain pair and token pair match exactly.</li>
          <li>The order size falls inside your range.</li>
          <li>The quote has not expired and is not paused.</li>
          <li>Your account is not circuit-broken.</li>
        </ul>
        <p className="mt-4">Surviving quotes are scored and the best one wins:</p>
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-left text-[12px]">
            <thead>
              <tr className="border-b border-[#454556]/30 text-[#8f8fa2] uppercase tracking-wider">
                <th className="pb-2 pr-4 font-bold">Factor</th>
                <th className="pb-2 pr-4 font-bold">Weight</th>
                <th className="pb-2 font-bold">Meaning</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#454556]/20 text-[#c6c5d9]">
              <tr>
                <td className="py-2 pr-4 text-white font-bold">Output</td>
                <td className="py-2 pr-4 font-mono">50%</td>
                <td className="py-2">How much the user receives. Price dominates.</td>
              </tr>
              <tr>
                <td className="py-2 pr-4 text-white font-bold">Reputation</td>
                <td className="py-2 pr-4 font-mono">25%</td>
                <td className="py-2">Your track record. New accounts start at 0.5.</td>
              </tr>
              <tr>
                <td className="py-2 pr-4 text-white font-bold">Success rate</td>
                <td className="py-2 pr-4 font-mono">15%</td>
                <td className="py-2">Fills completed ÷ fills attempted.</td>
              </tr>
              <tr>
                <td className="py-2 pr-4 text-white font-bold">Speed</td>
                <td className="py-2 pr-4 font-mono">10%</td>
                <td className="py-2">Rolling average settlement latency.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-4">
          Reputation moves <b className="text-white">+0.02 per success</b> and{' '}
          <b className="text-white">−0.10 per failure</b>, bounded to 0–1. A failure costs
          five successes to undo, so a quote you cannot honour is far more expensive than a
          quote you never publish.
        </p>
      </>
    ),
  },
  {
    id: 'orders',
    title: 'Watching orders',
    body: (
      <>
        <p>
          <b className="text-white">Orders</b> shows every order routed to you and where it
          got to. An order moves through:
        </p>
        <div className="font-mono text-[12px] text-[#c6c5d9] bg-[#08122a] border border-[#454556]/30 rounded-xl p-4 my-3 overflow-x-auto">
          created → pending → executing → executed → settling → finalized
        </div>
        <p>
          Roughly: <Code>pending</Code>/<Code>executing</Code> is the escrow step,{' '}
          <Code>executed</Code> means the user has been paid, and <Code>finalized</Code>{' '}
          means you have claimed the escrow and the trade is complete. Each stage records
          its transaction hash.
        </p>
        <p className="mt-3">
          A failure records which stage failed. <Code>failed</Code> at the delivery stage
          usually means missing inventory or gas.
        </p>
        <Note>
          Settlement normally completes in under a minute. If an order sits in one state far
          longer, check your fill-wallet balances first — that is the most common cause.
        </Note>
      </>
    ),
  },
  {
    id: 'earnings',
    title: 'Where your earnings go',
    body: (
      <>
        <p>
          Profit is the spread: you deliver slightly less than you claim from escrow, minus
          gas. Claimed funds are paid to your{' '}
          <b className="text-white">fill-wallet on the origin chain</b>.
        </p>
        <p className="mt-3">
          So earnings accumulate in the same wallet that funds your fills — which is
          convenient, since a completed swap partly replenishes the inventory it consumed,
          just on the other chain. Over time an unbalanced route will drain one side and
          pile up on the other, so you will need to rebalance.
        </p>
        <Note tone="warn">
          There is no withdraw button yet. The platform holds the fill-wallet key, so moving
          funds out is not something you can do from this dashboard today. Do not put more
          in it than you are willing to leave working.
        </Note>
      </>
    ),
  },
  {
    id: 'troubleshooting',
    title: 'Troubleshooting',
    body: (
      <>
        <div className="space-y-4">
          <div>
            <h4 className="text-white font-bold text-[14px] mb-1">
              My quote never matches anything
            </h4>
            <p className="text-[13px] text-[#c6c5d9]">
              Check expiry first — an expired quote is invisible and the table marks it in
              red. Then check the size range covers the orders being asked for, and that the
              route matches exactly. A quote is only offered for the precise chain and token
              pair it names.
            </p>
          </div>
          <div>
            <h4 className="text-white font-bold text-[14px] mb-1">
              An order failed at the delivery stage
            </h4>
            <p className="text-[13px] text-[#c6c5d9]">
              Almost always missing inventory or gas on the destination chain. Open Fill
              Wallet and look for red or yellow. Note the user is unharmed — they reclaim
              from escrow — but your reputation takes the −0.10.
            </p>
          </div>
          <div>
            <h4 className="text-white font-bold text-[14px] mb-1">
              I am being asked to register again
            </h4>
            <p className="text-[13px] text-[#c6c5d9]">
              Your API key is missing from this browser, or it no longer matches an account.
              Re-registering with the same wallet returns you to the same operator, quotes
              and reputation intact.
            </p>
          </div>
          <div>
            <h4 className="text-white font-bold text-[14px] mb-1">
              The user received less than my quoted rate
            </h4>
            <p className="text-[13px] text-[#c6c5d9]">
              The flat gas fee is deducted on top of your margin. On small orders it is the
              larger of the two by far. The quote preview shows the true effective rate
              before you publish.
            </p>
          </div>
        </div>
      </>
    ),
  },
];

export const DocsPage: React.FC = () => {
  const [active, setActive] = useState(SECTIONS[0].id);

  // Highlight whichever section is currently in view.
  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActive(visible.target.id);
      },
      { rootMargin: '-80px 0px -70% 0px' },
    );
    SECTIONS.forEach(s => {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  return (
    <div className="min-h-screen bg-[#08122a] text-[#dae2ff] font-sans">
      <header className="sticky top-0 z-40 border-b border-[#454556]/30 bg-[#111b33]/95 backdrop-blur-xl">
        <div className="max-w-[1100px] mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-[#424af6]">menu_book</span>
            <h1 className="font-headline text-lg font-bold text-white">Operator handbook</h1>
          </div>
          <Link
            to="/"
            className="font-mono text-[11px] uppercase tracking-widest text-[#bfc2ff] bg-[#424af6]/10 border border-[#424af6]/20 px-3 py-1.5 rounded-lg hover:bg-[#424af6]/20 transition-colors"
          >
            Back to dashboard
          </Link>
        </div>
      </header>

      <div className="max-w-[1100px] mx-auto px-6 py-10 flex gap-10">
        <nav className="hidden lg:block w-56 shrink-0">
          <div className="sticky top-24 space-y-1">
            <p className="font-mono text-[10px] uppercase tracking-widest text-[#8f8fa2] mb-3 px-3">
              Contents
            </p>
            {SECTIONS.map(s => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className={`block px-3 py-2 rounded-lg text-[12px] transition-colors ${
                  active === s.id
                    ? 'bg-[#424af6]/15 text-[#bfc2ff] font-bold'
                    : 'text-[#c6c5d9] hover:bg-white/5 hover:text-white'
                }`}
              >
                {s.title}
              </a>
            ))}
          </div>
        </nav>

        <main className="flex-1 min-w-0 space-y-12">
          {SECTIONS.map((s, i) => (
            <section key={s.id} id={s.id} className="scroll-mt-24">
              <div className="flex items-baseline gap-3 mb-4">
                <span className="font-mono text-[11px] text-[#8f8fa2]">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <h2 className="font-headline text-2xl font-bold text-white">{s.title}</h2>
              </div>
              <div className="text-[14px] text-[#c6c5d9] leading-relaxed">{s.body}</div>
            </section>
          ))}

          <footer className="border-t border-[#454556]/25 pt-6 text-[12px] text-[#8f8fa2]">
            Something here wrong or unclear? It probably means the product is unclear too —
            tell us and we will fix both.
          </footer>
        </main>
      </div>
    </div>
  );
};
