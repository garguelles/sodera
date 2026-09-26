# Sodera agent

A small Hono service that turns a wallet request such as "send 0.01 eth to alice" into a plan the Sodera app can review and sign. It also proxies Uniswap Trading API quotes for paying with another asset, so the Uniswap API key never ships in the app. Claude proposes the plan through a fixed list of actions, the service checks it against the safety rules in `src/policy.ts`, and the app checks it again before encoding anything. The service never signs, never builds transactions, and holds no keys to the wallet.

## Endpoints

| Method and path | Purpose |
| --- | --- |
| `GET /healthz` | Returns `{ "ok": true }`. |
| `POST /agent/propose` | Takes `{ account, intent, context, reset? }` and returns a `plan`, `clarification`, `answer`, `rejected`, or `declined` response. Requires `Authorization: Bearer <AGENT_APP_TOKEN>`. |
| `POST /pay/quote` | Takes `{ account, payAsset, receiveAsset, amountOut }` (`ETH` or `USDC`, different assets, `amountOut` in base units) and returns an exact-output Uniswap quote with the single Universal Router call. The app adds its own approvals, the transfer to the payee and its own checks. Requires the same bearer token; answers `503 pay_unavailable` when `UNISWAP_API_KEY` is not set. |

Questions about the wallet ("how much did I send alice this month?") return `{ kind: "answer", text, facts, source }`. The `summarize_activity` tool computes the figures with MultiBaas grouped queries over whole UTC days, and `source` is the range it covered. Every number in `facts` must appear in a tool result or the wallet snapshot; otherwise the service answers `rejected` with the `ungrounded` violation. The snapshot includes rounded ETH, its dollar value, and the total value so answers can quote them rather than compute them.

Requests are limited to 32 KB. `/agent/propose` allows 10 per account per minute and 60 per IP per minute. `/pay/quote` allows 20 per account per minute, 60 per IP per minute, and 3 per second across all users, because each quote makes two Uniswap requests and the key allows 6 per second. Follow-up memory and rate limits live in memory, so run a single instance.

`/pay/quote` errors: `422 no_route` when Uniswap finds no route, `503 busy` when Uniswap is rate limiting (after one retry), `504 upstream_timeout` after 8 seconds, and `502 unexpected_quote` when the returned calls are not the single router call. See `docs/plans/pay-with-any-token.md`.

## Local development

```bash
cd agent
pnpm install
cp .env.example .env   # then fill in the values below
pnpm dev
```

| Variable | Value |
| --- | --- |
| `ANTHROPIC_API_KEY` | Claude API key. Set a monthly spend limit on it. |
| `AGENT_APP_TOKEN` | Random string the app sends as its bearer token. It ships inside the app, so it only deters casual abuse. |
| `MULTIBAAS_BASE_URL`, `MULTIBAAS_API_KEY` | The same MultiBaas deployment and DApp User key the app uses. |
| `SEPOLIA_RPC_URL` | Used only for ENS lookups. |
| `PLAN_VALUE_CAP_USD` | Largest plan value in US dollars. Default `250`. |
| `AGENT_MODEL` | Default `claude-sonnet-5`. |
| `AGENT_EFFORT` | `low`, `medium`, `high`, `xhigh`, or `max`. Default `high`. |
| `UNISWAP_API_KEY` | Uniswap Trading API key for `/pay/quote`. Optional; without it the endpoint answers 503. Keep it server-side only. |

## Checks

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm verify:pay-with   # live Trading API check on Sepolia; needs UNISWAP_API_KEY and SEPOLIA_RPC_URL
VERIFY_ACCOUNT=0x... pnpm verify:activity   # live MultiBaas check of the summarize_activity queries
```

The schema and policy tests read the shared vectors in `../docs/plans/agent-schema-vectors.json` and `../docs/plans/agent-policy-vectors.json`. The app's copies of the schema and policy must pass the same files.

## Deploying on Railway

1. Create a service in the `sodera` project from this repository with root directory `/agent` and the Dockerfile builder.
2. Set the variables above and generate a public domain.
3. In `app/.env.local`, set `EXPO_PUBLIC_AGENT_BASE_URL` to the domain and `EXPO_PUBLIC_AGENT_APP_TOKEN` to the token.

## Smoke test

Save a request body, then send it three ways. Replace the domain, token and account.

```bash
cat > /tmp/propose.json <<'JSON'
{
  "account": "0x1111111111111111111111111111111111111111",
  "intent": "send 0.01 eth to alice",
  "context": {
    "chainId": 11155111,
    "now": "2026-09-26T08:00:00.000Z",
    "balances": { "eth": "0.5", "usdc": "20" },
    "prices": { "ethUsd": "2600" },
    "vaultPosition": null,
    "sponsorship": null,
    "addressBook": [{ "name": "alice", "address": "0x2222222222222222222222222222222222222222" }],
    "capabilities": { "send_eth": true, "send_usdc": true, "swap": false, "vault_deposit": false, "vault_withdraw": false }
  }
}
JSON

propose() {
  jq --arg intent "$1" '.intent = $intent | .reset = true' /tmp/propose.json |
    curl -s https://<domain>/agent/propose -H 'authorization: Bearer <token>' -H 'content-type: application/json' -d @-
}

propose 'send 0.01 eth to alice'   # expect "kind": "plan"
propose 'send some eth to alice'   # expect "kind": "clarification"
propose 'send 100 eth to alice'    # expect "kind": "clarification" naming the 0.5 ETH balance
propose 'how much usdc did I send this month?'   # expect "kind": "answer" with a source range
```

Each request logs one JSON line with the outcome, tool calls, token usage and latency. From the second identical request on, `cacheReadInputTokens` should be above zero. The log never contains the request sentence or address book.
