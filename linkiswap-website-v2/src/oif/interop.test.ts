import { describe, expect, it } from 'vitest';
import { fromInteropAddress, interopAddress } from './interop';

// BSC mainnet USDC — 18 decimals, unlike every other chain's USDC.
const BSC_USDC = '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d';

// Chain references are minimal big-endian, so their length varies by chain:
// a regression for the short ones yields zero quotes rather than an error.
const PREFIXES: [chain: string, chainId: number, prefix: string][] = [
  ['BSC mainnet', 56, '0x000100000138'],
  ['BSC testnet', 97, '0x000100000161'],
  ['opBNB', 204, '0x0001000001cc'],
  ['opBNB testnet', 5611, '0x000100000215eb'],
  ['Base Sepolia', 84532, '0x0001000003014a34'],
  ['OP Sepolia', 11155420, '0x0001000003aa37dc'],
];

describe('ERC-7930 interop addresses', () => {
  it('encodes BSC mainnet USDC byte for byte', () => {
    expect(interopAddress(56, BSC_USDC)).toBe('0x000100000138148ac76a51cc950d9822d68b83fe1ad97b32cd580d');
  });

  it.each(PREFIXES)('encodes the %s (%i) chain reference', (_, chainId, prefix) => {
    const encoded = interopAddress(chainId, BSC_USDC);
    expect(encoded.startsWith(prefix + '14')).toBe(true);
    expect(encoded).toHaveLength(prefix.length + 2 + 40);
  });

  it.each(PREFIXES)('round-trips on %s (%i)', (_, chainId) => {
    const decoded = fromInteropAddress(interopAddress(chainId, BSC_USDC));
    expect(decoded.chainId).toBe(chainId);
    expect(decoded.address).toBe(BSC_USDC.toLowerCase());
  });
});
