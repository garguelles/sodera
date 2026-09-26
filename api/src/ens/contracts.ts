import { parseAbi, type Address } from 'viem';

export const ENSV2 = {
  parentOwner: '0x7Ed08e45067d7Bb1c064055eC99aCD6586453915',
  issuer: '0x9eF8EAad2fB225D19ECecC125B0Da54B8BE14CC0',
  publicTestKernel: '0x8c99983f0A1c91c41207ccFDaDddf0304565c142',
  root: '0x9703dbd26dab89504490994138cf2c575251a9ce',
  eth: '0x657ea849311d3d5823348dded7c2aaafb3ede09e',
  child: '0xfBb4ef18Db7F8044a0A19fD1Db7B192327811EC7',
  factory: '0x9e726eb570beb6bceb495ab8cda7df517d4e841c',
  implementation: '0xa80338aaa8d23831cea25e858d1774534abb0263',
  resolverImplementation: '0x14f09fd05d4585759e54844dc9b00147131cf243',
  passkeyValidator: '0x7ab16Ff354AcB328452F1D445b3Ddee9a91e9e69',
  kernelImplementation: '0xd6CEDDe84be40893d153Be9d467CD6aD37875b28',
} as const satisfies Record<string, Address>;

export const KERNEL_IMPLEMENTATION_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';

export const registryAbi = parseAbi([
  'function getSubregistry(string label) view returns (address)',
  'function getParent() view returns (address parent, string label)',
  'function getState(uint256 anyId) view returns ((uint8 status, uint64 expiry, address latestOwner, uint256 tokenId, uint256 resource))',
  'function roles(uint256 resource, address account) view returns (uint256)',
]);

export const factoryAbi = parseAbi([
  'function verifyContract(address proxy) view returns (address implementation)',
  'function proxyLogic() view returns (address)',
  'function deployProxy(address implementation, uint256 salt, bytes data) returns (address proxy)',
]);

export const resolverAbi = parseAbi([
  'function initialize((address account, uint256 roleBitmap)[] grants, bytes[] calls)',
  'function setAddress(bytes name, uint256 coinType, bytes addressBytes)',
  'function roles(uint256 resource, address account) view returns (uint256)',
  'function roleCount(uint256 resource) view returns (uint256)',
  'function resolve(bytes name, bytes data) view returns (bytes)',
]);

export const registrationAbi = parseAbi([
  'function register(string label, address owner, address registry, address resolver, uint256 roleBitmap, uint64 expiry) returns (uint256)',
  'function getResolver(string label) view returns (address)',
]);

export const kernelAbi = parseAbi([
  'function rootValidator() view returns (bytes21)',
  'function isModuleInstalled(uint256 moduleType, address module, bytes additionalContext) view returns (bool)',
]);

export const passkeyValidatorAbi = parseAbi([
  'function isInitialized(address smartAccount) view returns (bool)',
  'function webAuthnValidatorStorage(address kernel) view returns (uint256 pubKeyX, uint256 pubKeyY)',
]);
