import {
  concatHex,
  encodeAbiParameters,
  encodeFunctionData,
  getCreate2Address,
  keccak256,
  namehash,
  stringToHex,
  toHex,
  type Address,
} from 'viem';
import { packetToBytes } from 'viem/ens';

import { ENSV2, factoryAbi, registrationAbi, resolverAbi } from '../ens/contracts.ts';

const bit = (value: bigint) => 1n << value;
const admin = (role: bigint) => role << 128n;

export const RESOLVER_OWNER_ROLES = [bit(0n), bit(4n), bit(28n), bit(124n)]
  .reduce((roles, role) => roles | role | admin(role), 0n);
export const NAME_OWNER_ROLES = bit(20n) | admin(bit(20n)) |
  bit(24n) | admin(bit(24n)) | admin(bit(28n));

export function resolverDeployment({ account, name, issuer, proxyLogic }: {
  account: Address; name: string; issuer: Address; proxyLogic: Address;
}) {
  const salt = BigInt(keccak256(encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'address' }, { type: 'uint256' }],
    [keccak256(stringToHex('OwnedResolver')), account, 0n],
  )));
  const outerSalt = keccak256(encodeAbiParameters(
    [{ type: 'address' }, { type: 'uint256' }], [issuer, salt],
  ));
  const creationCode = concatHex([
    '0x3d604d80600a3d3981f3363d3d373d3d3d363d73',
    proxyLogic,
    '0x5af43d82803e903d91602b57fd5bf3',
    outerSalt,
  ]);
  const resolver = getCreate2Address({
    from: ENSV2.factory, salt: outerSalt, bytecodeHash: keccak256(creationCode),
  });
  const dnsName = toHex(packetToBytes(name));
  const initializer = encodeFunctionData({
    abi: resolverAbi,
    functionName: 'initialize',
    args: [
      [{ account, roleBitmap: RESOLVER_OWNER_ROLES }],
      [encodeFunctionData({ abi: resolverAbi, functionName: 'setAddress', args: [dnsName, 60n, account] })],
    ],
  });
  return {
    resolver, salt, dnsName,
    to: ENSV2.factory,
    data: encodeFunctionData({
      abi: factoryAbi, functionName: 'deployProxy',
      args: [ENSV2.resolverImplementation, salt, initializer],
    }),
  };
}

export function registrationCall({ label, account, resolver, expiry }: {
  label: string; account: Address; resolver: Address; expiry: bigint;
}) {
  if (expiry > (1n << 64n) - 1n) throw new Error('ENS expiry exceeds uint64');
  return {
    to: ENSV2.child,
    data: encodeFunctionData({
      abi: registrationAbi,
      functionName: 'register',
      args: [label, account, '0x0000000000000000000000000000000000000000', resolver, NAME_OWNER_ROLES, expiry],
    }),
  };
}

export function resolverAddressCall(name: string) {
  return {
    name: toHex(packetToBytes(name)),
    profile: encodeFunctionData({
      abi: [{ type: 'function', name: 'addr', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'address' }] }],
      functionName: 'addr', args: [namehash(name)],
    }),
  };
}
