import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './globals.css';
import './i18n';
import App from './App';
import { WalletProvider } from './wallet/WalletProvider';
import { ThemeProvider } from './components/ThemeProvider';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <WalletProvider>
        <App />
      </WalletProvider>
    </ThemeProvider>
  </StrictMode>
);
