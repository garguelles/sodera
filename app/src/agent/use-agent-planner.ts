import { useCallback, useRef, useState } from 'react';
import type { Address } from 'viem';

import type { SepoliaBalanceClient } from '@/wallet/wallet-home-live';

import type { AddressBook } from './address-book';
import { loadAgentContext } from './agent-context';
import { AgentUnavailableError, type AgentClient } from './agent-client';
import { evaluatePolicy, type EnrichedPlan, type Violation } from './policy';

/** Must match the service's PLAN_VALUE_CAP_USD; the phone's check is the one that counts. */
export const PLAN_VALUE_CAP_USD = 250;

export type PlannerState =
  | { phase: 'idle' }
  | { phase: 'planning'; intent: string }
  | { phase: 'plan'; intent: string; plan: EnrichedPlan }
  | { phase: 'question'; intent: string; question: string }
  | { phase: 'blocked'; intent: string; violations: Violation[] }
  | { phase: 'declined'; intent: string; message: string }
  | { phase: 'offline'; intent: string; reason: 'timeout' | 'unavailable' };

/** One exchange in the conversation: the user's sentence and the planner's current answer. */
export type PlannerTurn = { id: number; state: Exclude<PlannerState, { phase: 'idle' }>; signed?: boolean };

export function useAgentPlanner({
  account,
  client,
  balanceClient,
  addressBook,
  now = Date.now,
}: {
  account: Address;
  client: AgentClient;
  balanceClient: () => SepoliaBalanceClient;
  addressBook: AddressBook;
  now?: () => number;
}) {
  const [turns, setTurns] = useState<PlannerTurn[]>([]);
  const request = useRef(0);
  const state: PlannerState = turns.at(-1)?.state ?? { phase: 'idle' };
  // Each request owns the last turn; later answers replace its state.
  const setState = useCallback((next: Exclude<PlannerState, { phase: 'idle' }>, id: number) => {
    setTurns((current) => current.map((turn) => (turn.id === id ? { ...turn, state: next } : turn)));
  }, []);
  // Follow-ups need the server's transcript; start fresh when there is nothing to follow up.
  const conversationOpen = useRef(false);

  const submit = useCallback(
    async (rawIntent: string) => {
      const intent = rawIntent.trim();
      if (!intent) return;
      const current = ++request.current;
      setTurns((existing) => [...existing, { id: current, state: { phase: 'planning', intent } }]);
      try {
        const context = await loadAgentContext({
          account,
          balanceClient: balanceClient(),
          addressBook: addressBook.list(),
          now,
        });
        const response = await client.propose({
          account,
          intent,
          context,
          reset: !conversationOpen.current,
        });
        if (current !== request.current) return;
        conversationOpen.current = true;

        if (response.kind === 'clarification') {
          setState({ phase: 'question', intent, question: response.question }, current);
        } else if (response.kind === 'declined') {
          setState({ phase: 'declined', intent, message: response.message }, current);
        } else if (response.kind === 'rejected') {
          setState({ phase: 'blocked', intent, violations: response.violations as Violation[] }, current);
        } else {
          // The phone re-checks the plan itself; its result wins over the service's.
          const checked = evaluatePolicy(
            { kind: 'plan', summary: response.summary, actions: response.actions, assumptions: response.assumptions },
            context,
            {
              account,
              valueCapUsd: PLAN_VALUE_CAP_USD,
              resolveName: (name) => addressBook.find(name)?.address ?? null,
            },
          );
          if (checked.ok) {
            setState({ phase: 'plan', intent, plan: checked.plan }, current);
          } else {
            console.warn('The phone rejected a plan the planner accepted', checked.violations.map((item) => item.code));
            setState({ phase: 'blocked', intent, violations: checked.violations }, current);
          }
        }
      } catch (error) {
        if (current !== request.current) return;
        conversationOpen.current = false;
        const timedOut = error instanceof AgentUnavailableError && error.reason === 'timeout';
        setState({ phase: 'offline', intent, reason: timedOut ? 'timeout' : 'unavailable' }, current);
      }
    },
    [account, addressBook, balanceClient, client, now, setState],
  );

  const reset = useCallback(() => {
    request.current += 1;
    conversationOpen.current = false;
    setTurns([]);
  }, []);

  /** Marks a plan turn as signed after its review succeeded. */
  const markSigned = useCallback((id: number) => {
    setTurns((current) => current.map((turn) => (turn.id === id ? { ...turn, signed: true } : turn)));
  }, []);

  return { state, turns, submit, reset, markSigned };
}
