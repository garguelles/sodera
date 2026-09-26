import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { getAddress, type Hash } from 'viem';

import { pendingPlan } from '@/agent/pending-plan';
import type { EnrichedPlan } from '@/agent/policy';
import type {
  KernelOperationEvidence,
  KernelOperationReview,
  KernelPasskeyExecutionClient,
} from '@/wallet/kernel-passkey-execution';
import type { PasskeyCeremonyClient, RegisteredPrimaryPasskey } from '@/wallet/passkey-ceremony';
import { CURRENT_WALLET_IDENTITY_PINS, type WalletIdentityStorage } from '@/wallet/wallet-identity';

import { PlanReviewScreen } from './plan-review-screen';

jest.mock('expo-router', () => ({ router: { back: jest.fn() } }));
jest.mock('@/launcher/default-home', () => ({ defaultHomeClient: {} }));
jest.mock('@/wallet/passkey-native-adapter', () => ({ passkeyNativeAdapter: {} }));
jest.mock('@/wallet/wallet-identity-native-storage', () => ({
  walletIdentityNativeStorage: { read: jest.fn(), write: jest.fn(), clear: jest.fn() },
}));

const account = '0x1111111111111111111111111111111111111111' as const;
const ALICE = getAddress('0x2222222222222222222222222222222222222222');
const operationHash = `0x${'33'.repeat(32)}` as Hash;
const transactionHash = `0x${'44'.repeat(32)}` as Hash;
const credential: RegisteredPrimaryPasskey = {
  id: 'credential',
  publicKeyX: `0x${'11'.repeat(32)}`,
  publicKeyY: `0x${'22'.repeat(32)}`,
  aaguid: `0x${'00'.repeat(16)}`,
  origin: 'android:apk-key-hash:-sYXRdwJA3hvue3mKpYrOZ9zSPC7b4mbgzJmdZEDO5w',
  authenticatorAttachment: 'platform',
};
const plan: EnrichedPlan = {
  summary: 'Send 0.01 ETH to alice.',
  assumptions: [],
  totalUsdCents: 2600n,
  actions: [
    {
      action: { type: 'send_eth', recipient: { kind: 'name', value: 'alice' }, amount: '0.01' },
      asset: 'ETH',
      amountBase: 10_000_000_000_000_000n,
      recipient: { address: ALICE, name: 'alice' },
      usdCents: 2600n,
    },
  ],
};

function review(
  calls: KernelOperationReview['calls'] = [{ to: ALICE, valueWei: '10000000000000000', data: '0x' }],
): KernelOperationReview {
  return {
    userOperationHash: operationHash,
    account,
    chain: 'Ethereum Sepolia',
    chainId: 11155111,
    entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
    validator: '0x7ab16Ff354AcB328452F1D445b3Ddee9a91e9e69',
    deploymentRequired: false,
    calls,
    sponsored: true,
    paymaster: '0x5555555555555555555555555555555555555555',
    maximumNetworkFeeWei: '1000',
    userOperation: { sender: account, nonce: '1' },
  };
}

function executionClient(prepared = review()): KernelPasskeyExecutionClient {
  return {
    account,
    deployed: true,
    prepare: jest.fn().mockResolvedValue(prepared),
    execute: jest.fn().mockResolvedValue({ userOperationHash: operationHash, transactionHash, account } as unknown as KernelOperationEvidence),
    submit: jest.fn(),
    waitForConfirmation: jest.fn(),
  };
}

function storage(): WalletIdentityStorage {
  const value = JSON.stringify({ schemaVersion: 1, phase: 'accountDeployed', pins: CURRENT_WALLET_IDENTITY_PINS, credential, account });
  return { read: async () => value, write: async () => undefined, clear: async () => undefined };
}

const ceremonyClient = { cancelPending: jest.fn() } as unknown as PasskeyCeremonyClient;

async function show(client: KernelPasskeyExecutionClient) {
  await render(
    <PlanReviewScreen ceremonyClient={ceremonyClient} createExecutionClient={jest.fn().mockResolvedValue(client)} storage={storage()} />,
  );
}

describe('PlanReviewScreen', () => {
  beforeEach(() => {
    pendingPlan.complete();
    pendingPlan.consumeCompleted();
  });

  it('prepares the encoded plan, confirms with the passkey, and marks the plan complete', async () => {
    pendingPlan.set({ plan, intent: 'send 0.01 eth to alice' });
    const client = executionClient();
    await show(client);

    expect(await screen.findByText('Does this look right?')).toBeOnTheScreen();
    expect(client.prepare).toHaveBeenCalledWith([{ to: ALICE, value: 10_000_000_000_000_000n, data: '0x' }]);
    expect(screen.getByText('Send 0.01 ETH to alice')).toBeOnTheScreen();
    expect(screen.getByText('Sponsored')).toBeOnTheScreen();
    expect(client.execute).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Confirm with passkey' }));
    });
    expect(client.execute).toHaveBeenCalledWith(operationHash);
    expect(await screen.findByText('Plan completed')).toBeOnTheScreen();
    expect(pendingPlan.get()).toBeNull();
    expect(pendingPlan.consumeCompleted()).toBe(true);
  });

  it('refreshes an expired swap quote instead of signing it', async () => {
    const swapPlan: EnrichedPlan = {
      summary: 'Swap 0.01 ETH for USDC.',
      assumptions: [],
      totalUsdCents: 2600n,
      actions: [
        {
          action: { type: 'swap', direction: 'eth_to_usdc', amountIn: '0.01' },
          asset: 'ETH',
          amountBase: 10_000_000_000_000_000n,
          recipient: null,
          usdCents: 2600n,
        },
      ],
    };
    pendingPlan.set({ plan: swapPlan, intent: 'swap' });
    let clock = Date.parse('2026-09-26T08:00:00Z');
    const quoteSwap = jest.fn().mockResolvedValue({ amountOut: 26_000_000n, minAmountOut: 25_870_000n });
    const client = executionClient();
    jest.mocked(client.prepare).mockImplementation(async (calls = []) =>
      review(calls.map((call) => ({ to: call.to, valueWei: call.value.toString(), data: call.data }))),
    );
    await render(
      <PlanReviewScreen
        ceremonyClient={ceremonyClient}
        createExecutionClient={jest.fn().mockResolvedValue(client)}
        encoder={{ quoteSwap, now: () => clock }}
        storage={storage()}
      />,
    );

    expect(await screen.findByText('Swap 0.01 ETH for ~26 USDC')).toBeOnTheScreen();
    clock += 10 * 60 * 1000;
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Confirm with passkey' }));
    });

    expect(await screen.findByText('The swap quote expired, so it was refreshed. Check the amounts again.')).toBeOnTheScreen();
    expect(quoteSwap).toHaveBeenCalledTimes(2);
    expect(client.execute).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Confirm with passkey' }));
    });
    expect(client.execute).toHaveBeenCalledTimes(1);
  });

  it('refuses a prepared operation that differs from the plan', async () => {
    pendingPlan.set({ plan, intent: 'x' });
    const client = executionClient(review([{ to: ALICE, valueWei: '20000000000000000', data: '0x' }]));
    await show(client);

    expect(await screen.findByText('The prepared operation does not match the plan')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Confirm with passkey' })).not.toBeOnTheScreen();
  });

  it('explains when there is no plan to review', async () => {
    await show(executionClient());
    expect(await screen.findByText('There is no plan to review. Ask Dera again.')).toBeOnTheScreen();
  });
});
