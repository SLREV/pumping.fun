/** Konfigurasi runtime — semuanya dari environment variable (lihat .env.example). */

export type Network = 'mainnet-beta' | 'devnet';

const num = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const network = (process.env.NETWORK === 'devnet' ? 'devnet' : 'mainnet-beta') as Network;

const defaultRpc =
  network === 'devnet'
    ? 'https://api.devnet.solana.com'
    : 'https://api.mainnet-beta.solana.com';

export const config = {
  network,
  rpcUrl: process.env.RPC_URL?.trim() || defaultRpc,
  port: num(process.env.PORT, 3000),
  publicBaseUrl: (process.env.PUBLIC_BASE_URL?.trim() || 'http://localhost:3000').replace(/\/+$/, ''),

  launcherSecretKey: process.env.LAUNCHER_SECRET_KEY?.trim() || '',
  launcherKeypairPath: process.env.LAUNCHER_KEYPAIR_PATH?.trim() || './data/launcher.json',

  metadataProvider: (process.env.METADATA_PROVIDER?.trim() || 'pump') as 'pump' | 'pinata' | 'self',
  pinataJwt: process.env.PINATA_JWT?.trim() || '',
  pumpIpfsEndpoint: process.env.PUMP_IPFS_ENDPOINT?.trim() || 'https://frontend-api.pump.fun/ipfs',

  priorityFeeMicroLamports: num(process.env.PRIORITY_FEE_MICRO_LAMPORTS, 150_000),
  computeUnitLimit: num(process.env.COMPUTE_UNIT_LIMIT, 250_000),

  solPriceUsd: num(process.env.SOL_PRICE_USD, 150),
  maxDevBuySol: num(process.env.MAX_DEV_BUY_SOL, 5),

  version: '1.0.0',
} as const;

/** Alamat tidak sensitif untuk ditampilkan di dashboard. */
export const safeConfig = {
  network: config.network,
  rpcHost: (() => {
    try {
      return new URL(config.rpcUrl).host;
    } catch {
      return 'invalid-rpc-url';
    }
  })(),
  metadataProvider: config.metadataProvider,
  solPriceUsd: config.solPriceUsd,
  maxDevBuySol: config.maxDevBuySol,
  version: config.version,
};
