/**
 * Inti "smart contract layer": semua instruksi on-chain dibangun lewat SDK
 * resmi pump.fun (`@pump-fun/pump-sdk`), lalu ditandatangani wallet launcher.
 *
 * Program pump.fun: 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P
 *   - create_v2        → membuat mint + bonding curve (token langsung bisa dibeli)
 *   - buy / buy_v2     → dev buy di transaksi yang sama (create + buy)
 */
import { randomUUID } from 'node:crypto';
import { config } from './config.ts';
import { PUMP_DEFAULTS, simulateBuyOnNewCurve, snapshotFromRealSol } from './curve.ts';
import {
  normalizeInput,
  resolveImage,
  uploadMetadata,
  type LaunchInput,
  type UploadResult,
} from './metadata.ts';
import { BN, pump, splToken, web3 } from './sdk.ts';
import { store, type LaunchRecord } from './store.ts';
import { loadLauncherKeypair } from './wallet.ts';

export type LaunchResult = {
  ok: true;
  simulated: boolean;
  mint: string;
  signature: string | null;
  uri: string;
  imageUrl: string;
  metadataProvider: string;
  name: string;
  symbol: string;
  devBuySol: number;
  tokensReceived: number | null;
  marketCapSol: number;
  progress: number;
  explorerUrl: string;
  pumpUrl: string;
  record: LaunchRecord;
  notice?: string;
};

const LAMPORTS_PER_SOL = 1_000_000_000;

const explorerBase = (): string =>
  config.network === 'devnet'
    ? 'https://explorer.solana.com/?cluster=devnet'
    : 'https://solscan.io';

export const explorerTxUrl = (signature: string): string =>
  config.network === 'devnet'
    ? `https://explorer.solana.com/tx/${signature}?cluster=devnet`
    : `https://solscan.io/tx/${signature}`;

export const explorerAddressUrl = (address: string): string =>
  config.network === 'devnet'
    ? `https://explorer.solana.com/address/${address}?cluster=devnet`
    : `https://solscan.io/account/${address}`;

export const pumpCoinUrl = (mint: string): string =>
  `https://pump.fun/coin/${mint}`;

export type Status = {
  network: string;
  rpcHost: string;
  rpcReachable: boolean;
  launcherAddress: string | null;
  launcherBalanceSol: number | null;
  simulation: boolean;
  metadataProvider: string;
  solPriceUsd: number;
  maxDevBuySol: number;
  pumpProgramId: string;
  version: string;
  reason?: string;
};

let cachedStatus: { at: number; value: Status } | null = null;

/** Cek kondisi RPC + wallet. Hasil di-cache 20 detik supaya dashboard ringan. */
export async function getStatus(force = false): Promise<Status> {
  if (!force && cachedStatus && Date.now() - cachedStatus.at < 20_000) return cachedStatus.value;

  const keypair = loadLauncherKeypair();
  const base: Status = {
    network: config.network,
    rpcHost: (() => {
      try {
        return new URL(config.rpcUrl).host;
      } catch {
        return 'invalid';
      }
    })(),
    rpcReachable: false,
    launcherAddress: keypair?.publicKey.toBase58() ?? null,
    launcherBalanceSol: null,
    simulation: true,
    metadataProvider: config.metadataProvider,
    solPriceUsd: config.solPriceUsd,
    maxDevBuySol: config.maxDevBuySol,
    pumpProgramId: pump.PUMP_PROGRAM_ID.toBase58(),
    version: config.version,
  };

  if (!keypair) {
    base.reason = 'Wallet launcher belum diset (LAUNCHER_SECRET_KEY / data/launcher.json).';
    cachedStatus = { at: Date.now(), value: base };
    return base;
  }

  try {
    const connection = new web3.Connection(config.rpcUrl, 'confirmed');
    const balance = await withTimeout(connection.getBalance(keypair.publicKey), 8_000);
    base.rpcReachable = true;
    base.launcherBalanceSol = balance / LAMPORTS_PER_SOL;
    base.simulation = balance === 0;
    if (balance === 0) base.reason = 'Saldo wallet launcher 0 SOL — transaksi tidak akan berhasil.';
  } catch (error) {
    base.reason = `RPC tidak terjangkau: ${(error as Error).message}`;
  }

  cachedStatus = { at: Date.now(), value: base };
  return base;
}

export function invalidateStatus(): void {
  cachedStatus = null;
}

