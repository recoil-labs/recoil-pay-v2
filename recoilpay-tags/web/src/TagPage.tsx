import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { ROUTES, normalizeTag, truncateAddress, validateTag } from '../../shared/tag.ts';
import { ClaimField } from './components/ClaimField.tsx';
import { Eyebrow, Reveal } from './components/Reveal.tsx';
import { ShareRow } from './components/ShareRow.tsx';
import { RoutesEditor } from './flow/RoutesEditor.tsx';
import { isUserRejection, useSignTag } from './flow/useSignTag.ts';
import { api, ApiError, type PublicTag } from './lib/api.ts';
import { T, useMotion } from './lib/motion.ts';

type Load = { status: 'loading' } | { status: 'found'; tag: PublicTag } | { status: 'missing' } | { status: 'error'; message: string };

const formatDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

/** tags.recoilpay.com/@name — the artefact people link to. */
export function TagPage({ handle, onReserve }: { handle: string; onReserve: (tag: string) => void }) {
  const tag = normalizeTag(handle);
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!validateTag(tag).ok) return setLoad({ status: 'missing' });
    let live = true;
    api.tag(tag).then(
      (t) => live && setLoad({ status: 'found', tag: t }),
      (err) => live && setLoad(err instanceof ApiError && err.status === 404 ? { status: 'missing' } : { status: 'error', message: err.message }),
    );
    return () => {
      live = false;
    };
  }, [tag, reloadKey]);

  useEffect(() => {
    document.title = load.status === 'found' ? `@${load.tag.tag} — reserved on RecoilPay` : 'RecoilPay Tags';
  }, [load]);

  return (
    <div className="mx-auto max-w-[1120px] px-5 pb-28 pt-20 sm:px-8 sm:pt-28">
      {/* Reserve the tag line's height so nothing jumps as it loads. */}
      {load.status === 'loading' && (
        <div aria-busy="true">
          <Eyebrow>/reserved</Eyebrow>
          <p className="mono mt-5 text-[clamp(44px,8vw,96px)] leading-none text-ink/0">@{tag || '…'}</p>
        </div>
      )}
      {load.status === 'error' && <p className="text-danger">{load.message}</p>}
      {load.status === 'missing' && <Unreserved tag={tag} onReserve={onReserve} />}
      {load.status === 'found' && <Reserved t={load.tag} onChanged={() => setReloadKey((k) => k + 1)} />}
    </div>
  );
}

function Reserved({ t: data, onChanged }: { t: PublicTag; onChanged: () => void }) {
  const { address } = useAccount();
  const isOwner = address?.toLowerCase() === data.owner;
  const routes = data.routes;

  return (
    <Reveal as="div">
      <Reveal.Item>
        <Eyebrow>/reserved</Eyebrow>
      </Reveal.Item>
      <Reveal.Item>
        <h1 className="mono mt-5 break-all text-[clamp(44px,8vw,96px)] leading-none tracking-[-0.02em] text-ink">@{data.tag}</h1>
      </Reveal.Item>
      <Reveal.Item>
        <dl className="mt-8 grid max-w-[560px] grid-cols-[auto_1fr] gap-x-8 gap-y-2 text-[14px]">
          <dt className="text-muted">owner</dt>
          <dd className="mono text-ink">{data.ens ?? truncateAddress(data.owner)}</dd>
          <dt className="text-muted">reserved</dt>
          <dd className="text-ink">{formatDate(data.reservedAt)}</dd>
          <dt className="text-muted">status</dt>
          <dd className="text-secondary">Reserved — sending to tags arrives with RecoilPay send</dd>
        </dl>
      </Reveal.Item>

      {routes && (
        <Reveal.Item className="mt-10 max-w-[560px]">
          <p className="mono text-[12px] text-muted">addresses</p>
          <ul className="mt-3 rounded-md border border-hairline">
            {ROUTES.map((r, i) => (
              <li key={r.key} className={`flex items-center justify-between gap-4 px-4 py-2.5 ${i ? 'border-t border-hairline' : ''}`}>
                <span className="text-[14px] text-ink">
                  {r.token} <span className="text-muted">on {r.chain}</span>
                </span>
                <span className="mono text-[13px] text-secondary">→ {truncateAddress(routes[r.key] ?? routes['*'])}</span>
              </li>
            ))}
          </ul>
        </Reveal.Item>
      )}

      <Reveal.Item className="mt-12 max-w-[560px]">
        <ShareRow tag={data.tag} />
      </Reveal.Item>

      <Reveal.Item className="mt-12 flex max-w-[560px] flex-col gap-6 border-t border-hairline pt-8">
        {isOwner ? (
          <Manage tag={data.tag} onChanged={onChanged} />
        ) : (
          <>
            <p className="text-[15px] text-secondary">Your wallet could have a name too.</p>
            <a href="/" className="grid h-11 w-fit place-items-center rounded-md bg-accent px-5 text-[15px] font-[500] text-ground">
              Reserve your tag
            </a>
          </>
        )}
      </Reveal.Item>
    </Reveal>
  );
}

