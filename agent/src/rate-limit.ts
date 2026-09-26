/** Fixed-window in-memory rate limiter. Single instance only, like the transcript store. */
export function createRateLimiter({
  limit,
  windowMs,
  now = Date.now,
}: {
  limit: number;
  windowMs: number;
  now?: () => number;
}) {
  const windows = new Map<string, { startedAt: number; count: number }>();
  return {
    /** Returns the seconds to wait when the key is over its limit, otherwise null. */
    hit(key: string): number | null {
      const time = now();
      const current = windows.get(key);
      if (!current || time - current.startedAt >= windowMs) {
        windows.set(key, { startedAt: time, count: 1 });
        if (windows.size > 10_000) {
          for (const [storedKey, window] of windows) {
            if (time - window.startedAt >= windowMs) windows.delete(storedKey);
          }
        }
        return null;
      }
      if (current.count >= limit) return Math.ceil((current.startedAt + windowMs - time) / 1000);
      current.count += 1;
      return null;
    },
  };
}
