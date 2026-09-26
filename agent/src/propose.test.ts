import { getAddress } from 'viem';
import { describe, expect, it, vi } from 'vitest';

import { propose, renderUserMessage } from './propose.ts';
import { createTools, type ToolDependencies } from './tools.ts';
import { fakeClient, fakeMultiBaas, message } from './test/fakes.ts';
import { ACCOUNT, createContext } from './test/fixtures.ts';

const PLAN = JSON.stringify({
  kind: 'plan',
  summary: 'Send 0.01 ETH to alice.',
  actions: [{ type: 'send_eth', recipient: { kind: 'name', value: 'alice' }, amount: '0.01' }],
  assumptions: [],
});

function toolDeps(overrides: Partial<ToolDependencies> = {}): ToolDependencies {
  return {
    account: getAddress(ACCOUNT),
    context: createContext(),
    multibaas: fakeMultiBaas(),
    resolveEns: vi.fn().mockResolvedValue(null),
    now: () => Date.parse('2026-09-26T08:00:00Z'),
    resolvedNames: new Map(),
    calls: [],
    ...overrides,
  };
}

function run(client: Parameters<typeof propose>[0]['client'], overrides: Partial<Parameters<typeof propose>[0]> = {}) {
  return propose({
    client,
    model: 'claude-sonnet-5',
    effort: 'high',
    systemPrompt: 'SYSTEM',
    tools: createTools(toolDeps()),
    transcript: [],
    intent: 'send 0.01 eth to alice',
    context: createContext(),
    valueCapUsd: 250,
    ...overrides,
  });
}

describe('propose', () => {
  it('builds a cached, structured request and returns the parsed plan', async () => {
    const { client, toolRunner } = fakeClient(() => [message(PLAN)]);
    const transcript = [
      { role: 'user' as const, content: 'send 5 usdc to alice' },
      { role: 'assistant' as const, content: '{"kind":"clarification","question":"?"}' },
    ];

    const result = await run(client, { transcript });

    expect(result).toEqual({
      kind: 'output',
      output: JSON.parse(PLAN),
      text: PLAN,
      model: 'claude-sonnet-5',
      usage: { inputTokens: 100, outputTokens: 20, cacheReadInputTokens: 80 },
    });
    const params = toolRunner.mock.calls[0]![0];
    expect(params.model).toBe('claude-sonnet-5');
    expect(params.system).toEqual([{ type: 'text', text: 'SYSTEM', cache_control: { type: 'ephemeral' } }]);
    expect(params.output_config?.effort).toBe('high');
    expect(params.output_config?.format?.type).toBe('json_schema');
    expect(params.tools.map((tool) => ('name' in tool ? tool.name : null))).toEqual([
      'get_activity',
      'resolve_name',
      'quote_swap',
      'get_eth_price',
    ]);
    expect(params.messages).toEqual([
      ...transcript,
      { role: 'user', content: renderUserMessage('send 0.01 eth to alice', createContext(), 250) },
    ]);
  });

  it('sums usage across tool iterations and runs the requested tool', async () => {
    const deps = toolDeps({
      multibaas: fakeMultiBaas({
        executeEventQuery: vi.fn().mockResolvedValue([]),
      }),
    });
    let toolResult: unknown;
    const { client } = fakeClient(async (params) => {
      const tool = params.tools.find((item) => 'name' in item && item.name === 'get_activity');
      toolResult = JSON.parse(String(await (tool as { run: (input: unknown) => Promise<string> }).run({ limit: 5 })));
      return [message(null, { stop_reason: 'tool_use' }), message(PLAN)];
    });

    const result = await run(client, { tools: createTools(deps) });

    expect(toolResult).toEqual({ activity: [] });
    expect(deps.calls).toEqual(['get_activity']);
    expect(result).toMatchObject({ kind: 'output', usage: { inputTokens: 200, outputTokens: 40, cacheReadInputTokens: 160 } });
  });

  it('turns tool failures into data for the model', async () => {
    const deps = toolDeps({
      multibaas: fakeMultiBaas({ executeEventQuery: vi.fn().mockRejectedValue(new Error('MultiBaas returned HTTP 502')) }),
    });
    const tool = createTools(deps).find((item) => item.name === 'get_activity') as unknown as {
      run: (input: unknown) => Promise<string>;
    };

    await expect(tool.run({})).resolves.toBe(JSON.stringify({ error: 'MultiBaas returned HTTP 502' }));
  });

  it('maps refusals, cut-off output, and unreadable output', async () => {
    await expect(run(fakeClient(() => [message(null, { stop_reason: 'refusal' })]).client)).resolves.toMatchObject({
      kind: 'refused',
    });
    await expect(run(fakeClient(() => [message('{"kind":', { stop_reason: 'max_tokens' })]).client)).rejects.toThrow(
      'Agent output was cut off',
    );
    await expect(run(fakeClient(() => [message('not json')]).client)).resolves.toMatchObject({ kind: 'invalid' });
    await expect(
      run(fakeClient(() => [message(JSON.stringify({ kind: 'plan', summary: 'x', actions: [], assumptions: [] }))]).client),
    ).resolves.toMatchObject({ kind: 'invalid' });
  });
});

describe('renderUserMessage', () => {
  it('lists address book names only, sorted, never addresses', () => {
    const context = createContext({
      addressBook: [
        { name: 'zed', address: '0x4444444444444444444444444444444444444444' },
        { name: 'alice', address: '0x2222222222222222222222222222222222222222' },
      ],
    });
    const text = renderUserMessage('pay zed', context, 250);

    expect(text).toContain('- Address book: alice, zed');
    expect(text).not.toContain('0x4444');
    expect(text).toContain('- Plan value limit: $250');
    expect(text).toContain('swap=unavailable');
    expect(renderUserMessage('pay zed', context, 250)).toBe(text);
  });
});
