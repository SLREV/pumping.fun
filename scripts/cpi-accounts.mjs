/**
 * Cetak 16 akun `create_v2` (format siap pakai untuk wrapper Anchor di
 * contracts/pump-launcher) dan verifikasi bahwa serializer Rust kita
 * menghasilkan byte yang sama dengan SDK resmi.
 *
 *   node scripts/cpi-accounts.mjs
 */
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const pump = require('@pump-fun/pump-sdk');
const web3 = require('@solana/web3.js');

const mint = web3.Keypair.generate();
const creator = web3.Keypair.generate();

const ix = await pump.PUMP_SDK.createV2Instruction({
  mint: mint.publicKey,
  name: 'Pumping Cat',
  symbol: 'PUMPCAT',
  uri: 'https://ipfs.io/ipfs/bafycontoh',
  creator: creator.publicKey,
  user: creator.publicKey,
  mayhemMode: false,
});

const metas = ix.keys.map((key, index) => ({
  index,
  pubkey: key.pubkey.toBase58(),
  isSigner: key.isSigner,
  isWritable: key.isWritable,
}));

console.log('\nAkun create_v2 (remaining_accounts untuk wrapper Anchor):\n');
console.table(metas);
console.log('\nMint (signer baru):', mint.publicKey.toBase58());
console.log('Creator / user    :', creator.publicKey.toBase58());

/* ── Verifikasi serializer (mirror dari build_create_v2_data di Rust) ────── */

const DISCRIMINATOR = Array.from(createHash('sha256').update('global:create_v2').digest().subarray(0, 8));

function encodeStrings(values) {
  const chunks = [];
  for (const value of values) {
    const bytes = Buffer.from(value, 'utf8');
    const length = Buffer.alloc(4);
    length.writeUInt32LE(bytes.length);
    chunks.push(length, bytes);
  }
  return chunks;
}

const feeBps = 0n;
const manual = Buffer.concat([
  Buffer.from(DISCRIMINATOR),
  ...encodeStrings(['Pumping Cat', 'PUMPCAT', 'https://ipfs.io/ipfs/bafycontoh']),
  Buffer.from(creator.publicKey.toBytes()),
  Buffer.from([0]), // is_mayhem_mode
  Buffer.from([0]), // is_cashback_enabled
  (() => {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64LE(feeBps);
    return buf;
  })(),
  Buffer.from([0]), // is_holder_reward
]);

const sdk = Buffer.from(ix.data);
const identical = manual.length === sdk.length && manual.every((byte, i) => byte === sdk[i]);

console.log(`\nSerializer manual vs SDK: ${identical ? '✓ identik' : '✗ BERBEDA'} (${manual.length} vs ${sdk.length} byte)`);
if (!identical) {
  console.log('manual:', manual.toString('hex'));
  console.log('sdk   :', sdk.toString('hex'));
  process.exit(1);
}

console.log(`
Panggil wrapper:
  program : CcJghvKjRtUUayDHiefHpobwFDDjbfdtjXjBVF5Afosi
  instruksi: create_coin(name, symbol, uri, mayhem_mode, creator_fee_bps)
  accounts  : creator, mint, pump_program, lalu 16 akun di atas
`);
