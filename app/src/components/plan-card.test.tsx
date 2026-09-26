import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { getAddress } from 'viem';

import type { EnrichedPlan } from '@/agent/policy';

import { describeRange, PLANNING_STEP_MS, PlanCard } from './plan-card';

const ALICE = getAddress('0x2222222222222222222222222222222222222222');
const plan: EnrichedPlan = {
  summary: 'Send 0.01 ETH to alice.',
  assumptions: ['Network: Ethereum Sepolia'],
  totalUsdCents: 2687n,
  actions: [
    {
      action: { type: 'send_eth', recipient: { kind: 'name', value: 'alice' }, amount: '0.01' },
      asset: 'ETH',
      amountBase: 10_000_000_000_000_000n,
      recipient: { address: ALICE, name: 'alice' },
      usdCents: 2687n,
    },
  ],
};

async function press(element: Parameters<typeof fireEvent.press>[0]) {
  await act(async () => {
    fireEvent.press(element);
  });
}

function handlers() {
  return { onReview: jest.fn(), onOpenSend: jest.fn(), onOpenSwap: jest.fn() };
}

describe('PlanCard', () => {
  it('cycles its planning caption', async () => {
    jest.useFakeTimers();
    await render(<PlanCard state={{ phase: 'planning', intent: 'x' }} {...handlers()} />);
    expect(screen.getByText('PLANNING…')).toBeOnTheScreen();
    expect(screen.getByText('checking balances')).toBeOnTheScreen();
    await act(async () => {
      jest.advanceTimersByTime(PLANNING_STEP_MS);
    });
    expect(screen.getByText('resolving names')).toBeOnTheScreen();
    jest.useRealTimers();
  });

  it('shows a checked plan with its actions, assumptions, and buttons', async () => {
    const actions = handlers();
    await render(<PlanCard state={{ phase: 'plan', intent: 'send 0.01 eth to alice', plan }} {...actions} />);

    expect(screen.getByText('PLAN · 1 ACTION')).toBeOnTheScreen();
    expect(screen.getByLabelText('Checked on device')).toBeOnTheScreen();
    expect(screen.getByText('Send 0.01 ETH to alice.')).toBeOnTheScreen();
    expect(screen.getByText('Send 0.01 ETH to alice')).toBeOnTheScreen();
    expect(screen.getByText('address book · 0x2222...2222')).toBeOnTheScreen();
    expect(screen.getByText('· Network: Ethereum')).toBeOnTheScreen();
    expect(screen.getByText('shown at review')).toBeOnTheScreen();

    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeOnTheScreen();
    await press(screen.getByRole('button', { name: 'Review & sign' }));
    expect(actions.onReview).toHaveBeenCalledWith(plan);
  });

  it('shows SPONSORED when sponsored operations remain and hides empty assumptions', async () => {
    await render(
      <PlanCard state={{ phase: 'plan', intent: 'x', plan: { ...plan, assumptions: [] } }} sponsoredRemaining={3} {...handlers()} />,
    );
    expect(screen.getByText('SPONSORED')).toBeOnTheScreen();
    expect(screen.queryByText('ASSUMPTIONS')).not.toBeOnTheScreen();
  });

  it('shows an answer with its figures and source, and nothing to sign', async () => {
    await render(
      <PlanCard
        state={{
          phase: 'answer',
          intent: 'how much did I send alice this month?',
          answer: {
            text: 'You sent 42.5 USDC to alice this month.',
            facts: [
              { label: 'Sent to alice', value: '42.5 USDC' },
              { label: 'Received from alice', value: '0 USDC' },
            ],
            source: { from: '2026-09-01', to: '2026-09-27' },
          },
        }}
        {...handlers()}
      />,
    );
    expect(screen.getByText('ANSWER')).toBeOnTheScreen();
    expect(screen.getByText('You sent 42.5 USDC to alice this month.')).toBeOnTheScreen();
    expect(screen.getByText('42.5 USDC')).toBeOnTheScreen();
    expect(screen.getByText('From MultiBaas · Sep 1 – Sep 26, 2026 UTC')).toBeOnTheScreen();
    expect(
      screen.getByLabelText(
        'You sent 42.5 USDC to alice this month. Sent to alice, 42.5 USDC. Received from alice, 0 USDC. From MultiBaas, Sep 1 – Sep 26, 2026 UTC',
      ),
    ).toBeOnTheScreen();
    expect(screen.queryByRole('button')).not.toBeOnTheScreen();
  });

  it('explains an unbacked answer without offering a manual screen', async () => {
    await render(
      <PlanCard
        state={{
          phase: 'blocked',
          intent: 'what is my eth worth?',
          violations: [{ code: 'ungrounded', actionIndex: null, message: "Some figures in the answer didn't match your wallet data." }],
        }}
        {...handlers()}
      />,
    );
    expect(screen.getByText("Dera couldn't back up that answer.")).toBeOnTheScreen();
    expect(screen.queryByRole('button')).not.toBeOnTheScreen();
  });

  it('omits the source line for answers from the wallet snapshot', async () => {
    await render(
      <PlanCard
        state={{ phase: 'answer', intent: 'x', answer: { text: 'You have 100 USDC.', facts: [], source: null } }}
        {...handlers()}
      />,
    );
    expect(screen.getByText('You have 100 USDC.')).toBeOnTheScreen();
    expect(screen.queryByText(/From MultiBaas/)).not.toBeOnTheScreen();
  });

  it('asks for one detail', async () => {
    await render(
      <PlanCard state={{ phase: 'question', intent: 'send some eth to alice', question: 'How much ETH?' }} {...handlers()} />,
    );
    expect(screen.getByText('NEEDS ONE DETAIL')).toBeOnTheScreen();
    expect(screen.getByText('How much ETH?')).toBeOnTheScreen();
    expect(screen.getByText('reply below')).toBeOnTheScreen();
    expect(screen.queryByText(/you said/)).not.toBeOnTheScreen();
    expect(screen.queryByRole('button')).not.toBeOnTheScreen();
  });

  it('explains a block and opens Send, or Swap for disabled swaps', async () => {
    const actions = handlers();
    const view = await render(
      <PlanCard
        state={{
          phase: 'blocked',
          intent: 'x',
          violations: [{ code: 'insufficient_eth', actionIndex: null, message: 'You have 1.24 ETH. This plan needs 100 ETH.' }],
        }}
        {...actions}
      />,
    );
    expect(screen.getByText('BLOCKED · SAFETY CHECK')).toBeOnTheScreen();
    expect(screen.getByText("You don't have enough ETH.")).toBeOnTheScreen();
    expect(screen.getByText('You have 1.24 ETH. This plan needs 100 ETH.')).toBeOnTheScreen();
    await press(screen.getByRole('button', { name: 'Open Send' }));
    expect(actions.onOpenSend).toHaveBeenCalled();

    await view.rerender(
      <PlanCard
        state={{ phase: 'blocked', intent: 'x', violations: [{ code: 'action_disabled', actionIndex: 0, message: 'Swaps are not available yet.' }] }}
        {...actions}
      />,
    );
    await press(screen.getByRole('button', { name: 'Open Swap' }));
    expect(actions.onOpenSwap).toHaveBeenCalled();
  });

  it('keeps the wallet usable when the planner is offline or declines', async () => {
    const actions = handlers();
    const view = await render(<PlanCard state={{ phase: 'offline', intent: 'x', reason: 'unavailable' }} {...actions} />);
    expect(screen.getByText('PLANNER OFFLINE')).toBeOnTheScreen();
    expect(screen.getByText("Can't reach the planner right now.")).toBeOnTheScreen();
    expect(screen.getByText('Your wallet works as usual.')).toBeOnTheScreen();
    await press(screen.getByRole('button', { name: 'Open Send' }));
    expect(actions.onOpenSend).toHaveBeenCalled();

    await view.rerender(<PlanCard state={{ phase: 'offline', intent: 'x', reason: 'timeout' }} {...actions} />);
    expect(screen.getByText('PLANNER TOOK TOO LONG')).toBeOnTheScreen();
    expect(screen.getByText('The planner took too long to answer.')).toBeOnTheScreen();
    expect(screen.queryByText('PLANNER OFFLINE')).not.toBeOnTheScreen();

    await view.rerender(<PlanCard state={{ phase: 'declined', intent: 'x', message: 'Use the manual screens.' }} {...actions} />);
    expect(screen.getByText("CAN'T HELP WITH THAT")).toBeOnTheScreen();
    expect(screen.getByText('Use the manual screens.')).toBeOnTheScreen();
  });
});

describe('PlanCard in a conversation', () => {
  it('keeps earlier answers readable but without buttons', async () => {
    await render(<PlanCard active={false} state={{ phase: 'plan', intent: 'x', plan }} {...handlers()} />);
    expect(screen.getByText('Send 0.01 ETH to alice')).toBeOnTheScreen();
    expect(screen.queryByRole('button')).not.toBeOnTheScreen();
  });

  it('shows a signed plan without the review button', async () => {
    await render(<PlanCard signed state={{ phase: 'plan', intent: 'x', plan }} {...handlers()} />);
    expect(screen.getByLabelText('Signed')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Review & sign' })).not.toBeOnTheScreen();
  });
});

describe('describeRange', () => {
  it('shows the last included day, and the start year only when it differs', () => {
    expect(describeRange({ from: '2026-09-26', to: '2026-09-27' })).toBe('Sep 26, 2026 UTC');
    expect(describeRange({ from: '2025-12-01', to: '2026-01-08' })).toBe('Dec 1, 2025 – Jan 7, 2026 UTC');
    expect(describeRange({ from: 'nope', to: '2026-01-08' })).toBeNull();
  });
});
