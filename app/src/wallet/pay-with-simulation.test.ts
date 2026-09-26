import { encodeAbiParameters, keccak256, pad, toHex, type Address } from 'viem';

import { simulatePayWith } from './pay-with-simulation';
import { SEPOLIA_USDC_ADDRESS } from './sepolia';

const ACCOUNT: Address = '0x1111111111111111111111111111111111111111';
const PAYEE: Address = '0x2222222222222222222222222222222222222222';
const ROUTER: Address = '0x7E4f6c5e954Da5c61B3423D81E2277431Ac043f3';
const NATIVE = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const TRANSFER = keccak256(toHex('Transfer(address,address,uint256)'));
const request = { account: ACCOUNT, payAsset: 'ETH', receiveAsset: 'USDC', amountOut: '10000000' } as const;

function transfer(token: string, from: Address, to: Address, amount: bigint) {
  return {
    address: token as Address,
    topics: [TRANSFER, pad(from), pad(to)],
    data: encodeAbiParameters([{ type: 'uint256' }], [amount]),
  };
}

function client(logs: ReturnType<typeof transfer>[], status = 'success') {
  return {
    getChainId: jest.fn().mockResolvedValue(11155111),
    simulateBlocks: jest.fn().mockResolvedValue([{ calls: [{ status, logs }] }]),
  };
}

const paid = [
  transfer(NATIVE, ACCOUNT, ROUTER, 1_005n),
  transfer(SEPOLIA_USDC_ADDRESS, ROUTER, ACCOUNT, 10_000_000n),
  transfer(NATIVE, ROUTER, ACCOUNT, 5n),
  transfer(SEPOLIA_USDC_ADDRESS, ACCOUNT, PAYEE, 10_000_000n),
];

function run(logs: ReturnType<typeof transfer>[], status?: string) {
  const simulation = client(logs, status);
  return {
    simulation,
    result: simulatePayWith({
      account: ACCOUNT,
      recipient: PAYEE,
      request,
      maxAmountIn: 1_005n,
      calls: [{ to: ROUTER, value: 1_005n, data: '0x3593564c' }],
      client: simulation as never,
    }),
  };
}

describe('pay with simulation', () => {
  it('reports what the account spent once the payee gets the exact amount', async () => {
    const { simulation, result } = run(paid);
    await expect(result).resolves.toEqual({ spent: 1_000n });
    expect(simulation.simulateBlocks).toHaveBeenCalledWith(expect.objectContaining({ traceTransfers: true }));
  });

  it('rejects failed calls, short payments, overspending and paying from the account balance', async () => {
    await expect(run(paid, 'failure').result).rejects.toThrow('would fail');
    await expect(run(paid.slice(0, 3)).result).rejects.toThrow('exact amount');
    await expect(run([...paid, transfer(NATIVE, ACCOUNT, ROUTER, 6n)]).result).rejects.toThrow('quoted maximum');
    await expect(run([transfer(NATIVE, ACCOUNT, ROUTER, 1_000n), paid[3]]).result).rejects.toThrow('your own USDC');
  });
});
