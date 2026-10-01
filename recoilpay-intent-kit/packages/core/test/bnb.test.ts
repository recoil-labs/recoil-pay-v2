import { describe, expect, it } from 'vitest';
import { chainName, explorerUrl } from '../src/chains';
import type { SolverAsset } from '../src/oif/types';
import { buildSupportedSet, normalizeChain } from '../src/intent/registry';
import { resolveIntent } from '../src/intent/resolve';
import type { RawIntent } from '../src/intent/types';
import { validateIntent } from '../src/intent/validate';

const USER = '0x632BF0D0d6468908378C3ccfAC4E788B115e0E55';

// What the live solvers advertise on testnet: BSC testnet's mock USDC is 6
// decimals, like every other testnet USDC.
const BSC_TESTNET_USDC: SolverAsset = {
  address: '0x67bF9ba31f64de698EfD23c2CB0208191A5C2A9e',
  chainId: 97,
  symbol: 'USDC',
  name: 'USD Coin',
  decimals: 6,
};
const BASE_SEPOLIA_USDC: SolverAsset = {
  address: '0x73c83DAcc74bB8a704717AC09703b959E74b9705',
  chainId: 84532,
  symbol: 'USDC',
  name: 'USD Coin',
  decimals: 6,
};

const swap = (chainIn: string, chainOut: string): RawIntent => ({
  action: 'swap',
  amount: '10',
  amountKind: 'token',
  tokenIn: 'USDC',
  chainIn,
  tokenOut: 'USDC',
  chainOut,
  recipient: null,
});

describe('BNB Chain aliases', () => {
  it.each([
    ['bsc', 56],
    ['bnb', 56],
    ['BNB Chain', 56],
    ['binance smart chain', 56],
    ['bsc testnet', 97],
    ['BNB testnet', 97],
    ['opbnb', 204],
  ])('%s → chain %i', (alias, id) => {
    expect(normalizeChain(alias)?.id).toBe(id);
  });

  it('accepts BSC testnet ↔ Base Sepolia in both directions once solvers advertise it', () => {
    const supported = buildSupportedSet([BSC_TESTNET_USDC, BASE_SEPOLIA_USDC]);
    expect(validateIntent(swap('bsc testnet', 'base sepolia'), supported)).toEqual([]);
    expect(validateIntent(swap('base sepolia', 'bnb testnet'), supported)).toEqual([]);
  });

  it('treats bare "bsc" as mainnet, unsupported until a mainnet solver exists', () => {
    const supported = buildSupportedSet([BSC_TESTNET_USDC, BASE_SEPOLIA_USDC]);
    expect(validateIntent(swap('bsc', 'base sepolia'), supported)).toContainEqual(
      expect.objectContaining({ field: 'chainIn', kind: 'unsupported' }),
    );
  });
});

describe('per-chain decimals', () => {
  it('scales by the advertised decimals, not a global 6 (BSC mainnet USDC is 18)', () => {
    const bscUsdc18: SolverAsset = {
      ...BSC_TESTNET_USDC,
      address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
      chainId: 56,
      decimals: 18,
    };
    const supported = buildSupportedSet([bscUsdc18, BSC_TESTNET_USDC, BASE_SEPOLIA_USDC]);

    expect(resolveIntent(swap('bsc', 'base sepolia'), supported, USER).inputAmount).toBe(10n * 10n ** 18n);
    expect(resolveIntent(swap('bsc testnet', 'base sepolia'), supported, USER).inputAmount).toBe(10_000_000n);
  });
});

describe('BNB Chain display', () => {
  it.each([
    [56, 'BNB Chain', 'https://bscscan.com'],
    [97, 'BNB Chain Testnet', 'https://testnet.bscscan.com'],
    [204, 'opBNB', 'https://opbnb.bscscan.com'],
    [5611, 'opBNB Testnet', 'https://testnet.opbnbscan.com'],
  ])('chain %i is named and has an explorer', (id, name, explorer) => {
    expect(chainName(id)).toBe(name);
    expect(explorerUrl(id)).toBe(explorer);
  });
});
