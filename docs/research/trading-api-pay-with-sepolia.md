# Trading API "pay with" feasibility on Sepolia

Research date: 2026-09-26

## Decision

**Go.** The Uniswap Trading API can give Sodera's Kernel smart account batchable calls that pay a recipient an exact amount on Ethereum Sepolia. The mechanism for [the pay with any token plan](../plans/pay-with-any-token.md) is:

1. The backend calls `POST /quote` with `type: EXACT_OUTPUT`, `swapper` = the Kernel, no `recipient`, `protocols: [V2, V3, V4]`, `slippageTolerance: 0.5` and `x-universal-router-version: 2.1.2`.
2. It then calls `POST /swap_5792` with the quote (and `permitData`, when returned) and a deadline 10 minutes out. That returns ordered calls, and the backend keeps **only the single Universal Router 2.1.2 call** (`0x7E4f6c5e954Da5c61B3423D81E2277431Ac043f3`).
3. The app builds its own bounded approvals when paying with USDC: `USDC.approve(Permit2, maxAmountIn)` and `Permit2.approve(USDC, router, maxAmountIn, deadline)`. These replace the API's unlimited ones.
4. The app appends its own transfer of the exact amount to the payee, and runs everything as one Kernel UserOperation.

## Method

`pnpm verify:pay-with` (from `agent/`, script `agent/scripts/verify-pay-with-route.ts`) calls the live Trading API with `UNISWAP_API_KEY` from `agent/.env`. The swapper is the Sodera Kernel `0xFbf2213c7F5DE314729293fF1B541F8591637658`.

For each variant it:

1. appends a transfer to a dummy payee;
2. simulates the whole batch as the Kernel with `eth_simulateV1` (`simulateBlocks`, `traceTransfers: true`), overriding the Kernel's balance to 10 ETH and its USDC balance through FiatToken storage slot 9;
3. derives net ETH and USDC movements per address from the traced transfer logs.

A variant passes when:

- every call succeeds;
- the payee receives exactly the amount;
- the Kernel spends no more than `input.maximumAmount`;
- the router is left holding no ETH or USDC;
- every call targets a known contract.

## Results

Cases: **10 USDC paid with ETH**, and **0.001 ETH paid with USDC**. Both are `EXACT_OUTPUT` at 0.5% slippage.

| Variant | 10 USDC ← ETH | 0.001 ETH ← USDC | Notes |
| --- | --- | --- | --- |
| `/swap_5792` | pass | pass | Approvals come back as calls: `USDC.approve(Permit2, 2^256−1)` and `Permit2.approve(USDC, router, 2^160−1, +30 days)`. Unlimited allowances remain afterwards. |
| `/swap_5792` + `permitAmount: EXACT` | pass | pass | The Permit2 approval becomes the **quoted** input, not the maximum, so any unfavorable move within slippage would revert. The USDC → Permit2 approval is still unlimited. |
| **`/swap_5792` + app-bounded approvals** | **pass** | **pass** | Both approvals are `maxAmountIn` (22.929028 USDC). Only the unused slippage buffer remains (0.114074 USDC), and the Permit2 part expires at the deadline. **Chosen.** |
| `/check_approval` + `generatePermitAsTransaction` + `/swap` | pass | pass | Also unlimited approvals. It needs three API calls, and one run hit a transient `UpstreamTimeoutError` (404), which a retry cleared. |
| `x-permit2-disabled` | pass | **fail** | For USDC input the API targeted `0x02E5be68D46DAc0B524905bfF209cf47EE6dB2a9`, a verified `SwapProxy`. That is not the documented Sepolia proxy `0x0000000085E102724e78eCd2F45DC9cA239Affad`, and it came with an unlimited approval. Rejected. |

Observations common to the passing variants:

- **Real routing.** Both cases went through two-hop v4 routes over pools other than the pinned Swap pool (`0xc743…d824`). For example, `0xf54d…2653` (0.01%) → `0x0767…30a1` (0.3%) for the ETH case, and `0x5723…d7a5` (0.05%) → `0x1d01…1b19` (0.3%) for the USDC case. Routes changed between runs.
- **Prices.**
  - 10 USDC cost 0.000282410166306545 ETH, which implies about 35,400 USDC per ETH. That is cheaper for the payer than the pinned pool (about 31,700). Price impact was 1.49%.
  - 0.001 ETH cost 22.814954 USDC in the chosen runs, and 28.620509 USDC on a different route in the first run. Price impact was 0.84–1.92%.
  - Sepolia prices remain unrelated to the real market.
- **ETH refund.** The router call is sent with `value = maximumAmount`, but the Kernel's net spend equaled the quoted amount, and the router kept nothing. The exact-output ETH refund returns to the swapper, as intended by not setting `recipient`.
- **Latency.** `/quote` took about 0.65–1.1 s and `/swap_5792` about 0.2–0.3 s.

## Consequences for implementation

- **The app builds the approvals, not the backend.** The backend returns only the router call and the quote figures (`amountIn`, `maxAmountIn`, `amountOut`, `route`, `priceImpact`, `requestId`, deadline). The app generates the approvals deterministically. Its guard therefore needs to accept exactly one API-supplied call: the router's `execute(bytes,bytes[],uint256)` (selector `0x3593564c`) on `0x7E4f…43f3`, with `value ≤ maxAmountIn` when paying with ETH and `0` when paying with USDC.
- **Router version stays pinned to 2.1.2.** This router is not the pinned Swap router 2.0 (`0x3A9D…F98b`), and Permit2 allowances are per spender, so the two flows don't share allowances.
- **Retry transient failures once.** Transient `UpstreamTimeoutError` (404) and 429 responses should get one retry in the backend before failing.
- **Decoding stays open.** Decoding the router call with `@uniswap/v4-sdk`'s `V4BaseActionsParser` is still to be confirmed in the frontend guard commit. The spike relied on target and selector checks plus the asset-change simulation.

## Sources

- [Supported chains](https://developers.uniswap.org/docs/trading/swapping-api/supported-chains): Sepolia `11155111` and Universal Router 2.1.2 `0x7E4f…43f3`.
- [Integration guide](https://developers.uniswap.org/docs/trading/swapping-api/start-building/integration-guide): server-side API key and the `permitData` flow.
- [`/swap_5792` reference](https://developers.uniswap.org/docs/api-reference/create_swap_5792_transaction) and the [OpenAPI spec](https://trade-api.gateway.uniswap.org/v1/api.json).
- [No-Permit2 workflow](https://developers.uniswap.org/docs/trading/swapping-api/concepts/no-permit2-workflow): the documented proxy address.
