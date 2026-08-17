import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { RegistrationWizard } from '../components/solver/RegistrationWizard';
import { ContractsEditor } from '../components/solver/ContractsEditor';
import { QuoteMatrix } from '../components/solver/QuoteMatrix';
import { InventoryTable } from '../components/solver/InventoryTable';
import { VaultsBalances } from '../components/solver/VaultsBalances';
import { FillWalletPanel } from '../components/solver/FillWalletPanel';
import { useAuthStore } from '../stores/auth-store';

export type TabId =
  | 'registration'
  | 'contracts'
  | 'submit_quotes'
  | 'inventory'
  | 'telemetry'
  | 'balances'
  | 'fill_worker';

export const SolverTerminalPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const tabParam = searchParams.get('tab') as TabId;
  const [activeTab, setActiveTab] = useState<TabId>(tabParam || 'registration');
  const markOnboardingComplete = useAuthStore((s) => s.markOnboardingComplete);

  useEffect(() => {
    if (tabParam) {
      setActiveTab(tabParam);
    }
  }, [tabParam]);

  return (
    <div className="font-sans max-w-[1400px] mx-auto">
      {/* Main Module Content */}
      <div className="min-h-[600px]">
        {activeTab === 'registration' && (
          <RegistrationWizard
            onRegistered={() => {
              // Wizard succeeded — flip the onboarding flag and drop the
              // operator on the Settings page so they can wire their
              // settlement address (the next onboarding step).
              markOnboardingComplete();
              navigate('/settings?onboarding=true', { replace: true });
            }}
          />
        )}
        {activeTab === 'contracts' && <ContractsEditor />}
        {activeTab === 'submit_quotes' && <QuoteMatrix />}
        {(activeTab === 'inventory' || activeTab === 'telemetry') && <InventoryTable />}
        {activeTab === 'balances' && <VaultsBalances />}
        {/* The fill-worker is hosted by the platform — what the operator
            actually manages is their fill-wallet's gas + inventory. */}
        {activeTab === 'fill_worker' && <FillWalletPanel />}
      </div>
    </div>
  );
};
