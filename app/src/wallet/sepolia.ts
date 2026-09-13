export const SEPOLIA_USDC_ADDRESS = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';

export function sepoliaTransactionUrl(hash: string) {
  return `https://sepolia.etherscan.io/tx/${hash}`;
}

export function shortenAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
