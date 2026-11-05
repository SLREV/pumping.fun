import { existsSync } from 'node:fs';
import { config } from '../config.ts';
import { web3 } from '../sdk.ts';
import { writeLauncherKeypair } from '../wallet.ts';

/**
 * Buat wallet launcher baru: `npm run wallet:new`
 * File disimpan di LAUNCHER_KEYPAIR_PATH (default data/launcher.json, mode 600).
 */
function main(): void {
  const path = config.launcherKeypairPath;

  if (existsSync(path)) {
    console.log(`⚠ Wallet sudah ada di ${path}.`);
    console.log('  Hapus file itu dulu kalau benar-benar ingin membuat yang baru.');
    return;
  }

  const keypair = web3.Keypair.generate();
  writeLauncherKeypair(path, keypair);

  const address = keypair.publicKey.toBase58();
  console.log('');
  console.log('  ✓ Wallet launcher dibuat');
  console.log(`  ├─ address : ${address}`);
  console.log(`  ├─ file    : ${path} (mode 600, sudah masuk .gitignore)`);
  console.log(`  └─ secret  : ${Buffer.from(keypair.secretKey).toString('base64').slice(0, 12)}… (disembunyikan)`);
  console.log('');
  if (config.network === 'devnet') {
    console.log('  Isi saldo devnet:');
    console.log(`  $ solana airdrop 2 ${address} --url devnet`);
  } else {
    console.log('  Kirim SOL mainnet ke alamat di atas (cukup ~0.05 SOL + dev buy).');
  }
  console.log('  Jangan pernah commit file keypair. Untuk produksi pakai KMS/HSM.\n');
}

main();