/** The owner returns, signs again (free), and edits addresses. */
function Manage({ tag, onChanged }: { tag: string; onChanged: () => void }) {
  const { address } = useAccount();
  const sign = useSignTag('manage');
  const { t } = useMotion();
  const [session, setSession] = useState<Awaited<ReturnType<typeof api.manage>> | null>(null);
  const [state, setState] = useState<'idle' | 'signing' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setError(null);
    setState('signing');
    try {
      setSession(await api.manage(await sign(tag)));
      setState('idle');
    } catch (err) {
      setState('idle');
      setError(isUserRejection(err) ? 'Signature cancelled.' : (err as Error).message);
    }
  };

  return (
    <div>
      <p className="text-[15px] text-ink">This is your tag.</p>
      <AnimatePresence mode="wait" initial={false}>
        {session && address ? (
          <motion.div key="edit" className="mt-5" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={t(T.fade)}>
            <RoutesEditor
              defaultAddress={address}
              initialRoutes={session.routes}
              initialShowAddresses={session.showAddresses}
              saveLabel="Save addresses"
              onSave={async (v) => {
                await api.setRoutes(tag, session.editToken, v);
                setSession(null);
                setState('saved');
                onChanged();
              }}
            />
          </motion.div>
        ) : (
          <motion.div key="start" className="mt-3 flex flex-col gap-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={t(T.fade)}>
            <p className="text-[14px] text-secondary">
              {state === 'saved' ? 'Saved.' : 'Add or change the addresses it points to. Sign to confirm it’s you — free, no gas.'}
            </p>
            {error && <p className="text-[13px] text-danger">{error}</p>}
            <button
              type="button"
              onClick={start}
              disabled={state === 'signing'}
              className="grid h-11 w-fit place-items-center rounded-md border border-hairline px-5 text-[15px] text-ink transition-colors hover:border-accent/60 disabled:opacity-50"
            >
              {state === 'signing' ? 'Check your wallet…' : 'Manage addresses'}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Unreserved({ tag, onReserve }: { tag: string; onReserve: (tag: string) => void }) {
  return (
    <Reveal as="div">
      <Reveal.Item>
        <Eyebrow>/reserve</Eyebrow>
      </Reveal.Item>
      <Reveal.Item>
        <h1 className="heading mt-5 max-w-[20ch] text-[clamp(36px,5.6vw,64px)]">
          {validateTag(tag).ok ? (
            <>
              <span className="mono tracking-[-0.02em]">@{tag}</span> isn’t reserved yet.
            </>
          ) : (
            'That isn’t a tag.'
          )}
        </h1>
      </Reveal.Item>
      <Reveal.Item>
        <p className="mt-6 max-w-[52ch] text-[17px] text-secondary">Reserve it now — free, a signature, not a transaction.</p>
      </Reveal.Item>
      <Reveal.Item className="mt-10 max-w-[640px]">
        <ClaimField id="claim-tag" initial={validateTag(tag).ok ? tag : ''} autoFocus onReserve={onReserve} />
      </Reveal.Item>
    </Reveal>
  );
}
