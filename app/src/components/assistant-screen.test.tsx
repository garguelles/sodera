import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { getAddress } from 'viem';

import { createAddressBook } from '@/agent/address-book';
import { AgentUnavailableError, type AgentClient, type ProposeResponse } from '@/agent/agent-client';
import { pendingPlan } from '@/agent/pending-plan';

import { AssistantScreen } from './assistant-screen';

let focusEffect: (() => void) | null = null;
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void) => {
    focusEffect = effect;
    jest.requireActual('react').useEffect(effect, [effect]);
  },
}));
jest.mock('@/launcher/default-home', () => ({ defaultHomeClient: {} }));
jest.mock('@/wallet/wallet-identity-native-storage', () => ({ walletIdentityNativeStorage: {} }));

const ACCOUNT = getAddress('0x1111111111111111111111111111111111111111');
const ALICE = '0x2222222222222222222222222222222222222222';

function balances() {
  const now = Date.now();
  return {
    getChainId: jest.fn().mockResolvedValue(11155111),
    getBalance: jest.fn().mockResolvedValue(500_000_000_000_000_000n),
    readContract: jest.fn(async ({ functionName }: { functionName: string }) =>
      functionName === 'balanceOf' ? 20_000_000n : functionName === 'decimals' ? 8 : [1n, 260_000_000_000n, 0n, BigInt(Math.floor(now / 1000) - 60), 1n],
    ),
  };
}

const plan = (amount: string): ProposeResponse => ({
  kind: 'plan',
  summary: `Send ${amount} ETH to alice.`,
  actions: [{ type: 'send_eth', recipient: { kind: 'name', value: 'alice' }, amount }],
  assumptions: [],
  enriched: {},
});

async function setup(responses: (ProposeResponse | Error)[]) {
  const propose = jest.fn();
  for (const response of responses) {
    if (response instanceof Error) propose.mockRejectedValueOnce(response);
    else propose.mockResolvedValueOnce(response);
  }
  const handlers = { onBack: jest.fn(), onOpenPlan: jest.fn(), onOpenSend: jest.fn(), onOpenSwap: jest.fn() };
  const balanceClient = balances();
  await render(
    <AssistantScreen
      account={ACCOUNT}
      addressBook={createAddressBook(`alice=${ALICE}`)}
      balanceClient={() => balanceClient}
      client={{ propose } as unknown as AgentClient}
      config={{ baseUrl: 'http://localhost', token: 't' }}
      {...handlers}
    />,
  );
  return { propose, ...handlers };
}

async function say(sentence: string) {
  await act(async () => {
    fireEvent.changeText(screen.getByLabelText('Wallet intent'), sentence);
  });
  await act(async () => {
    fireEvent.press(screen.getByRole('button', { name: 'Plan' }));
  });
}

describe('AssistantScreen', () => {
  beforeEach(() => {
    pendingPlan.complete();
    pendingPlan.consumeCompleted();
  });

  it('starts with an empty state and suggestions that fill the bar', async () => {
    await setup([]);
    expect(screen.getByText('Ask Dera')).toBeOnTheScreen();
    expect(screen.getByPlaceholderText('Ask Dera')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'New chat' })).not.toBeOnTheScreen();

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Try: send 2 usdc to alice' }));
    });
    expect(screen.getByLabelText('Wallet intent').props.value).toBe('send 2 usdc to alice');
  });

  it('keeps the conversation and only lets the latest plan be signed', async () => {
    const { propose, onOpenPlan } = await setup([plan('0.01'), plan('0.02')]);
    await say('send 0.01 eth to alice');
    await say('make it 0.02 instead');

    expect(screen.getByText('send 0.01 eth to alice')).toBeOnTheScreen();
    expect(screen.getByText('make it 0.02 instead')).toBeOnTheScreen();
    expect(screen.getByText('Send 0.01 ETH to alice')).toBeOnTheScreen();
    expect(screen.getByText('Send 0.02 ETH to alice')).toBeOnTheScreen();
    expect(propose.mock.calls[1][0]).toMatchObject({ reset: false });
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeOnTheScreen();
    expect(screen.getAllByRole('button', { name: 'Review & sign' })).toHaveLength(1);
    expect(screen.getByPlaceholderText('Follow up, e.g. "make it 0.02 instead"')).toBeOnTheScreen();

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Review & sign' }));
    });
    expect(onOpenPlan).toHaveBeenCalled();
    expect(pendingPlan.get()?.plan.actions[0].amountBase).toBe(20_000_000_000_000_000n);

    pendingPlan.complete();
    await act(async () => {
      focusEffect?.();
    });
    expect(screen.getByLabelText('Signed')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Review & sign' })).not.toBeOnTheScreen();
  });

  it('asks for a reply after a question and starts over with New chat', async () => {
    const { propose } = await setup([{ kind: 'clarification', question: 'How much ETH?' }, plan('0.01')]);
    await say('send some eth to alice');

    expect(screen.getByText('How much ETH?')).toBeOnTheScreen();
    expect(screen.getByText('reply below')).toBeOnTheScreen();
    expect(screen.queryByText(/you said/)).not.toBeOnTheScreen();
    expect(screen.getByPlaceholderText('Reply here')).toBeOnTheScreen();

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'New chat' }));
    });
    expect(screen.queryByText('How much ETH?')).not.toBeOnTheScreen();
    expect(screen.getByText('Ask Dera')).toBeOnTheScreen();
    await say('send 0.01 eth to alice');
    expect(propose.mock.calls[1][0].reset).toBe(true);
  });

  it('answers questions without a review step and keeps the conversation open', async () => {
    const { propose, onOpenPlan } = await setup([
      {
        kind: 'answer',
        text: 'You sent 42.5 USDC to alice this month.',
        facts: [{ label: 'Sent to alice', value: '42.5 USDC' }],
        source: { from: '2026-09-01', to: '2026-09-27' },
      },
      plan('0.01'),
    ]);
    await say('how much did I send alice this month?');

    expect(screen.getByText('You sent 42.5 USDC to alice this month.')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Review & sign' })).not.toBeOnTheScreen();
    expect(screen.getByPlaceholderText('Follow up, e.g. "make it 0.02 instead"')).toBeOnTheScreen();
    expect(onOpenPlan).not.toHaveBeenCalled();

    await say('send 0.01 eth to alice');
    expect(propose.mock.calls[1][0]).toMatchObject({ reset: false });
    expect(screen.getAllByRole('button', { name: 'Review & sign' })).toHaveLength(1);
  });

  it('shows the timeout card inside the conversation', async () => {
    const { onOpenSend } = await setup([new AgentUnavailableError('The planner took too long to answer', 'timeout')]);
    await say('give me a summary');

    expect(screen.getByText('PLANNER TOOK TOO LONG')).toBeOnTheScreen();
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Open Send' }));
    });
    expect(onOpenSend).toHaveBeenCalled();
  });
});
