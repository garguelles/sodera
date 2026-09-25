import { loadMarketPrices } from './market-prices';

describe('loadMarketPrices', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('loads USD prices, 24h changes, and the oldest quote timestamp', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        bitcoin: { usd: 84002, usd_24h_change: 0.2, last_updated_at: 1790319890 },
        ethereum: { usd: 2673.55, usd_24h_change: -0.3, last_updated_at: 1790319880 },
      }),
    });

    await expect(loadMarketPrices()).resolves.toEqual({
      bitcoin: { usd: 84002, change24h: 0.2 },
      ethereum: { usd: 2673.55, change24h: -0.3 },
      updatedAt: 1790319880000,
    });
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('api.coingecko.com'), expect.any(Object));
  });

  it('does not show incomplete or invalid prices as live', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ bitcoin: { usd: 100 }, ethereum: { usd: 200 } }),
    });

    await expect(loadMarketPrices()).rejects.toThrow('invalid data');
  });

  it('reports upstream errors rather than presenting invented values', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 429 });

    await expect(loadMarketPrices()).rejects.toThrow('HTTP 429');
  });
});
