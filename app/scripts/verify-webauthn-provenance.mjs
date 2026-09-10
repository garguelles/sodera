import assert from 'node:assert/strict';

import {
  encodeAbiParameters,
  getContractAddress,
  getCreate2Address,
  keccak256,
  padHex,
  toBytes,
  toHex,
} from 'viem';
import solc0823 from 'solc-0-8-23';
import solc0828 from 'solc-0-8-28';
import solc0830 from 'solc';

const BLOCKSCOUT_API = 'https://eth-sepolia.blockscout.com/api/v2';
const DEPLOYER = '0x4e59b44847b379578588920cA78FbF26c0B4956C';
const ENTRY_POINT = '0x0000000071727De22E5E9d8BAf0edAc6f37da032';
const KERNEL = '0xd6CEDDe84be40893d153Be9d467CD6aD37875b28';
const FACTORY = '0x2577507b78c2008Ff367261CB6285d44ba5eF2E9';
const VALIDATOR = '0x7ab16Ff354AcB328452F1D445b3Ddee9a91e9e69';
const SENDER_CREATOR = getContractAddress({ from: ENTRY_POINT, nonce: 1n });
const word = (value) => padHex(value, { size: 32 });
const domainSeparator = keccak256(
  encodeAbiParameters(
    [
      { type: 'bytes32' },
      { type: 'bytes32' },
      { type: 'bytes32' },
      { type: 'uint256' },
      { type: 'address' },
    ],
    [
      keccak256(toBytes('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')),
      keccak256(toBytes('Kernel')),
      keccak256(toBytes('0.3.3')),
      11155111n,
      KERNEL,
    ],
  ),
);

const targets = [
  {
    name: 'EntryPoint 0.7',
    address: ENTRY_POINT,
    transaction: '0x0c0bc6a92965094232ed1a3788646890b8d6f4c3006eeda5db377d62f9a830eb',
    compiler: solc0823,
    compilerVersion: '0.8.23+commit.f704f362.Emscripten.clang',
    sourceUnits: 18,
    sourceBundleHash: '0x9951f25a78201825f62295783c7069bb41ad4a3a47114883c23bb851500954fa',
    creationHash: '0x30516d9cdbeabfaf62ea32d081a10ee3b95b92e5549cfc86353bbe85741c1404',
    runtimeHash: '0x8db5ff695839d655407cc8490bb7a5d82337a86a6b39c3f0258aa6c3b582fc58',
    immutableValues: { 140: word(SENDER_CREATOR) },
  },
  {
    name: 'Kernel 0.3.3',
    address: KERNEL,
    transaction: '0x7d1c2fdd95e18895ed27fbc4868de58ae085ec09b7d3c300ec7ab720464bc95d',
    compiler: solc0828,
    compilerVersion: '0.8.28+commit.7893614a.Emscripten.clang',
    sourceUnits: 30,
    sourceBundleHash: '0x4bf3dda831ed92a4f603ed4b20950d43b07c32a05a4ecfc47e29d588d5f25366',
    creationHash: '0x1bdf554f9fc134312215ed3552f83f9783e937708f9370852256f9a7bb3992c6',
    runtimeHash: '0x1cacd781072bcb657a6306afd074049f35d0a9d7f50eccda9b12bdd00c636995',
    immutableValues: {
      717: word(KERNEL),
      719: toHex(11155111n, { size: 32 }),
      721: keccak256(toBytes('Kernel')),
      723: keccak256(toBytes('0.3.3')),
      725: domainSeparator,
      1945: word(ENTRY_POINT),
    },
  },
  {
    name: 'KernelFactory 0.3.3',
    address: FACTORY,
    transaction: '0x6bffaedba569ca0d5eb25ed44747dc0e11b87ce2a85cac4e3b7f75b3ba4799d2',
    compiler: solc0828,
    compilerVersion: '0.8.28+commit.7893614a.Emscripten.clang',
    sourceUnits: 2,
    sourceBundleHash: '0xeb83c26231e5c9eb9ba1ec925f761e16de5c8df4fef718cd163ed74c3032dc77',
    creationHash: '0x7249aa1b8ecf5641c923fa741d30819ee89dd5209483077b86c90ac43f011adc',
    runtimeHash: '0xcc4b1b98f5716bf61042d87bfedd4709a5c9a597c41f3bb0e6fb6fe1a4ebd37a',
    immutableValues: { 9: word(KERNEL) },
  },
  {
    name: 'WebAuthn validator 0.0.3',
    address: VALIDATOR,
    transaction: '0x8bf42851b99f5e5b1497121d55d3b822132dbfa06399b4ce34bc8febf53f4913',
    compiler: solc0830,
    compilerVersion: '0.8.30+commit.73712a01.Emscripten.clang',
    sourceUnits: 9,
    sourceBundleHash: '0xaaaadd7d6d1bcf76502dc5cf815a183ab646f14c5bc1ff6b9729510d49151052',
    creationHash: '0x0adf125a1cccd016a8cbfa56f4043d608f1bb84f8d256ab15fefe0dbc96139c8',
    runtimeHash: '0x726d987ac55574f77f5184326631c5c51142f94c16c9b9281b751f97519c9eea',
    immutableValues: {},
  },
];

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`Request failed with HTTP ${response.status}`);
  return response.json();
}

