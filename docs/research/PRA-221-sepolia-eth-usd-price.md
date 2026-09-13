# PRA-221: Sepolia ETH/USD price source

## Decision

Use the Chainlink ETH/USD Data Feed proxy on Ethereum Sepolia:

- Network: Ethereum Sepolia, chain ID `11155111`
- Proxy: [`0x694AA1769357215DE4FAC081bf1f309aDC325306`](https://sepolia.etherscan.io/address/0x694AA1769357215DE4FAC081bf1f309aDC325306)
- Pair: `ETH / USD`
- Decimals: `8`
- Published heartbeat: `3600` seconds
- Published deviation threshold: `1%`

Chainlink's [Data Feeds API reference](https://docs.chain.link/data-feeds/api-reference) explicitly uses this Sepolia ETH/USD proxy in its `AggregatorV3Interface` example and directs consumers to read the proxy rather than its current underlying aggregator. The [Sepolia feed directory data](https://reference-data-directory.vercel.app/feeds-ethereum-testnet-sepolia.json) publishes the pair, proxy, decimals, heartbeat, and deviation threshold.

Sodera reads `decimals()` and `latestRoundData()` through its existing chain-checked Sepolia JSON-RPC client. A quote is usable only when the feed still reports 8 decimals, the five round fields decode correctly, the answer is positive, and `updatedAt` is nonzero, no more than five minutes in the future, and no older than two published heartbeats. The second heartbeat allows reporting and block-inclusion delay without silently accepting indefinitely stale data.

An unusable quote contributes USD 0 for ETH without changing its onchain quantity or failing the holdings read. Zero ETH skips both feed calls. All scaling and cent rounding use integer arithmetic.

This is a testnet display convention. Sepolia ETH and testnet-USDC do not thereby acquire redeemable USD value, and this quote must not replace current onchain balance checks, transaction simulation, or spend authorization.

## Live verification

Observed on 2026-09-13 through `https://ethereum-sepolia-rpc.publicnode.com`:

- Block: `11695922` (`0xb27732`)
- Proxy runtime bytecode: nonempty
- `description()`: `ETH / USD`
- `decimals()`: `8`
- `latestRoundData().answer`: `248103935330`, or USD `2481.03935330`
- `latestRoundData().updatedAt`: `1789302624` (`2026-09-13T12:30:24Z`)

Reproduce the contract reads without an SDK:

```sh
RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
FEED=0x694AA1769357215DE4FAC081bf1f309aDC325306

curl --request POST --header 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_getCode","params":["'"$FEED"'","latest"]}' \
  "$RPC_URL"

curl --request POST --header 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"'"$FEED"'","data":"0x313ce567"},"latest"]}' \
  "$RPC_URL"

curl --request POST --header 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"'"$FEED"'","data":"0x7284e416"},"latest"]}' \
  "$RPC_URL"

curl --request POST --header 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"'"$FEED"'","data":"0xfeaf968c"},"latest"]}' \
  "$RPC_URL"
```

The selectors are `decimals()`, `description()`, and `latestRoundData()`. Decode return values using the [`AggregatorV3Interface`](https://docs.chain.link/data-feeds/api-reference#aggregatorv3interface) ABI.

## Failure evidence

`app/src/wallet/wallet-home-live.test.ts` reproduces valid pricing and the required fallback for an RPC rejection, unexpected decimals, a non-positive answer, and a quote older than the accepted freshness window. Run:

```sh
pnpm test --runInBand src/wallet/wallet-home-live.test.ts
```

Chainlink's [developer responsibilities](https://docs.chain.link/data-feeds/developer-responsibilities) require applications to choose suitable data-quality checks, circuit breakers, and contingency behavior. Sodera's checks and USD-zero fallback implement the narrower hackathon display requirement; they are not a general-purpose financial risk policy.
