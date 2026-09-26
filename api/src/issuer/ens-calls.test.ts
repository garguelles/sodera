import { describe, expect, it } from 'vitest';
import { decodeFunctionData } from 'viem';
import { packetToBytes } from 'viem/ens';

import { ENSV2, factoryAbi, registrationAbi, resolverAbi } from '../ens/contracts.ts';
import { NAME_OWNER_ROLES, RESOLVER_OWNER_ROLES, registrationCall, resolverDeployment } from './ens-calls.ts';

const account = '0x1111111111111111111111111111111111111111';
const issuer = ENSV2.issuer;
const name = 'gargs.sodera.eth';
const proxyLogic = '0x2222222222222222222222222222222222222222';

describe('ENSv2 issuer calldata', () => {
  it('initializes a deterministic resolver with only the Kernel as writer and its ETH record', () => {
    const deployment = resolverDeployment({ account, issuer, name, proxyLogic });
    const factoryCall = decodeFunctionData({ abi: factoryAbi, data: deployment.data });
    if (factoryCall.functionName !== 'deployProxy') throw new Error('Expected factory deployProxy');
    expect(factoryCall.args[0].toLowerCase()).toBe(ENSV2.resolverImplementation.toLowerCase());
    const init = decodeFunctionData({ abi: resolverAbi, data: factoryCall.args[2] });
    if (init.functionName !== 'initialize') throw new Error('Expected resolver initialize');
    expect(init.args[0]).toEqual([{ account, roleBitmap: RESOLVER_OWNER_ROLES }]);
    expect(init.args[1]).toHaveLength(1);
    const record = decodeFunctionData({ abi: resolverAbi, data: init.args[1][0]! });
    expect(record).toMatchObject({
      functionName: 'setAddress',
      args: [`0x${Buffer.from(packetToBytes(name)).toString('hex')}`, 60n, account],
    });
    expect(resolverDeployment({ account, issuer, name, proxyLogic }).resolver).toBe(deployment.resolver);
    expect(resolverDeployment({ account, issuer: account, name, proxyLogic }).resolver).not.toBe(deployment.resolver);
  });

  it('registers one-year user-owned names with the exact owner roles and no child registry', () => {
    const expiry = 1_800_000_000n;
    const call = registrationCall({ label: 'gargs', account, resolver: '0x3333333333333333333333333333333333333333', expiry });
    const decoded = decodeFunctionData({ abi: registrationAbi, data: call.data });
    expect(decoded.functionName).toBe('register');
    expect(decoded.args).toEqual([
      'gargs', account, '0x0000000000000000000000000000000000000000',
      '0x3333333333333333333333333333333333333333', NAME_OWNER_ROLES, expiry,
    ]);
  });
});
