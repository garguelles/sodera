import type { KernelExecutionCall, KernelOperationReview } from './kernel-passkey-execution';

/** The prepared UserOperation must run exactly the calls the wallet built, in order. */
export function assertPreparedCallsMatch(
  review: KernelOperationReview,
  calls: readonly KernelExecutionCall[],
  message = 'The prepared operation does not match the requested calls',
) {
  const matches =
    review.calls.length === calls.length &&
    review.calls.every(
      (prepared, index) =>
        prepared.to.toLowerCase() === calls[index].to.toLowerCase() &&
        prepared.valueWei === calls[index].value.toString() &&
        prepared.data.toLowerCase() === calls[index].data.toLowerCase(),
    );
  if (!matches) throw new Error(message);
}
