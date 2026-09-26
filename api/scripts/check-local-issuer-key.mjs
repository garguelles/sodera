import { privateKeyToAccount } from 'viem/accounts';

const raw = process.env.ENS_ISSUER_PRIVATE_KEY;
const key = raw && /^[0-9a-fA-F]{64}$/.test(raw) ? `0x${raw}` : raw;
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
  throw new Error('Set ENS_ISSUER_PRIVATE_KEY to the issuer wallet key in the gitignored api/.env file');
}
const address = privateKeyToAccount(key).address;
if (address.toLowerCase() !== '0x9eF8EAad2fB225D19ECecC125B0Da54B8BE14CC0'.toLowerCase()) {
  throw new Error('ENS_ISSUER_PRIVATE_KEY does not match the approved issuer address');
}
console.log(`Issuer key matches approved address ${address}`);
