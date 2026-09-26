import type { Address } from 'viem';

import { MULTIBAAS_CONTRACTS, type MultiBaasClient } from './multibaas';
import type { SepoliaBalanceClient } from './wallet-home-live';

/**
 * Wallet home reads through MultiBaas: chain status, the account's ETH balance from the address
 * endpoint, and USDC and Chainlink reads through the contract-call API. The address endpoint
 * works for any address, including wallets MultiBaas does not track.
 */
export function createMultiBaasBalanceClient({
  client,
}: {
  client: MultiBaasClient;
}): SepoliaBalanceClient {
  return {
    async getChainId() {
      const status = await client.getChainStatus();
      const chainId = Number(status.chainID);
      if (!Number.isSafeInteger(chainId)) throw new Error('MultiBaas returned invalid data');
      return chainId;
    },
    async getBalance({ address }) {
      const result = await client.getAddress(address, ['balance']);
      return parseUint(result.balance);
    },
    async readContract({ address, functionName, args }) {
      const label = labelFor(address);
      const output = await client.callMethod(address, label, functionName, args ?? []);
      if (functionName === 'decimals') {
        const decimals = Number(parseUint(output));
        return decimals;
      }
      if (functionName === 'balanceOf') return parseUint(output);
      if (!Array.isArray(output) || output.length !== 5) {
        throw new Error('MultiBaas returned invalid data');
      }
      // roundId, answer, startedAt, updatedAt, answeredInRound
      return output.map(parseInteger) as unknown as readonly [bigint, bigint, bigint, bigint, bigint];
    },
  };
}

function labelFor(address: Address) {
  const contract = Object.values(MULTIBAAS_CONTRACTS).find(
    (candidate) => candidate.address.toLowerCase() === address.toLowerCase(),
  );
  if (!contract) throw new Error(`MultiBaas has no linked contract for ${address}`);
  return contract.label;
}

function parseUint(value: unknown) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new Error('MultiBaas returned invalid data');
  return BigInt(value);
}

function parseInteger(value: unknown) {
  if (typeof value !== 'string' || !/^-?\d+$/.test(value)) throw new Error('MultiBaas returned invalid data');
  return BigInt(value);
}
