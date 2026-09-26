import type { EnrichedPlan } from './policy';

/**
 * Hands the approved plan from the home card to the review route. A module store rather than
 * route params, because the plan carries bigints. `complete` lets the home clear its card
 * once the plan has been signed.
 */
type Pending = { plan: EnrichedPlan; intent: string; turnId?: number };

let pending: Pending | null = null;
let completed: { turnId: number | null } | null = null;

export const pendingPlan = {
  set(value: Pending) {
    pending = value;
    completed = null;
  },
  get() {
    return pending;
  },
  complete() {
    completed = { turnId: pending?.turnId ?? null };
    pending = null;
  },
  /** True once after a plan was signed; clears the flag. */
  consumeCompleted() {
    const value = completed !== null;
    completed = null;
    return value;
  },
  /** The conversation turn whose plan was signed, once; clears the flag. */
  consumeCompletedTurn() {
    const value = completed?.turnId ?? null;
    completed = null;
    return value;
  },
};
