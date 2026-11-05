/**
 * Selftest offline — memastikan lapisan SDK, metadata, dan matematika curve
 * berjalan tanpa perlu RPC maupun saldo.
 *
 *   npm run selftest
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { simulateBuyOnNewCurve, snapshotFromRealSol } from '../curve.ts';
import { normalizeInput, resolveImage, uploadMetadata } from '../metadata.ts';
import { BN, pump, web3 } from '../sdk.ts';

let failures = 0;
const check = (label: string, condition: boolean, extra = ''): void => {
  if (condition) {
    console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ''}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`);
  }
};

async function main(): Promise<void> {
  console.log('\n1. SDK pump.fun');
  const mint = web3.Keypair.generate();
  const user = web3.Keypair.generate();
  const ix = await pump.PUMP_SDK.createV2Instruction({
    mint: mint.publicKey,
    name: 'Self Test',
    symbol: 'TEST',
    uri: 'https://example.com/metadata.json',
    creator: user.publicKey,
    user: user.publicKey,
    mayhemMode: false,
  });
  check('program id benar', ix.programId.equals(pump.PUMP_PROGRAM_ID), ix.programId.toBase58());
  check('16 account pada create_v2', ix.keys.length === 16, `${ix.keys.length} account`);
  check('instruction data terisi', ix.data.length > 50, `${ix.data.length} byte`);
  check('bonding curve PDA deterministik', pump.bondingCurvePda(mint.publicKey).equals(pump.bondingCurvePda(mint.publicKey)));

  const tx = new web3.Transaction().add(ix);
  tx.feePayer = user.publicKey;
  tx.recentBlockhash = web3.Keypair.generate().publicKey.toBase58();
  tx.sign(user, mint);
  const raw = tx.serialize();
  check('transaksi bisa diserialisasi', raw.length > 0, `${raw.length} byte`);

  console.log('\n2. Matematika bonding curve (offline)');
  const start = snapshotFromRealSol(0n, 150);
  check('market cap awal masuk akal', start.marketCapSol > 20 && start.marketCapSol < 40, `${start.marketCapSol.toFixed(2)} SOL`);
  check('progres awal 0', start.progress === 0);
  const buy = simulateBuyOnNewCurve(0.5, { solPriceUsd: 150 });
  check('0.5 SOL menghasilkan token', buy.tokensOut > 1_000_000, `${Math.round(buy.tokensOut).toLocaleString('id-ID')} token`);
  check('harga naik setelah beli', buy.priceAfterSol > start.priceSol);
  check('progres naik', buy.progress > 0, `${(buy.progress * 100).toFixed(2)}%`);

  console.log('\n3. Validasi input');
  const ok = normalizeInput({ name: 'Pumping Cat', symbol: '$pumpcat', description: 'hi', devBuySol: 0.2 });
  check('ticker dinormalisasi', ok.symbol === 'PUMPCAT', ok.symbol);
  let rejected = false;
  try {
    normalizeInput({ name: '', symbol: 'A', devBuySol: 0 });
  } catch {
    rejected = true;
  }
  check('nama kosong ditolak', rejected);
  rejected = false;
  try {
    normalizeInput({ name: 'Ok', symbol: 'ABC', devBuySol: 999 });
  } catch {
    rejected = true;
  }
  check('dev buy di atas batas ditolak', rejected);

  console.log('\n4. Gambar & metadata (provider self)');
  const avatar = await resolveImage(undefined, 'TEST');
  check('avatar SVG dibuat', avatar.mime === 'image/svg+xml', `${avatar.bytes.byteLength} byte`);
  const uploaded = await uploadMetadata(
    { ...ok, image: undefined },
    avatar,
    'self',
  );
  check('metadata di-host lokal', uploaded.uri.includes('/metadata/'), uploaded.uri);
  const filePath = join(process.cwd(), 'data', 'metadata', uploaded.uri.split('/').pop()!);
  check('file metadata tertulis', existsSync(filePath));
  if (existsSync(filePath)) {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as { symbol: string; image: string };
    check('isi metadata benar', parsed.symbol === 'PUMPCAT' && parsed.image.includes('/uploads/'));
  }

  console.log('\n5. Estimasi biaya transaksi');
  const feeLamports = 5000 * tx.instructions.length + 2039280; // kasar: signature + rent ATA
  check('perkiraan biaya < 0.01 SOL', feeLamports / 1e9 < 0.01, `${(feeLamports / 1e9).toFixed(5)} SOL`);
  check('BN kompatibel', new BN(1_000_000).toString() === '1000000');

  console.log('');
  if (failures === 0) {
    console.log('✓ Semua pemeriksaan lolos.\n');
  } else {
    console.error(`✗ ${failures} pemeriksaan gagal.\n`);
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error('✗ Selftest error:', (error as Error).message);
  process.exitCode = 1;
});
