/**
 * ERC-7930 InteropAddress encoding.
 *
 * Ported faithfully from the OIF aggregator demo
 * (`oif-aggregator/demo/src/utils/interopAddress.ts`). The aggregator expects
 * addresses as ERC-7930 "interop" hex strings (NOT plain `0x` addresses): get the
 * encoding wrong and `/quotes` returns zero quotes or an error.
 *
 * Format per EIP-7930:
 *   0x [version(2 bytes)] [chainType(2 bytes)] [chainRefLen(1)] [chainRef] [addrLen(1)] [address]
 *
 * version    = 0x0001
 * chainType  = 0x0000 (EIP-155)
 * chainRef   = chainId as minimal big-endian bytes
 * address    = the 20-byte EVM address
 */

/** An ERC-7930 interop address, hex-encoded. */
export type InteropAddress = `0x${string}`;

/** Convert a hex string to a byte array (tolerates a leading `0x`). */
function hexToBytes(hex: string): number[] {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes: number[] = [];
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes.push(parseInt(cleanHex.slice(i, i + 2), 16));
  }
  return bytes;
}

/** Convert a byte array to a `0x`-prefixed hex string. */
function bytesToHex(bytes: number[]): string {
  return '0x' + bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Convert a chain id to minimal big-endian bytes (at least one byte). */
function chainIdToBytes(chainId: number): number[] {
  const bytes: number[] = [];
  let value = chainId;
  while (value > 0) {
    bytes.unshift(value & 0xff);
    value >>= 8;
  }
  if (bytes.length === 0) bytes.push(0);
  return bytes;
}

/** Convert big-endian bytes back to a chain id number. */
function bytesToChainId(bytes: number[]): number {
  return bytes.reduce((acc, byte) => (acc << 8) | byte, 0);
}

/**
 * Encode a standard EVM address + chain id into an ERC-7930 InteropAddress.
 *
 * Faithful port — argument order matches the demo: `(address, chainId)`.
 */
export function toInteropAddress(address: string, chainId: number): InteropAddress {
  // Version: 2 bytes big-endian (0x0001)
  const version = '0001';
  // Chain type: EIP-155 (0x0000)
  const chainType = '0000';

  // Encode chain id as minimal big-endian.
  const chainRefBytes = chainIdToBytes(chainId);
  const chainRefHex = bytesToHex(chainRefBytes).slice(2);
  const chainRefLength = chainRefBytes.length.toString(16).padStart(2, '0');

  // Address bytes.
  const addressBytes = hexToBytes(address);
  const addressHex = bytesToHex(addressBytes).slice(2);
  const addressLength = addressBytes.length.toString(16).padStart(2, '0');

  return `0x${version}${chainType}${chainRefLength}${chainRefHex}${addressLength}${addressHex}`;
}

export function interopAddress(chainId: number, address: string): InteropAddress {
  return toInteropAddress(address, chainId);
}

/** Decode an ERC-7930 InteropAddress back into `{ address, chainId }`. */
export function fromInteropAddress(interopHex: string): {
  address: `0x${string}`;
  chainId: number;
} {
  const hex = interopHex.startsWith('0x') ? interopHex.slice(2) : interopHex;

  let offset = 0;
  offset += 4; // skip version (2 bytes)
  offset += 4; // skip chain type (2 bytes)

  const chainRefLength = parseInt(hex.slice(offset, offset + 2), 16);
  offset += 2;

  const chainRefHex = hex.slice(offset, offset + chainRefLength * 2);
  const chainId = bytesToChainId(hexToBytes('0x' + chainRefHex));
  offset += chainRefLength * 2;

  const addressLength = parseInt(hex.slice(offset, offset + 2), 16);
  offset += 2;

  const addressHex = hex.slice(offset, offset + addressLength * 2);
  return { address: `0x${addressHex}`, chainId };
}
