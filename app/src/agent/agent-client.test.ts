import { AgentUnavailableError, createAgentClient, readAgentConfigFromEnv } from './agent-client';

const config = { baseUrl: 'https://agent.example', token: 'token' };
const request = { account: '0x1111111111111111111111111111111111111111', intent: 'hi', context: {} as never };

function respond(status: number, body: unknown) {
  return jest.fn().mockResolvedValue({ ok: status < 400, status, json: jest.fn().mockResolvedValue(body) });
}

describe('agent client', () => {
  it('posts the request with the app token', async () => {
    const fetcher = respond(200, { kind: 'clarification', question: 'How much?' });
    await expect(createAgentClient({ config, fetcher }).propose(request)).resolves.toEqual({
      kind: 'clarification',
      question: 'How much?',
    });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://agent.example/agent/propose');
    expect(init.headers.authorization).toBe('Bearer token');
    expect(JSON.parse(init.body)).toEqual(request);
  });

  it('treats network failures, HTTP errors, bad data, and timeouts as the planner being unavailable', async () => {
    const offline = createAgentClient({ config, fetcher: jest.fn().mockRejectedValue(new TypeError('Network request failed')) });
    await expect(offline.propose(request)).rejects.toThrow(new AgentUnavailableError('The planner could not be reached'));
    await expect(createAgentClient({ config, fetcher: respond(503, {}) }).propose(request)).rejects.toThrow('HTTP 503');
    await expect(createAgentClient({ config, fetcher: respond(200, { kind: 'plan' }) }).propose(request)).rejects.toThrow(
      'invalid data',
    );

    const hanging = jest.fn((_url: string, init: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))),
    );
    await expect(createAgentClient({ config, fetcher: hanging as never, timeoutMs: 10 }).propose(request)).rejects.toThrow(
      'took too long',
    );
  });

  it('reads the optional settings', () => {
    const saved = { ...process.env };
    process.env.EXPO_PUBLIC_AGENT_BASE_URL = 'http://localhost:8080/';
    process.env.EXPO_PUBLIC_AGENT_APP_TOKEN = 't';
    expect(readAgentConfigFromEnv()).toEqual({ baseUrl: 'http://localhost:8080', token: 't' });
    delete process.env.EXPO_PUBLIC_AGENT_APP_TOKEN;
    expect(readAgentConfigFromEnv()).toBeNull();
    process.env.EXPO_PUBLIC_AGENT_BASE_URL = saved.EXPO_PUBLIC_AGENT_BASE_URL;
    process.env.EXPO_PUBLIC_AGENT_APP_TOKEN = saved.EXPO_PUBLIC_AGENT_APP_TOKEN;
    if (saved.EXPO_PUBLIC_AGENT_BASE_URL === undefined) delete process.env.EXPO_PUBLIC_AGENT_BASE_URL;
    if (saved.EXPO_PUBLIC_AGENT_APP_TOKEN === undefined) delete process.env.EXPO_PUBLIC_AGENT_APP_TOKEN;
  });
});
