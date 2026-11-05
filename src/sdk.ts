/**
 * Jembatan kecil ke SDK resmi pump.fun.
 *
 * Kenapa pakai createRequire?
 * Build ESM `@pump-fun/pump-sdk` meng-import `@coral-xyz/anchor` (paket CommonJS)
 * dengan named export, yang gagal di Node ESM ("Named export 'BN' not found").
 * Build CJS-nya normal, jadi kita muat lewat require dan tetap memakai tipe
 * TypeScript penuh lewat `typeof import(...)`.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export const pump: typeof import('@pump-fun/pump-sdk') = require('@pump-fun/pump-sdk');
export const web3: typeof import('@solana/web3.js') = require('@solana/web3.js');
export const splToken: typeof import('@solana/spl-token') = require('@solana/spl-token');

/** BN dari dependency SDK, supaya instance-nya identik dengan yang dicek SDK. */
export const BN: typeof import('bn.js') = require('bn.js');

export type { BondingCurve, FeeConfig, Global } from '@pump-fun/pump-sdk';
