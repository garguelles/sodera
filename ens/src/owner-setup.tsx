import { useState } from 'react';
import {
  concatHex,
  createPublicClient,
  createWalletClient,
  custom,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  getCreate2Address,
  keccak256,
  namehash,
  parseAbi,
  stringToHex,
  zeroAddress,
  type Address,
  type EIP1193Provider,
  type Hex,
} from 'viem';
import { sepolia } from 'viem/chains';

const owner = getAddress('0x7Ed08e45067d7Bb1c064055eC99aCD6586453915');
const rootRegistry = getAddress('0x9703dbd26dab89504490994138cf2c575251a9ce');
const ethRegistry = getAddress('0x657ea849311d3d5823348dded7c2aaafb3ede09e');
const factory = getAddress('0x9e726eb570beb6bceb495ab8cda7df517d4e841c');
const implementation = getAddress('0xa80338aaa8d23831cea25e858d1774534abb0263');
const ownerRoles = (1n << 8n) | (1n << 128n) | (1n << 144n);
const labelhash = BigInt(keccak256(stringToHex('sodera')));
const registryAbi = parseAbi([
  'function getSubregistry(string label) view returns (address)',
  'function getState(uint256 anyId) view returns ((uint8 status, uint64 expiry, address latestOwner, uint256 tokenId, uint256 resource))',
  'function getParent() view returns (address parent, string label)',
  'function roles(uint256 anyId, address account) view returns (uint256)',
  'function roleCount(uint256 anyId) view returns (uint256)',
  'function isEmancipated() view returns (bool)',
  'function setParent(address parent, string label)',
  'function setSubregistry(uint256 anyId, address registry)',
]);
const factoryAbi = parseAbi([
  'function proxyLogic() view returns (address)',
  'function verifyContract(address proxy) view returns (address implementation)',
  'function deployProxy(address implementation, uint256 salt, bytes data) returns (address proxy)',
]);

type Step = { title: string; to: Address; data: Hex; expected: string; complete: boolean };
type Setup = { child: Address; expires: string; steps: Step[] };

function provider() {
  const injected = (window as Window & { ethereum?: EIP1193Provider }).ethereum;
  if (!injected) throw new Error('Open this page in a browser with the MetaMask extension.');
  return injected;
}

async function inspect(injected: EIP1193Provider): Promise<Setup> {
  const client = createPublicClient({ chain: sepolia, transport: custom(injected) });
  if (await client.getChainId() !== sepolia.id) throw new Error('Switch MetaMask to Ethereum Sepolia.');
  const accounts = await createWalletClient({ chain: sepolia, transport: custom(injected) }).getAddresses();
  if (accounts.length === 0 || accounts[0].toLowerCase() !== owner.toLowerCase()) {
    throw new Error(`Select the sodera.eth owner wallet ${owner} in MetaMask.`);
  }
  const blockNumber = await client.getBlockNumber();
  const readOptions = { abi: registryAbi, blockNumber };
  const [ethPointer, state, mounted] = await Promise.all([
    client.readContract({ ...readOptions, address: rootRegistry, functionName: 'getSubregistry', args: ['eth'] }),
    client.readContract({ ...readOptions, address: ethRegistry, functionName: 'getState', args: [labelhash] }),
    client.readContract({ ...readOptions, address: ethRegistry, functionName: 'getSubregistry', args: ['sodera'] }),
  ]);
  if (ethPointer.toLowerCase() !== ethRegistry.toLowerCase()) throw new Error('The ENSv2 .eth pointer changed.');
  if (state.status !== 2 || state.latestOwner.toLowerCase() !== owner.toLowerCase()) {
    throw new Error('sodera.eth is no longer registered to the expected owner.');
  }
  if (Number(state.expiry) <= Date.now() / 1000 + 365 * 86400) {
    throw new Error('Renew sodera.eth before setting up annual user names.');
  }
  const parentRoles = await client.readContract({ ...readOptions, address: ethRegistry, functionName: 'roles', args: [labelhash, owner] });
  if ((parentRoles & (1n << 20n)) === 0n) throw new Error('The owner cannot mount the child registry.');

  const salt = BigInt(keccak256(encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }],
    [keccak256(stringToHex('UserRegistry')), namehash('sodera.eth'), 0n],
  )));
  const logic = await client.readContract({ address: factory, abi: factoryAbi, functionName: 'proxyLogic', blockNumber });
  const outerSalt = keccak256(encodeAbiParameters(
    [{ type: 'address' }, { type: 'uint256' }], [owner, salt],
  ));
  const child = getCreate2Address({
    from: factory,
    salt: outerSalt,
    bytecodeHash: keccak256(concatHex([
      '0x3d604d80600a3d3981f3363d3d373d3d3d363d73', logic,
      '0x5af43d82803e903d91602b57fd5bf3', outerSalt,
    ])),
  });
  if (mounted !== zeroAddress && mounted.toLowerCase() !== child.toLowerCase()) {
    throw new Error('Another child registry is already mounted. Stop and inspect it.');
  }
  const initializer = encodeFunctionData({
    abi: parseAbi(['function initialize((address account, uint256 roleBitmap)[] grants)']),
    functionName: 'initialize', args: [[{ account: owner, roleBitmap: ownerRoles }]],
  });
  const code = await client.getCode({ address: child, blockNumber });
  const deployed = Boolean(code && code !== '0x');
  let parentSet = false;
  if (deployed) {
    const [verified, roles, counts, emancipated, parent] = await Promise.all([
      client.readContract({ address: factory, abi: factoryAbi, functionName: 'verifyContract', args: [child], blockNumber }),
      client.readContract({ ...readOptions, address: child, functionName: 'roles', args: [0n, owner] }),
      client.readContract({ ...readOptions, address: child, functionName: 'roleCount', args: [0n] }),
      client.readContract({ ...readOptions, address: child, functionName: 'isEmancipated' }),
      client.readContract({ ...readOptions, address: child, functionName: 'getParent' }),
    ]);
    if (verified.toLowerCase() !== implementation.toLowerCase() ||
        roles !== ownerRoles || counts !== ownerRoles || !emancipated) {
      throw new Error('The child implementation or root grants differ from the reviewed configuration.');
    }
    if (parent[0] !== zeroAddress &&
        (parent[0].toLowerCase() !== ethRegistry.toLowerCase() || parent[1] !== 'sodera')) {
      throw new Error('The child already has a different canonical parent.');
    }
    parentSet = parent[0].toLowerCase() === ethRegistry.toLowerCase() && parent[1] === 'sodera';
  }
  if (mounted !== zeroAddress && !parentSet) throw new Error('The child is mounted without its canonical parent.');

  return {
    child,
    expires: new Date(Number(state.expiry) * 1000).toISOString(),
    steps: [
      {
        title: 'Deploy minimally permissioned UserRegistry', to: factory,
        data: encodeFunctionData({ abi: factoryAbi, functionName: 'deployProxy', args: [implementation, salt, initializer] }),
        expected: `Factory verifies ${child} as ${implementation}; owner root roles: SET_PARENT, REGISTRAR_ADMIN, RENEW_ADMIN`,
        complete: deployed,
      },
      {
        title: 'Set the canonical parent', to: child,
        data: encodeFunctionData({ abi: registryAbi, functionName: 'setParent', args: [ethRegistry, 'sodera'] }),
        expected: `getParent() = (${ethRegistry}, sodera)`, complete: parentSet,
      },
      {
        title: 'Mount the child under sodera.eth', to: ethRegistry,
        data: encodeFunctionData({ abi: registryAbi, functionName: 'setSubregistry', args: [labelhash, child] }),
        expected: `getSubregistry(sodera) = ${child}`, complete: mounted !== zeroAddress,
      },
    ],
  };
}

