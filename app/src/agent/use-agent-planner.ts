import { useCallback, useRef, useState } from 'react';
import type { Address } from 'viem';

import { expandSoderaName, resolveSepoliaRecipient } from '@/wallet/send-transfer';
import type { SepoliaBalanceClient } from '@/wallet/wallet-home-live';

import { loadAgentContext } from './agent-context';
import { AgentUnavailableError, type AgentClient } from './agent-client';
import { evaluatePolicy, type EnrichedPlan, type Violation } from './policy';
import type { Action } from './schema';

/** Must match the service's PLAN_VALUE_CAP_USD; the phone's check is the one that counts. */
export const PLAN_VALUE_CAP_USD = 250;

export type PlannerState =
  | { phase: 'idle' }
  | { phase: 'planning'; intent: string }
  | { phase: 'plan'; intent: string; plan: EnrichedPlan }
  | { phase: 'question'; intent: string; question: string }
  | { phase: 'answer'; intent: string; answer: PlannerAnswer }
  | { phase: 'blocked'; intent: string; violations: Violation[] }
  | { phase: 'declined'; intent: string; message: string }
  | { phase: 'offline'; intent: string; reason: 'timeout' | 'unavailable' };

/** A reply about the wallet rather than a plan; it needs no review or signature. */
export type PlannerAnswer = {
  text: string;
  facts: { label: string; value: string }[];
  source: { from: string; to: string } | null;
};

/** One exchange in the conversation: the user's sentence and the planner's current answer. */
export type PlannerTurn = { id: number; state: Exclude<PlannerState, { phase: 'idle' }>; signed?: boolean };

export function useAgentPlanner({
  account,
  client,
  balanceClient,
  resolveRecipient = resolveSepoliaRecipient,
  now = Date.now,
}: {
  account: Address;
  client: AgentClient;
  balanceClient: () => SepoliaBalanceClient;
  resolveRecipient?: typeof resolveSepoliaRecipient;
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
        } else if (response.kind === 'answer') {
          const { text, facts, source } = response;
          setState({ phase: 'answer', intent, answer: { text, facts, source } }, current);
        } else if (response.kind === 'declined') {
          setState({ phase: 'declined', intent, message: response.message }, current);
        } else if (response.kind === 'rejected') {
          setState({ phase: 'blocked', intent, violations: response.violations as Violation[] }, current);
        } else {
          // The phone re-checks the plan itself; its result wins over the service's. It resolves
          // every named recipient on its own RPC and never uses an address from the service.
          const names = await resolveRecipientNames(response.actions, resolveRecipient);
          if (current !== request.current) return;
          const actions = response.actions.map((action) => withFullName(action, names));
          const checked = evaluatePolicy(
            { kind: 'plan', summary: response.summary, actions, assumptions: response.assumptions },
            context,
            {
              account,
              valueCapUsd: PLAN_VALUE_CAP_USD,
              resolveName: (name) => names.get(name.trim().toLowerCase())?.address ?? null,
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
    [account, balanceClient, client, now, resolveRecipient, setState],
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

type ResolvedName = { address: Address; name: string };

function recipientName(action: Action) {
  if ((action.type !== 'send_eth' && action.type !== 'send_usdc') || action.recipient.kind !== 'name') return null;
  return action.recipient.value.trim().toLowerCase();
}

/**
 * Resolves each named recipient through ENS, with a bare label read as a Sodera name. Keys are
 * both the name the plan used and the full ENS name; a name that fails to resolve is left out.
 */
async function resolveRecipientNames(actions: Action[], resolve: typeof resolveSepoliaRecipient) {
  const names = new Map<string, ResolvedName>();
  await Promise.all(
    actions.map(async (action) => {
      const key = recipientName(action);
      if (!key) return;
      try {
        const { address, name } = await resolve(expandSoderaName(key));
        const resolved = { address, name: name ?? key };
        names.set(key, resolved);
        names.set(resolved.name, resolved);
      } catch {
        // Unresolved names are blocked by the policy check.
      }
    }),
  );
  return names;
}

/** Shows the full ENS name the phone resolved, so the card names exactly who is paid. */
function withFullName(action: Action, names: Map<string, ResolvedName>): Action {
  const key = recipientName(action);
  const resolved = key ? names.get(key) : undefined;
  if (!resolved || (action.type !== 'send_eth' && action.type !== 'send_usdc')) return action;
  return { ...action, recipient: { kind: 'name', value: resolved.name } };
}