export type LaunchOptions = {
  /** Paksa mode simulasi (dipakai dashboard untuk "coba dulu"). */
  forceSimulation?: boolean;
  /** Override provider metadata (mis. 'self' saat simulasi). */
  metadataProvider?: 'pump' | 'pinata' | 'self';
};

/**
 * Alur lengkap pembuatan token:
 *   1. validasi input
 *   2. siapkan gambar (upload / avatar generatif)
 *   3. upload metadata → dapat `uri`
 *   4. bangun instruksi create_v2 (+ dev buy) lewat SDK
 *   5. tanda tangani & kirim, lalu simpan riwayat
 */
export async function launchCoin(
  raw: Partial<LaunchInput>,
  options: LaunchOptions = {},
): Promise<LaunchResult> {
  const input = normalizeInput(raw);
  const status = await getStatus();

  const simulated = options.forceSimulation === true || status.simulation;
  const provider = options.metadataProvider ?? (simulated ? 'self' : config.metadataProvider);

  const image = await resolveImage(input.image, input.symbol);
  const uploaded: UploadResult = await uploadMetadata(input, image, provider);

  const quote = simulateBuyOnNewCurve(input.devBuySol, {
    feeBps: PUMP_DEFAULTS.feeBps,
    solPriceUsd: config.solPriceUsd,
  });

  const record: LaunchRecord = {
    id: randomUUID(),
    mint: '',
    name: input.name,
    symbol: input.symbol,
    description: input.description,
    imageUrl: uploaded.imageUrl,
    uri: uploaded.uri,
    creator: status.launcherAddress ?? 'SimulasiLauncher1111111111111111111111111111',
    devBuySol: input.devBuySol,
    tokensReceived: input.devBuySol > 0 ? quote.tokensOut : null,
    signature: null,
    simulated,
    createdAt: new Date().toISOString(),
    marketCapSol: input.devBuySol > 0 ? quote.marketCapAfterSol : snapshotFromRealSol(0n, config.solPriceUsd).marketCapSol,
    progress: input.devBuySol > 0 ? quote.progress : 0,
    graduated: false,
    links: { twitter: input.twitter, telegram: input.telegram, website: input.website },
    source: 'user',
  };

  if (simulated) {
    record.mint = randomMintAddress();
    record.signature = `SIM${randomUUID().replace(/-/g, '').slice(0, 40)}`;
    store.add(record);
    return {
      ok: true,
      simulated: true,
      mint: record.mint,
      signature: record.signature,
      uri: uploaded.uri,
      imageUrl: uploaded.imageUrl,
      metadataProvider: uploaded.provider,
      name: record.name,
      symbol: record.symbol,
      devBuySol: record.devBuySol,
      tokensReceived: record.tokensReceived,
      marketCapSol: record.marketCapSol,
      progress: record.progress,
      explorerUrl: explorerAddressUrl(record.mint),
      pumpUrl: pumpCoinUrl(record.mint),
      record,
      notice:
        'Mode SIMULASI: tidak ada transaksi on-chain yang dikirim. Set wallet launcher + RPC untuk launch sungguhan.',
    };
  }

  const { mint, signature, tokensReceived } = await sendCreateTransaction(input, uploaded, status);
  record.mint = mint;
  record.signature = signature;
  record.tokensReceived = tokensReceived ?? record.tokensReceived;
  store.add(record);

  return {
    ok: true,
    simulated: false,
    mint,
    signature,
    uri: uploaded.uri,
    imageUrl: uploaded.imageUrl,
    metadataProvider: uploaded.provider,
    name: record.name,
    symbol: record.symbol,
    devBuySol: record.devBuySol,
    tokensReceived: record.tokensReceived,
    marketCapSol: record.marketCapSol,
    progress: record.progress,
    explorerUrl: explorerAddressUrl(mint),
    pumpUrl: pumpCoinUrl(mint),
    record,
  };
}

