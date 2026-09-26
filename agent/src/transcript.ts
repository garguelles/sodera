import type Anthropic from '@anthropic-ai/sdk';

type Turn = { user: string; assistant: string };
type Entry = { turns: Turn[]; touchedAt: number };

export const TRANSCRIPT_MAX_TURNS = 5;
export const TRANSCRIPT_TTL_MS = 30 * 60 * 1000;

/**
 * Per-account follow-up memory: the user's sentences and the assistant's final JSON, nothing
 * else. Held in memory, so it is lost on restart and not shared between replicas; run a
 * single instance or follow-ups ("make it 10 instead") stop working.
 */
export function createTranscriptStore({ now = Date.now }: { now?: () => number } = {}) {
  const entries = new Map<string, Entry>();

  const live = (account: string) => {
    const key = account.toLowerCase();
    const entry = entries.get(key);
    if (entry && now() - entry.touchedAt > TRANSCRIPT_TTL_MS) {
      entries.delete(key);
      return undefined;
    }
    return entry;
  };

  return {
    messages(account: string): Anthropic.Beta.BetaMessageParam[] {
      return (live(account)?.turns ?? []).flatMap((turn) => [
        { role: 'user' as const, content: turn.user },
        { role: 'assistant' as const, content: turn.assistant },
      ]);
    },
    append(account: string, turn: Turn) {
      const key = account.toLowerCase();
      const turns = [...(live(account)?.turns ?? []), turn].slice(-TRANSCRIPT_MAX_TURNS);
      entries.set(key, { turns, touchedAt: now() });
    },
    reset(account: string) {
      entries.delete(account.toLowerCase());
    },
  };
}

export type TranscriptStore = ReturnType<typeof createTranscriptStore>;
