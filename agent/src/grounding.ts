import type { Answer } from './schema.ts';

const NUMBER = /\d[\d,]*(?:\.\d+)?/g;

/** Canonical form of a written number: no thousands separators, no trailing fractional zeros. */
function canonical(written: string) {
  const plain = written.replace(/,/g, '');
  const [whole = '', fraction = ''] = plain.split('.');
  const trimmedWhole = whole.replace(/^0+(?=\d)/, '');
  const trimmedFraction = fraction.replace(/0+$/, '');
  return trimmedFraction ? `${trimmedWhole}.${trimmedFraction}` : trimmedWhole;
}

function numbersIn(text: string) {
  return new Set((text.match(NUMBER) ?? []).map(canonical));
}

/**
 * Returns the facts whose figures do not appear in any tool result or the rendered snapshot.
 * The answer text may paraphrase, so only the facts shown large on the card are checked.
 */
export function ungroundedFacts(answer: Answer, sources: readonly string[]) {
  const known = new Set(sources.flatMap((source) => [...numbersIn(source)]));
  return answer.facts.filter((fact) => [...numbersIn(fact.value)].some((number) => !known.has(number)));
}
