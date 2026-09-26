import { readFileSync } from 'node:fs';

import Anthropic from '@anthropic-ai/sdk';
import { serve } from '@hono/node-server';
import { createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import { normalize } from 'viem/ens';

import { createApp } from './app.ts';
import { createMultiBaasClient } from './multibaas.ts';
import { createPayQuoter } from './pay-quote.ts';
import type { Effort } from './propose.ts';
import { createTradingApiClient } from './uniswap-trading.ts';
import { createSwapQuoter } from './uniswap.ts';
import { createTranscriptStore } from './transcript.ts';

const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const effort = (process.env.AGENT_EFFORT ?? 'high') as Effort;
if (!EFFORTS.includes(effort)) throw new Error(`AGENT_EFFORT must be one of ${EFFORTS.join(', ')}`);
const valueCapUsd = Number(process.env.PLAN_VALUE_CAP_USD ?? '250');
if (!Number.isInteger(valueCapUsd) || valueCapUsd <= 0) throw new Error('PLAN_VALUE_CAP_USD must be a positive integer');
required('ANTHROPIC_API_KEY');

const chain = createPublicClient({
  chain: sepolia,
  transport: http(process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com'),
});

const app = createApp({
  appToken: required('AGENT_APP_TOKEN'),
  client: new Anthropic({ timeout: 60_000, maxRetries: 2 }),
  model: process.env.AGENT_MODEL ?? 'claude-sonnet-5',
  effort,
  systemPrompt: readFileSync(new URL('./prompts/system.md', import.meta.url), 'utf8'),
  valueCapUsd,
  multibaas: createMultiBaasClient({
    baseUrl: required('MULTIBAAS_BASE_URL'),
    apiKey: required('MULTIBAAS_API_KEY'),
  }),
  resolveEns: async (name) => {
    try {
      return await chain.getEnsAddress({ name: normalize(name) });
    } catch {
      return null;
    }
  },
  quoteSwap: createSwapQuoter(chain),
  payQuoter: process.env.UNISWAP_API_KEY
    ? createPayQuoter({ trading: createTradingApiClient({ apiKey: process.env.UNISWAP_API_KEY }) })
    : null,
  transcripts: createTranscriptStore(),
});

const port = Number(process.env.PORT ?? '8080');
serve({ fetch: app.fetch, port }, (info) => {
  console.log(JSON.stringify({ event: 'listening', port: info.port }));
});
