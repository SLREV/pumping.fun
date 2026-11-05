/**
 * Matematika bonding curve pump.fun — versi offline.
 *
 * Dipakai untuk:
 *  1. Mode SIMULASI (tanpa RPC / tanpa wallet) supaya dashboard tetap hidup.
 *  2. Estimasi cepat di UI sebelum transaksi dikirim.
 *
 * Untuk transaksi sungguhan, harga & fee selalu dihitung ulang oleh SDK resmi
 * (`getBuyTokenAmountFromSolAmount`) memakai state `Global` + `BondingCurve`
 * yang live, karena parameter program bisa berubah (mis. `initialVirtualQuoteReserves`).
 */

export const PUMP_DEFAULTS = {
  /** Supply total token (6 desimal). */
  tokenTotalSupply: 1_000_000_000n * 1_000_000n,
  /** Reserve token virtual saat curve dibuat. */
  initialVirtualTokenReserves: 1_073_000_000n * 1_000_000n,
  /** Reserve SOL virtual saat curve dibuat. */
  initialVirtualSolReserves: 30n * 1_000_000_000n,
  /** Token yang benar-benar dijual di curve. */
  realTokenReserves: 793_100_000n * 1_000_000n,
  /** Perkiraan SOL nyata yang terkumpul ketika curve "graduate". */
  graduationSol: 85,
  /** Perkiraan total fee trading (protocol + creator) dalam basis poin. */
  feeBps: 100,
} as const;

const LAMPORTS = 1_000_000_000;
const TOKEN_DECIMALS = 1_000_000;
const TOKEN_DECIMALS_BIG = 1_000_000n;

export type CurveSnapshot = {
  virtualSol: bigint;
  virtualToken: bigint;
  realSol: bigint;
  realToken: bigint;
  /** Harga 1 token dalam SOL. */
  priceSol: number;
  /** Market cap dalam SOL. */
  marketCapSol: number;
  /** Market cap dalam USD (perkiraan). */
  marketCapUsd: number;
  /** Progres menuju graduasi, 0..1. */
  progress: number;
  graduated: boolean;
};

export function snapshotFromRealSol(realSolLamports: bigint, solPriceUsd = 150): CurveSnapshot {
  const virtualSol = PUMP_DEFAULTS.initialVirtualSolReserves + realSolLamports;
  const virtualToken = PUMP_DEFAULTS.initialVirtualTokenReserves - realSolLamports;
  return buildSnapshot(virtualSol, virtualToken, realSolLamports, solPriceUsd);
}

function buildSnapshot(
  virtualSol: bigint,
  virtualToken: bigint,
  realSol: bigint,
  solPriceUsd: number,
): CurveSnapshot {
  const priceSol = Number(virtualSol) / LAMPORTS / (Number(virtualToken) / TOKEN_DECIMALS);
  const marketCapSol = priceSol * Number(PUMP_DEFAULTS.tokenTotalSupply / TOKEN_DECIMALS_BIG);
  const progress = Math.min(1, Number(realSol) / LAMPORTS / PUMP_DEFAULTS.graduationSol);
  return {
    virtualSol,
    virtualToken,
    realSol,
    realToken: PUMP_DEFAULTS.realTokenReserves,
    priceSol,
    marketCapSol,
    marketCapUsd: marketCapSol * solPriceUsd,
    progress,
    graduated: progress >= 1,
  };
}

export type BuyQuote = {
  /** SOL yang dibelanjakan (termasuk fee). */
  solIn: number;
  /** SOL yang benar-benar masuk ke curve setelah fee. */
  effectiveSol: number;
  /** Jumlah token diterima (satuan token utuh, bukan raw). */
  tokensOut: number;
  /** Harga rata-rata per token dalam SOL. */
  avgPriceSol: number;
  /** Harga token setelah transaksi. */
  priceAfterSol: number;
  /** Market cap setelah transaksi (SOL). */
  marketCapAfterSol: number;
  /** Progres curve setelah transaksi (0..1). */
  progress: number;
  /** Harga per token setelah transaksi (USD). */
  priceAfterUsd: number;
};

/**
 * Simulasi beli pada curve yang masih baru (belum ada pembeli sebelumnya).
 * Rumus constant-product: tokenOut = vTok - (vSol * vTok) / (vSol + solIn).
 */
export function simulateBuyOnNewCurve(
  solIn: number,
  options: { realSolLamports?: bigint; feeBps?: number; solPriceUsd?: number } = {},
): BuyQuote {
  const feeBps = options.feeBps ?? PUMP_DEFAULTS.feeBps;
  const solPriceUsd = options.solPriceUsd ?? 150;
  const realSol = options.realSolLamports ?? 0n;

  const virtualSol =
    PUMP_DEFAULTS.initialVirtualSolReserves + realSol + BigInt(Math.round(solIn * LAMPORTS * (1 - feeBps / 10_000)));
  const startVirtualSol = PUMP_DEFAULTS.initialVirtualSolReserves + realSol;
  const startVirtualToken = PUMP_DEFAULTS.initialVirtualTokenReserves - realSol;

  const effectiveSolLamports = Math.max(
    0,
    Math.round(solIn * LAMPORTS * (1 - feeBps / 10_000)),
  );
  const solAfter = startVirtualSol + BigInt(effectiveSolLamports);
  const tokenAfter =
    (startVirtualSol * startVirtualToken) / (solAfter === 0n ? 1n : solAfter);
  const tokensRaw = startVirtualToken - tokenAfter;

  const snapshot = buildSnapshot(virtualSol, tokenAfter, realSol + BigInt(effectiveSolLamports), solPriceUsd);

  return {
    solIn,
    effectiveSol: effectiveSolLamports / LAMPORTS,
    tokensOut: Number(tokensRaw) / TOKEN_DECIMALS,
    avgPriceSol: Number(tokensRaw) === 0 ? 0 : effectiveSolLamports / LAMPORTS / (Number(tokensRaw) / TOKEN_DECIMALS),
    priceAfterSol: snapshot.priceSol,
    marketCapAfterSol: snapshot.marketCapSol,
    progress: snapshot.progress,
    priceAfterUsd: snapshot.priceSol * solPriceUsd,
  };
}

export const formatSol = (value: number, digits = 3): string => {
  if (!Number.isFinite(value)) return '0';
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  if (value >= 1) return value.toFixed(digits);
  return value.toFixed(Math.min(6, digits + 2));
};

export const shortAddress = (address: string, size = 4): string =>
  address.length <= size * 2 + 3 ? address : `${address.slice(0, size)}…${address.slice(-size)}`;
