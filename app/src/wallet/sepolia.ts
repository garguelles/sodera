export const SEPOLIA_USDC_ADDRESS = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
export const SEPOLIA_ETH_USD_FEED_ADDRESS = '0x694AA1769357215DE4FAC081bf1f309aDC325306';

export const SEPOLIA_NATIVE_CURRENCY_ADDRESS = '0x0000000000000000000000000000000000000000';
export const SEPOLIA_PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
export const SEPOLIA_UNISWAP_UNIVERSAL_ROUTER_ADDRESS = '0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b';
export const SEPOLIA_UNISWAP_V4_QUOTER_ADDRESS = '0x61B3f2011A92d183C7dbaDBdA940a7555Ccf9227';
export const SEPOLIA_UNISWAP_V4_STATE_VIEW_ADDRESS = '0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C';
export const SEPOLIA_UNISWAP_V4_POOL_MANAGER_ADDRESS = '0xE03A1074c86CFeDd5C142C4F04F1a1536e203543';

// Pinned in docs/research/PRA-212-uniswap-v4-sepolia-route.md; currency0 must sort below currency1.
export const SWAP_POOL_KEY = {
  currency0: SEPOLIA_NATIVE_CURRENCY_ADDRESS,
  currency1: SEPOLIA_USDC_ADDRESS,
  fee: 20,
  tickSpacing: 1,
  hooks: '0x0000000000000000000000000000000000000000',
} as const;
export const SWAP_POOL_ID = '0xc743656d27fde4e2d5895e878557aaa56dd48c8656d25e9db35ba10b1fe3d824';

export function sepoliaTransactionUrl(hash: string) {
  return `https://sepolia.etherscan.io/tx/${hash}`;
}

export function shortenAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
