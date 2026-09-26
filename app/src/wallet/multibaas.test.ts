import {
  createMultiBaasClient,
  readMultiBaasConfigFromEnv,
  type EventQuery,
} from './multibaas';

const config = { baseUrl: 'https://abc123.multibaas.com/', apiKey: 'dapp-key' };
const query: EventQuery = {
  events: [{ eventName: 'Transfer', select: [{ type: 'tx_hash', alias: 'txHash' }] }],
  orderBy: 'timestamp',
  order: 'DESC',
};

describe('createMultiBaasClient', () => {
  it('posts event queries with bearer auth, JSON headers, and explicit pagination', async () => {
    const rows = [{ txHash: '0x01' }];
    const fetcher = jsonFetcher({ status: 200, message: 'success', result: { rows } });
    const client = createMultiBaasClient({ config, fetcher });

    await expect(client.executeEventQuery(query, { offset: 10, limit: 25 })).resolves.toEqual(rows);

    expect(fetcher).toHaveBeenCalledWith(
      'https://abc123.multibaas.com/api/v0/queries?offset=10&limit=25',
      {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: 'Bearer dapp-key',
          'content-type': 'application/json',
        },
        body: JSON.stringify(query),
      },
    );
  });

  it('defaults to and caps at the largest page MultiBaas accepts', async () => {
    const fetcher = jsonFetcher({ result: { rows: [] } });
    const client = createMultiBaasClient({ config, fetcher });
    await client.executeEventQuery(query);
    await client.executeEventQuery(query, { limit: 100 });

    expect(fetcher.mock.calls[0][0]).toBe('https://abc123.multibaas.com/api/v0/queries?offset=0&limit=50');
    expect(fetcher.mock.calls[1][0]).toBe('https://abc123.multibaas.com/api/v0/queries?offset=0&limit=50');
  });

  it('always requests integers as strings for method calls and returns the output', async () => {
    const fetcher = jsonFetcher({ result: { kind: 'MethodCallResponse', output: '6' } });
    const client = createMultiBaasClient({ config, fetcher });

    await expect(client.callMethod('usdc', 'usdc', 'balanceOf', ['0x01'])).resolves.toBe('6');

    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(
      'https://abc123.multibaas.com/api/v0/chains/ethereum/addresses/usdc/contracts/usdc/methods/balanceOf',
    );
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ args: ['0x01'], formatInts: 'as_strings' });
  });

  it('rejects a method call result of another kind', async () => {
    const client = createMultiBaasClient({
      config,
      fetcher: jsonFetcher({ result: { kind: 'TransactionToSignResponse', output: {} } }),
    });

    await expect(client.callMethod('usdc', 'usdc', 'decimals', [])).rejects.toThrow(
      'MultiBaas returned invalid data',
    );
  });

  it('reads addresses and chain status with GET requests', async () => {
    const fetcher = jsonFetcher({ result: { balance: '1' } });
    const client = createMultiBaasClient({ config, fetcher });

    await client.getAddress('0x1111111111111111111111111111111111111111', ['balance', 'nonce']);
    await client.getChainStatus();

    expect(fetcher.mock.calls[0][0]).toBe(
      'https://abc123.multibaas.com/api/v0/chains/ethereum/addresses/0x1111111111111111111111111111111111111111?include=balance&include=nonce',
    );
    expect(fetcher.mock.calls[0][1]).toEqual({
      method: 'GET',
      headers: { accept: 'application/json', authorization: 'Bearer dapp-key' },
    });
    expect(fetcher.mock.calls[1][0]).toBe('https://abc123.multibaas.com/api/v0/chains/ethereum/status');
  });

  it('maps transport, HTTP, and payload failures to stable messages', async () => {
    const unreachable = createMultiBaasClient({
      config,
      fetcher: jest.fn().mockRejectedValue(new TypeError('Network request failed')),
    });
    const httpError = createMultiBaasClient({
      config,
      fetcher: jest.fn().mockResolvedValue({ ok: false, status: 401, json: jest.fn() }),
    });
    const noResult = createMultiBaasClient({ config, fetcher: jsonFetcher({ status: 200 }) });
    const badRows = createMultiBaasClient({ config, fetcher: jsonFetcher({ result: { rows: 'x' } }) });
    const notJson = createMultiBaasClient({
      config,
      fetcher: jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockRejectedValue(new SyntaxError('Unexpected token')),
      }),
    });

    await expect(unreachable.executeEventQuery(query)).rejects.toThrow('MultiBaas could not be reached');
    await expect(httpError.getChainStatus()).rejects.toThrow('MultiBaas returned HTTP 401');
    await expect(noResult.getChainStatus()).rejects.toThrow('MultiBaas returned invalid data');
    await expect(badRows.executeEventQuery(query)).rejects.toThrow('MultiBaas returned invalid data');
    await expect(notJson.getChainStatus()).rejects.toThrow('MultiBaas returned invalid data');
  });
});

describe('readMultiBaasConfigFromEnv', () => {
  const keys = ['EXPO_PUBLIC_MULTIBAAS_BASE_URL', 'EXPO_PUBLIC_MULTIBAAS_API_KEY'] as const;
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

  afterEach(() => {
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });

  it('reads the public MultiBaas settings', () => {
    process.env.EXPO_PUBLIC_MULTIBAAS_BASE_URL = 'https://abc123.multibaas.com';
    process.env.EXPO_PUBLIC_MULTIBAAS_API_KEY = 'dapp-key';

    expect(readMultiBaasConfigFromEnv()).toEqual({
      baseUrl: 'https://abc123.multibaas.com',
      apiKey: 'dapp-key',
    });
  });

  it('names the missing variable', () => {
    delete process.env.EXPO_PUBLIC_MULTIBAAS_BASE_URL;
    process.env.EXPO_PUBLIC_MULTIBAAS_API_KEY = 'dapp-key';
    expect(() => readMultiBaasConfigFromEnv()).toThrow('EXPO_PUBLIC_MULTIBAAS_BASE_URL');

    process.env.EXPO_PUBLIC_MULTIBAAS_BASE_URL = 'https://abc123.multibaas.com';
    delete process.env.EXPO_PUBLIC_MULTIBAAS_API_KEY;
    expect(() => readMultiBaasConfigFromEnv()).toThrow('EXPO_PUBLIC_MULTIBAAS_API_KEY');
  });
});

function jsonFetcher(payload: unknown) {
  return jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: jest.fn().mockResolvedValue(payload),
  });
}
