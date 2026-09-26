import { parseAbi } from 'viem';

export const ENSV2 = Object.freeze({
  owner: '0x7Ed08e45067d7Bb1c064055eC99aCD6586453915',
  rootRegistry: '0x9703dbd26dab89504490994138cf2c575251a9ce',
  ethRegistry: '0x657ea849311d3d5823348dded7c2aaafb3ede09e',
  childRegistry: '0xfBb4ef18Db7F8044a0A19fD1Db7B192327811EC7',
  factory: '0x9e726eb570beb6bceb495ab8cda7df517d4e841c',
  userRegistryImpl: '0xa80338aaa8d23831cea25e858d1774534abb0263',
  resolverImpl: '0x14f09fd05d4585759e54844dc9b00147131cf243',
  universalResolver: '0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe',
});

export const registryAbi = parseAbi([
  'function getSubregistry(string label) view returns (address)',
  'function getParent() view returns (address parent, string label)',
  'function getState(uint256 anyId) view returns ((uint8 status, uint64 expiry, address latestOwner, uint256 tokenId, uint256 resource))',
  'function roles(uint256 anyId, address account) view returns (uint256)',
  'function roleCount(uint256 anyId) view returns (uint256)',
  'function isEmancipated() view returns (bool)',
  'function setParent(address parent, string label)',
  'function setSubregistry(uint256 anyId, address registry)',
  'function grantRootRoles(uint256 roleBitmap, address account) returns (bool)',
]);

export const factoryAbi = parseAbi([
  'function verifyContract(address proxy) view returns (address implementation)',
  'function proxyLogic() view returns (address)',
  'function deployProxy(address implementation, uint256 salt, bytes data) returns (address proxy)',
]);
