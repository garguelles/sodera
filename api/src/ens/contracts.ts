import { parseAbi, type Address } from 'viem';

export const ENSV2 = {
  parentOwner: '0x7Ed08e45067d7Bb1c064055eC99aCD6586453915',
  root: '0x9703dbd26dab89504490994138cf2c575251a9ce',
  eth: '0x657ea849311d3d5823348dded7c2aaafb3ede09e',
  child: '0xfBb4ef18Db7F8044a0A19fD1Db7B192327811EC7',
  factory: '0x9e726eb570beb6bceb495ab8cda7df517d4e841c',
  implementation: '0xa80338aaa8d23831cea25e858d1774534abb0263',
} as const satisfies Record<string, Address>;

export const registryAbi = parseAbi([
  'function getSubregistry(string label) view returns (address)',
  'function getParent() view returns (address parent, string label)',
  'function getState(uint256 anyId) view returns ((uint8 status, uint64 expiry, address latestOwner, uint256 tokenId, uint256 resource))',
]);

export const factoryAbi = parseAbi([
  'function verifyContract(address proxy) view returns (address implementation)',
]);
