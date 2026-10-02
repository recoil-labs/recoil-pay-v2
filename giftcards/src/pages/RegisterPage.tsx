import { useState } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useNavigate } from 'react-router-dom';
import { useAccount, useSignMessage } from 'wagmi';
import { ApiError, MerchantApi } from '../api/merchantApi';
import { useAuthStore } from '../stores/auth-store';
import { Button, Card, Field, inputClass } from '../components/ui';

/** Registration is two calls and one signature: fetch the challenge, sign
 *  it, post it back. The aggregator recovers the address, creates the
 *  operator record and returns an api_key exactly once. */
export function RegisterPage() {
  const { address, isConnected, chain } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const adopt = useAuthStore((s) => s.adopt);
  const navigate = useNavigate();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issuedKey, setIssuedKey] = useState<string | null>(null);

  async function handleRegister() {
    if (!address) return;
    setBusy(true);
    setError(null);
    try {
      const message = await MerchantApi.getRegistrationMessage(address);
      const signature = await signMessageAsync({ message });
      const res = await MerchantApi.register({
        address,
        message,
        signature,
        chainId: chain ? String(chain.id) : undefined,
      });

      if (!res.success || !res.solverId) {
        throw new Error('the aggregator rejected the registration');
      }

      adopt({ apiKey: res.apiKey, solverId: res.solverId });

      // The key is shown once and only once. Hold the page until the
      // merchant has acknowledged it rather than navigating straight to the
      // dashboard, because there is no second chance to read it and the
      // only recovery is a rotation.
      if (res.apiKey) setIssuedKey(res.apiKey);
      else navigate('/merchant/rates', { replace: true });
    } catch (e) {
      const message =
        e instanceof ApiError || e instanceof Error ? e.message : 'registration failed';
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  if (issuedKey) {
    return (
      <div className="mx-auto max-w-[520px] px-5 py-14">
        <Card className="p-7">
          <h1 className="text-[20px] text-ink">You are registered</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-muted">
            This API key authenticates every request this dashboard makes. It
            is shown once. It is already saved in this browser — copy it
            somewhere safe if you want to use another one.
          </p>
          <div className="mt-5">
            <Field label="API key">
              <input
                readOnly
                value={issuedKey}
                onFocus={(e) => e.currentTarget.select()}
                className={`${inputClass} font-mono text-[12px]`}
              />
            </Field>
          </div>
          <Button className="mt-6 w-full" onClick={() => navigate('/merchant/rates', { replace: true })}>
            Publish your first rates
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[520px] px-5 py-14">
      <Card className="p-7">
        <h1 className="text-[20px] text-ink">Register as a merchant</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          One signature creates your operator record. Gift card merchants and
          swap solvers are the same kind of account on RecoilPay, so if you
          already run a solver you are already registered — connect that
          wallet instead.
        </p>

        {!isConnected ? (
          <div className="mt-6">
            <ConnectButton chainStatus="none" showBalance={false} />
          </div>
        ) : (
          <>
            <p className="mt-5 font-mono text-[12px] text-secondary">{address}</p>
            <Button className="mt-5 w-full" onClick={handleRegister} disabled={busy}>
              {busy ? 'Waiting for signature…' : 'Sign and register'}
            </Button>
          </>
        )}

        {error && <p className="mt-4 text-[12px] text-danger">{error}</p>}
      </Card>
    </div>
  );
}
