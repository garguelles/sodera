import { Address as SdkAddress, AquaXYCAmmStrategy, MakerTraits, Order } from '@1inch/swap-vm-sdk';
import { getAddress, keccak256, type Address, type Hash, type Hex } from 'viem';

import { SEPOLIA_USDC_ADDRESS, SEPOLIA_WETH_ADDRESS } from './sepolia';

/** Earn's pool fee on the input amount, in basis points (30 = 0.30%). */
export const AQUA_FEE_BPS = 30;
export const AQUA_FEE_LABEL = '0.30%';

/** The two tokens every Earn position holds, in the order passed to `ship` and `dock`. */
export const AQUA_TOKENS = [SEPOLIA_USDC_ADDRESS, SEPOLIA_WETH_ADDRESS] as const satisfies readonly Address[];

export type AquaOrder = {
  /** ABI-encoded `ISwapVM.Order`; this is the `strategy` passed to `Aqua.ship`. */
  order: Hex;
  /** `keccak256(order)`, the id Aqua and the router both use for the position. */
  strategyHash: Hash;
};

/**
 * A full-range x·y=k USDC/WETH pool with a flat fee on the input amount, authorised through Aqua
 * rather than a signature. The salt makes each opened position's strategy hash unique.
 */
export function buildAquaOrder({ maker, salt }: { maker: Address; salt: bigint }): AquaOrder {
  if (salt <= 0n || salt >= 2n ** 64n) throw new Error('Aqua salt is out of range');

  const program = AquaXYCAmmStrategy.new().withFeeTokenIn(AQUA_FEE_BPS).withSalt(salt).build();
  const order = Order.new({
    maker: new SdkAddress(getAddress(maker)),
    program,
    traits: MakerTraits.default(),
  });
  const encoded = order.encode().toString() as Hex;
  return { order: encoded, strategyHash: keccak256(encoded) };
}
