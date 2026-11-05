import { readFileSync } from 'node:fs';
import { config } from '../config.ts';
import { launchCoin } from '../launch.ts';
import { ValidationError } from '../metadata.ts';

const argv = process.argv.slice(2);

const flag = (name: string): string | undefined => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
};
const has = (name: string): boolean => argv.includes(`--${name}`);

const imageArg = flag('image');
let image: string | undefined;
if (imageArg) {
  image = /^https?:\/\//i.test(imageArg)
    ? imageArg
    : `data:image/${guessMime(imageArg)};base64,${readFileSync(imageArg).toString('base64')}`;
}

function guessMime(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'jpeg';
  if (ext === 'gif') return 'gif';
  if (ext === 'webp') return 'webp';
  if (ext === 'svg') return 'svg+xml';
  return 'png';
}

const usage = `
pumping.fun — launcher coin via SDK resmi pump.fun

Pemakaian:
  npm run launch -- --name "Pumping Cat" --symbol PUMPCAT \\
      --description "Kucing yang menekan tombol pump" \\
      --image ./logo.png --dev-buy 0.5 \\
      --twitter x.com/pumpingfun --website pumping.fun

Flag:
  --name            Nama coin (wajib, maks 32 karakter)
  --symbol          Ticker (wajib, maks 10 karakter)
  --description     Deskripsi (maks 500 karakter)
  --image           Path file lokal atau URL https
  --dev-buy         SOL yang dibeli saat launch (default 0)
  --creator-fee     Creator fee dalam basis poin (0–1000)
  --mayhem          Aktifkan mayhem mode
  --holder-reward   Aktifkan holder reward
  --twitter/--telegram/--website
  --simulate        Paksa simulasi (tidak mengirim transaksi)

Environment: lihat .env.example (RPC_URL, LAUNCHER_SECRET_KEY, METADATA_PROVIDER).
`;

async function main(): Promise<void> {
  if (has('help') || argv.length === 0) {
    console.log(usage);
    return;
  }

  const name = flag('name');
  const symbol = flag('symbol');
  if (!name || !symbol) {
    console.error('✗ --name dan --symbol wajib diisi.\n');
    console.log(usage);
    process.exitCode = 1;
    return;
  }

  const simulate = has('simulate');
  console.log(`\n→ Menyiapkan coin ${name} ($${symbol.toUpperCase()})…`);
  console.log(`  network : ${config.network}`);
  console.log(`  provider: ${simulate ? 'self' : config.metadataProvider}\n`);

  const result = await launchCoin(
    {
      name,
      symbol,
      description: flag('description') ?? '',
      image,
      twitter: flag('twitter'),
      telegram: flag('telegram'),
      website: flag('website'),
      devBuySol: Number(flag('dev-buy') ?? 0),
      creatorFeeBps: Number(flag('creator-fee') ?? 0),
      mayhemMode: has('mayhem'),
      holderReward: has('holder-reward'),
    },
    { forceSimulation: simulate },
  );

  console.log(result.simulated ? '✓ SIMULASI selesai (tidak on-chain)' : '✓ Coin berhasil dibuat!');
  console.log(`  mint      : ${result.mint}`);
  console.log(`  signature : ${result.signature ?? '—'}`);
  console.log(`  metadata  : ${result.uri}`);
  console.log(`  explorer  : ${result.explorerUrl}`);
  console.log(`  pump.fun  : ${result.pumpUrl}`);
  if (result.tokensReceived) {
    console.log(`  dev buy   : ${result.devBuySol} SOL → ${Math.round(result.tokensReceived).toLocaleString('id-ID')} token`);
  }
  if (result.notice) console.log(`\n⚠ ${result.notice}`);
  console.log('');
}

main().catch((error: unknown) => {
  if (error instanceof ValidationError) {
    console.error(`✗ Input tidak valid: ${error.message}`);
  } else {
    console.error(`✗ Gagal: ${(error as Error).message}`);
  }
  process.exitCode = 1;
});
