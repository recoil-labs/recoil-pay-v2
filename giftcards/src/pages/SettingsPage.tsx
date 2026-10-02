import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { MerchantApi, getSolverId, type OperatorSummary } from '../api/merchantApi';
import { useAuthStore } from '../stores/auth-store';
import { Button, Card, CardHeader, Field, inputClass } from '../components/ui';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline/60 px-5 py-3 last:border-0">
      <span className="text-[13px] text-muted">{label}</span>
      <span className="font-mono text-[12px] text-secondary">{value}</span>
    </div>
  );
}

export function SettingsPage() {
  const { address } = useAccount();
  const signOut = useAuthStore((s) => s.signOut);
  const [operator, setOperator] = useState<OperatorSummary | null>(null);

  useEffect(() => {
    void MerchantApi.getOperator(getSolverId())
      .then(setOperator)
      .catch(() => setOperator(null));
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader title="Account" />
        <Row label="Merchant id" value={getSolverId() || '—'} />
        <Row label="Registered wallet" value={operator?.walletAddress ?? address ?? '—'} />
        <Row
          label="Fill wallet"
          value={operator?.fillWalletAddress ?? '—'}
        />
      </Card>

      <Card>
        <CardHeader
          title="Aggregator"
          detail="Which backend this dashboard talks to. Only change this if you are testing against another deployment."
        />
        <div className="px-5 py-5">
          <Field
            label="API base URL"
            hint="Leave blank to use the build-time default"
          >
            <input
              className={inputClass}
              defaultValue={localStorage.getItem('recoil_gc_base_url') ?? ''}
              placeholder={import.meta.env.VITE_API_BASE_URL || 'https://api.recoilpay.com'}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v) localStorage.setItem('recoil_gc_base_url', v);
                else localStorage.removeItem('recoil_gc_base_url');
              }}
            />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Sign out"
          detail="Clears the API key from this browser. Your rates stay on the book — pause them first if you want them off."
        />
        <div className="px-5 py-5">
          <Button variant="danger" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </Card>
    </div>
  );
}
