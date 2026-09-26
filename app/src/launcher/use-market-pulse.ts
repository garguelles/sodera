import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { loadMarketPrices, loadMarketTrends, type MarketPrices, type MarketTrends } from './market-prices';

const RECENT_MS = 10 * 60_000;
const FOREGROUND_REFRESH_MS = 5 * 60_000;

export type MarketPulseState = {
  prices: MarketPrices | null;
  trends: MarketTrends | null;
  loading: boolean;
  /** The latest refresh failed; `prices` may still hold the last good result. */
  error: boolean;
  /** Prices loaded without error and are less than ten minutes old. */
  isLive: boolean;
  retry(): void;
};

/** Loads BTC and ETH prices and trends, refreshes on foreground after five minutes, and exposes retry. */
export function useMarketPulse(): MarketPulseState {
  const [prices, setPrices] = useState<MarketPrices | null>(null);
  const [trends, setTrends] = useState<MarketTrends | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [recent, setRecent] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const lastRefresh = useRef(0);

  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;
    const refresh = () => {
      controller?.abort();
      const request = new AbortController();
      controller = request;
      lastRefresh.current = Date.now();
      void loadMarketPrices(request.signal)
        .then((result) => {
          if (!active || request.signal.aborted) return;
          setPrices(result);
          setError(false);
          const age = Date.now() - result.updatedAt;
          setRecent(age >= 0 && age < RECENT_MS);
          void loadMarketTrends(request.signal)
            .then((history) => {
              if (active && !request.signal.aborted) setTrends(history);
            })
            .catch(() => {
              if (active && !request.signal.aborted) setTrends(null);
            });
        })
        .catch(() => {
          if (active && !request.signal.aborted) {
            setError(true);
            setRecent(false);
            setTrends(null);
          }
        })
        .finally(() => {
          if (active && !request.signal.aborted) setLoading(false);
        });
    };
    refresh();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && Date.now() - lastRefresh.current > FOREGROUND_REFRESH_MS) refresh();
    });
    return () => {
      active = false;
      controller?.abort();
      subscription.remove();
    };
  }, [retryCount]);

  const retry = useCallback(() => {
    setLoading(true);
    setRetryCount((count) => count + 1);
  }, []);

  return { prices, trends, loading, error, isLive: !error && recent, retry };
}