/** Bangun, tanda tangani, dan kirim transaksi create_v2 (+ dev buy). */
async function sendCreateTransaction(
  input: LaunchInput,
  uploaded: UploadResult,
  status: Status,
): Promise<{ mint: string; signature: string; tokensReceived: number | null }> {
  const launcher = loadLauncherKeypair();
  if (!launcher) throw new Error('Wallet launcher belum disiapkan.');

  const connection = new web3.Connection(config.rpcUrl, 'confirmed');
  const online = new pump.OnlinePumpSdk(connection);
  const mintKeypair = web3.Keypair.generate();

  const global = await withTimeout(online.fetchGlobal(), 15_000);
  const feeConfig = await withTimeout(online.fetchFeeConfig(), 15_000);

  const instructions: InstanceType<typeof web3.TransactionInstruction>[] = [];

  instructions.push(
    web3.ComputeBudgetProgram.setComputeUnitLimit({ units: config.computeUnitLimit }),
  );
  if (config.priorityFeeMicroLamports > 0) {
    instructions.push(
      web3.ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: config.priorityFeeMicroLamports,
      }),
    );
  }

  let tokensReceived: number | null = null;

  if (input.devBuySol > 0) {
    const solLamports = Math.round(input.devBuySol * LAMPORTS_PER_SOL);
    // Harga token untuk dev buy, dihitung SDK dari state Global yang live.
    const amount = pump.getBuyTokenAmountFromSolAmount({
      global,
      feeConfig,
      mintSupply: null,
      bondingCurve: null,
      amount: new BN(solLamports),
      quoteMint: splToken.NATIVE_MINT,
      creatorFeeBps: input.creatorFeeBps ? new BN(input.creatorFeeBps) : undefined,
    });

    const createAndBuy = await pump.PUMP_SDK.createV2AndBuyInstructions({
      global,
      mint: mintKeypair.publicKey,
      name: input.name,
      symbol: input.symbol,
      uri: uploaded.uri,
      creator: launcher.publicKey,
      user: launcher.publicKey,
      amount,
      solAmount: new BN(solLamports),
      mayhemMode: Boolean(input.mayhemMode),
      creatorFeeBps: input.creatorFeeBps ? new BN(input.creatorFeeBps) : undefined,
      holderReward: Boolean(input.holderReward),
    });
    instructions.push(...createAndBuy);
    tokensReceived = Number(amount.toString()) / 1_000_000;
  } else {
    instructions.push(
      await pump.PUMP_SDK.createV2Instruction({
        mint: mintKeypair.publicKey,
        name: input.name,
        symbol: input.symbol,
        uri: uploaded.uri,
        creator: launcher.publicKey,
        user: launcher.publicKey,
        mayhemMode: Boolean(input.mayhemMode),
        creatorFeeBps: input.creatorFeeBps ? new BN(input.creatorFeeBps) : undefined,
        holderReward: Boolean(input.holderReward),
      }),
    );
  }

  const latest = await withTimeout(connection.getLatestBlockhash('confirmed'), 15_000);
  const transaction = new web3.Transaction({
    feePayer: launcher.publicKey,
    blockhash: latest.blockhash,
    lastValidBlockHeight: latest.lastValidBlockHeight,
  });
  transaction.add(...instructions);

  transaction.sign(launcher, mintKeypair);

  const raw = transaction.serialize();
  const signature = await connection.sendRawTransaction(raw, {
    skipPreflight: false,
    maxRetries: 3,
    preflightCommitment: 'confirmed',
  });

  const confirmation = await connection.confirmTransaction(
    { signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
    'confirmed',
  );
  if (confirmation.value.err) {
    throw new Error(`Transaksi gagal on-chain: ${JSON.stringify(confirmation.value.err)}`);
  }

  invalidateStatus();
  return { mint: mintKeypair.publicKey.toBase58(), signature, tokensReceived };
}

/** Estimasi harga untuk UI (tanpa kirim transaksi). */
export function quoteLaunch(devBuySol: number) {
  const quote = simulateBuyOnNewCurve(devBuySol, {
    feeBps: PUMP_DEFAULTS.feeBps,
    solPriceUsd: config.solPriceUsd,
  });
  const start = snapshotFromRealSol(0n, config.solPriceUsd);
  return {
    start: {
      priceSol: start.priceSol,
      priceUsd: start.priceSol * config.solPriceUsd,
      marketCapSol: start.marketCapSol,
      marketCapUsd: start.marketCapUsd,
    },
    after: {
      priceSol: quote.priceAfterSol,
      priceUsd: quote.priceAfterUsd,
      marketCapSol: quote.marketCapAfterSol,
      marketCapUsd: quote.marketCapAfterSol * config.solPriceUsd,
      tokensOut: quote.tokensOut,
      progress: quote.progress,
    },
    feeBps: PUMP_DEFAULTS.feeBps,
    solPriceUsd: config.solPriceUsd,
    explorerBase: explorerBase(),
  };
}

export function randomMintAddress(): string {
  return web3.Keypair.generate().publicKey.toBase58();
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timeout ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
