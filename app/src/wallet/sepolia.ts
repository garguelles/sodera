export const SEPOLIA_USDC_ADDRESS = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
export const SEPOLIA_ETH_USD_FEED_ADDRESS = '0x694AA1769357215DE4FAC081bf1f309aDC325306';

export function sepoliaTransactionUrl(hash: string) {
  return `https://sepolia.etherscan.io/tx/${hash}`;
}

export function shortenAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
