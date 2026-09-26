import assert from 'node:assert/strict';

import { createPublicClient, decodeAbiParameters, http, parseAbi, sliceHex } from 'viem';
import { sepolia } from 'viem/chains';

import { AQUA_FEE_BPS, buildAquaOrder } from '../src/wallet/aqua-strategy.ts';
import {
  SEPOLIA_AQUA_ADDRESS,
  SEPOLIA_AQUA_SWAP_VM_ROUTER_ADDRESS,
  SEPOLIA_USDC_ADDRESS,
  SEPOLIA_WETH_ADDRESS,
} from '../src/wallet/sepolia.ts';

if (!process.env.SEPOLIA_RPC_URL) {
  throw new Error('SEPOLIA_RPC_URL is required');
}

// The router pinned in docs/research/aqua-swapvm-sepolia.md.
const EXPECTED_ROUTER_NAME = '1inch SwapVM v1.0';
const MAKER = '0x000000000000000000000000000000000000dEaD';
const SALT = 1_790_000_000n;
// Opcodes of the Sepolia router's AquaOpcodes table (and the SDK's aquaInstructions).
const OPCODE = { xycSwapXD: 0x11, salt: 0x14, flatFeeAmountInXD: 0x15 };

const orderAbi = {
  type: 'tuple',
  components: [
    { name: 'maker', type: 'address' },
    { name: 'traits', type: 'uint256' },
    { name: 'data', type: 'bytes' },
  ],
};
const routerAbi = parseAbi([
  'function hash((address maker, uint256 traits, bytes data) order) view returns (bytes32)',
  'function eip712Domain() view returns (bytes1 fields, string name, string version, uint256 chainId, address verifyingContract, bytes32 salt, uint256[] extensions)',
]);
const aquaAbi = parseAbi([
  'function rawBalances(address maker, address app, bytes32 strategyHash, address token) view returns (uint248 balance, uint8 tokensCount)',
]);

const client = createPublicClient({ chain: sepolia, transport: http(process.env.SEPOLIA_RPC_URL) });

console.log('1. Chain');
assert.equal(await client.getChainId(), sepolia.id, 'RPC is not Ethereum Sepolia');
console.log(`   Ethereum Sepolia at block ${await client.getBlockNumber()}`);

console.log('2. Contracts');
for (const [name, address] of Object.entries({
  Aqua: SEPOLIA_AQUA_ADDRESS,
  AquaSwapVMRouter: SEPOLIA_AQUA_SWAP_VM_ROUTER_ADDRESS,
  USDC: SEPOLIA_USDC_ADDRESS,
  WETH: SEPOLIA_WETH_ADDRESS,
})) {
  const code = await client.getCode({ address });
  assert.ok(code && code !== '0x', `${name} has no code at ${address}`);
  console.log(`   ${name} ${address}: ${(code.length - 2) / 2} bytes`);
}
const [, routerName] = await client.readContract({
  address: SEPOLIA_AQUA_SWAP_VM_ROUTER_ADDRESS,
  abi: routerAbi,
  functionName: 'eip712Domain',
});
assert.equal(routerName, EXPECTED_ROUTER_NAME);
console.log(`   router reports "${routerName}"`);

console.log('3. Order');
const { order, strategyHash } = buildAquaOrder({ maker: MAKER, salt: SALT });
const [decoded] = decodeAbiParameters([orderAbi], order);
assert.equal(decoded.maker, MAKER);
const routerHash = await client.readContract({
  address: SEPOLIA_AQUA_SWAP_VM_ROUTER_ADDRESS,
  abi: routerAbi,
  functionName: 'hash',
  args: [decoded],
});
assert.equal(routerHash, strategyHash, 'router hash differs from keccak256(order)');
console.log(`   router.hash(order) = keccak256(order) = ${strategyHash}`);

// With no hooks, the order data is the program: [opcode][args length][args] per instruction.
const program = decoded.data;
const fee = BigInt(AQUA_FEE_BPS) * 100_000n; // SwapVM fees use 1e9 = 100%.
const expectedProgram =
  `0x${hex8(OPCODE.flatFeeAmountInXD)}04${fee.toString(16).padStart(8, '0')}` +
  `${hex8(OPCODE.xycSwapXD)}00` +
  `${hex8(OPCODE.salt)}08${SALT.toString(16).padStart(16, '0')}`;
assert.equal(program.toLowerCase(), expectedProgram, 'program is not flat fee, x·y=k, salt');
assert.equal(sliceHex(program, 2, 6), `0x${fee.toString(16).padStart(8, '0')}`);
console.log(`   program ${program}: ${AQUA_FEE_BPS} bps flat fee (${fee} / 1e9), x·y=k, salt ${SALT}`);

const [balance, tokensCount] = await client.readContract({
  address: SEPOLIA_AQUA_ADDRESS,
  abi: aquaAbi,
  functionName: 'rawBalances',
  args: [MAKER, SEPOLIA_AQUA_SWAP_VM_ROUTER_ADDRESS, strategyHash, SEPOLIA_USDC_ADDRESS],
});
assert.equal(balance, 0n);
assert.equal(tokensCount, 0);
console.log('   an unshipped order reads as no position (balance 0, tokensCount 0)');

console.log('\nAqua and SwapVM on Sepolia verified.');

function hex8(value) {
  return value.toString(16).padStart(2, '0');
}
