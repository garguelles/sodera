export const SEPOLIA_USDC_ADDRESS = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
export const SEPOLIA_ETH_USD_FEED_ADDRESS = '0x694AA1769357215DE4FAC081bf1f309aDC325306';

export const SEPOLIA_PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
export const SEPOLIA_UNISWAP_UNIVERSAL_ROUTER_ADDRESS = '0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b';
/** Universal Router 2.1.2, which the Trading API targets for Pay with. Its Permit2 allowances are separate. */
export const SEPOLIA_UNISWAP_TRADING_ROUTER_ADDRESS = '0x7E4f6c5e954Da5c61B3423D81E2277431Ac043f3';
export const SEPOLIA_WETH_ADDRESS = '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14';
export const SEPOLIA_UNISWAP_V4_QUOTER_ADDRESS = '0x61B3f2011A92d183C7dbaDBdA940a7555Ccf9227';
export const SEPOLIA_UNISWAP_V4_STATE_VIEW_ADDRESS = '0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C';
export const SEPOLIA_UNISWAP_V4_POOL_MANAGER_ADDRESS = '0xE03A1074c86CFeDd5C142C4F04F1a1536e203543';
/** 1inch's own Sepolia deployments; see docs/research/aqua-swapvm-sepolia.md. */
export const SEPOLIA_AQUA_ADDRESS = '0x1111113ccf1426a8e30e2bff5e005d929bf6a90a';
export const SEPOLIA_AQUA_SWAP_VM_ROUTER_ADDRESS = '0x1111113Db0e0ef9D0E3A50d5f094a3a57a26C0DE';

export function sepoliaTransactionUrl(hash: string) {
  return `https://sepolia.etherscan.io/tx/${hash}`;
}

export function shortenAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