export function EnsOwnerSetup() {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [hash, setHash] = useState<Hex | null>(null);

  const connect = async () => {
    setBusy(true);
    setError('');
    setSetup(null);
    try {
      const injected = provider();
      await injected.request({ method: 'eth_requestAccounts' });
      setSetup(await inspect(injected));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not inspect the owner wallet.');
    } finally {
      setBusy(false);
    }
  };

  const submit = async (index: number) => {
    setBusy(true);
    setError('');
    setHash(null);
    try {
      const injected = provider();
      const fresh = await inspect(injected);
      if (fresh.steps[index].complete || fresh.steps.slice(0, index).some((step) => !step.complete)) {
        throw new Error('This step is already complete or an earlier step is unverified.');
      }
      const client = createWalletClient({ chain: sepolia, transport: custom(injected) });
      const step = fresh.steps[index];
      const submitted = await client.sendTransaction({ account: owner, to: step.to, data: step.data, value: 0n });
      setHash(submitted);
      const receipt = await createPublicClient({ chain: sepolia, transport: custom(injected) })
        .waitForTransactionReceipt({ hash: submitted });
      if (receipt.status !== 'success') throw new Error('The transaction reverted. Check its explorer receipt.');
      const checked = await inspect(injected);
      if (!checked.steps[index].complete) throw new Error('Receipt succeeded but the expected ENS state was not observed.');
      setSetup(checked);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The transaction could not be verified.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="ens-owner-page">
      <div className="ens-owner-panel">
        <p className="ens-eyebrow">SODERA / OWNER SETUP · SEPOLIA</p>
        <h1>Configure the namespace.</h1>
        <p>This local development page prepares three separate MetaMask transactions. Each requires your approval and a verified receipt. Nothing is submitted on connection.</p>
        <div className="ens-summary">
          <span>Expected owner <code>{owner}</code></span>
          {setup && <><span>Parent expires <code>{setup.expires}</code></span><span>Predicted child <code>{setup.child}</code></span></>}
        </div>
        <button disabled={busy} onClick={() => void connect()}>{busy ? 'Checking Sepolia…' : setup ? 'Recheck wallet and chain' : 'Connect MetaMask and inspect'}</button>
        {setup && <ol className="ens-steps">{setup.steps.map((step, index) => (
          <li key={step.title}>
            <div className="ens-step-heading"><strong>{step.title}</strong><span>{step.complete ? 'VERIFIED' : 'PENDING'}</span></div>
            <p>{step.expected}</p>
            <details><summary>Review destination and calldata</summary><p>To <code>{step.to}</code></p><p>Value: 0 ETH</p><code className="ens-calldata">{step.data}</code></details>
            {!step.complete && <button disabled={busy || setup.steps.slice(0, index).some((prior) => !prior.complete)} onClick={() => void submit(index)}>Review step {index + 1} in MetaMask</button>}
          </li>
        ))}</ol>}
        {hash && <p>Transaction: <a href={`https://eth-sepolia.blockscout.com/tx/${hash}`} rel="noreferrer" target="_blank">{hash}</a></p>}
        {error && <p role="alert" className="ens-error">{error}</p>}
        <p className="ens-note">This mounts an empty registry. It does not issue names, authorize an issuer or renewer, or lock the parent pointer. Do not use the generic ENS Explorer Deploy button as an additional step.</p>
      </div>
    </main>
  );
}