function materializeImmutables(runtime, references, values) {
  const bytes = runtime.split('');
  assert.deepEqual(Object.keys(references).sort(), Object.keys(values).sort());
  for (const [id, locations] of Object.entries(references)) {
    const value = values[id].slice(2);
    assert.equal(value.length, 64);
    for (const { start, length } of locations) {
      assert.equal(length, 32);
      bytes.splice(start * 2, length * 2, ...value);
    }
  }
  return `0x${bytes.join('')}`;
}

if (!process.env.SEPOLIA_RPC_URL) {
  throw new Error('SEPOLIA_RPC_URL is required');
}
const rpcUrl = process.env.SEPOLIA_RPC_URL;
const chainPayload = await fetchJson(rpcUrl, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
});
if (chainPayload.error) throw new Error(chainPayload.error.message);
assert.equal(BigInt(chainPayload.result), 11155111n);
const results = [];
for (const target of targets) {
  assert.equal(target.compiler.version(), target.compilerVersion);
  const contract = await fetchJson(`${BLOCKSCOUT_API}/smart-contracts/${target.address}`);
  const sourceEntries = [
    { file_path: contract.file_path, source_code: contract.source_code },
    ...contract.additional_sources,
  ];
  assert.equal(sourceEntries.length, target.sourceUnits);
  const sourceManifest = sourceEntries
    .map(({ file_path, source_code }) => [file_path, keccak256(toBytes(source_code))])
    .sort(([left], [right]) => left.localeCompare(right));
  assert.equal(keccak256(toBytes(JSON.stringify(sourceManifest))), target.sourceBundleHash);

  const settings = structuredClone(contract.compiler_settings);
  settings.outputSelection = {
    '*': {
      '*': [
        'abi',
        'evm.bytecode.object',
        'evm.deployedBytecode.object',
        'evm.deployedBytecode.immutableReferences',
      ],
    },
  };
  const output = JSON.parse(
    target.compiler.compile(
      JSON.stringify({
        language: 'Solidity',
        sources: Object.fromEntries(
          sourceEntries.map(({ file_path, source_code }) => [file_path, { content: source_code }]),
        ),
        settings,
      }),
    ),
  );
  assert.deepEqual(output.errors?.filter(({ severity }) => severity === 'error') ?? [], []);
  const compiled = output.contracts[contract.file_path][contract.name];
  assert.deepEqual(compiled.abi, contract.abi);

  const constructorArgs = contract.constructor_args
    ? contract.constructor_args.replace(/^0x/, '')
    : '';
  const creationBytecode = `0x${compiled.evm.bytecode.object}${constructorArgs}`;
  assert.equal(creationBytecode.toLowerCase(), contract.creation_bytecode.toLowerCase());
  assert.equal(keccak256(creationBytecode), target.creationHash);

  const transaction = await fetchJson(`${BLOCKSCOUT_API}/transactions/${target.transaction}`);
  assert.equal(transaction.status, 'ok');
  assert.equal(transaction.to.hash.toLowerCase(), DEPLOYER.toLowerCase());
  const salt = transaction.raw_input.slice(0, 66);
  assert.equal(`0x${transaction.raw_input.slice(66)}`.toLowerCase(), creationBytecode.toLowerCase());
  assert.equal(
    getCreate2Address({ from: DEPLOYER, salt, bytecodeHash: target.creationHash }).toLowerCase(),
    target.address.toLowerCase(),
  );

  const runtimeBytecode = materializeImmutables(
    compiled.evm.deployedBytecode.object,
    compiled.evm.deployedBytecode.immutableReferences,
    target.immutableValues,
  );
  assert.equal(runtimeBytecode.toLowerCase(), contract.deployed_bytecode.toLowerCase());
  assert.equal(keccak256(runtimeBytecode), target.runtimeHash);

  const rpcPayload = await fetchJson(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getCode',
      params: [target.address, 'latest'],
    }),
  });
  if (rpcPayload.error) throw new Error(rpcPayload.error.message);
  assert.equal(rpcPayload.result.toLowerCase(), runtimeBytecode.toLowerCase());

  results.push({
    name: target.name,
    address: target.address,
    compiler: target.compilerVersion,
    sourceUnits: target.sourceUnits,
    sourceBundleHash: target.sourceBundleHash,
    creationBytes: (creationBytecode.length - 2) / 2,
    creationHash: target.creationHash,
    runtimeBytes: (runtimeBytecode.length - 2) / 2,
    runtimeHash: target.runtimeHash,
    deploymentTransaction: target.transaction,
    byteForByteMatch: true,
  });
}

console.log(JSON.stringify({ senderCreator: SENDER_CREATOR, contracts: results }, null, 2));
