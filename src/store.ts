import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { bs58Encode } from './wallet.ts';

export type LaunchLinks = {
  twitter?: string;
  telegram?: string;
  website?: string;
};

export type LaunchRecord = {
  id: string;
  mint: string;
  name: string;
  symbol: string;
  description: string;
  imageUrl: string | null;
  uri: string | null;
  creator: string;
  devBuySol: number;
  tokensReceived: number | null;
  signature: string | null;
  simulated: boolean;
  createdAt: string;
  marketCapSol: number;
  progress: number;
  graduated: boolean;
  links: LaunchLinks;
  source: 'user' | 'demo';
};

const FILE = join(process.cwd(), 'data', 'launches.json');

class LaunchStore {
  private records: LaunchRecord[] | null = null;

  private load(): LaunchRecord[] {
    if (this.records) return this.records;
    try {
      if (existsSync(FILE)) {
        const parsed = JSON.parse(readFileSync(FILE, 'utf8')) as LaunchRecord[];
        this.records = Array.isArray(parsed) ? parsed : [];
      } else {
        this.records = [];
      }
    } catch (error) {
      console.warn('[store] gagal membaca data/launches.json:', (error as Error).message);
      this.records = [];
    }
    return this.records;
  }

  private persist(): void {
    try {
      const dir = dirname(FILE);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(FILE, JSON.stringify(this.records ?? [], null, 2));
    } catch (error) {
      console.warn('[store] gagal menyimpan launches:', (error as Error).message);
    }
  }

  add(record: LaunchRecord): LaunchRecord {
    const list = this.load();
    list.unshift(record);
    this.records = list.slice(0, 200);
    this.persist();
    return record;
  }

  byMint(mint: string): LaunchRecord | undefined {
    return this.load().find((record) => record.mint === mint);
  }

  /** Riwayat launch milik server ini (tanpa data demo). */
  list(): LaunchRecord[] {
    return [...this.load()];
  }
}

export const store = new LaunchStore();

export const randomAddress = (): string => bs58Encode(randomBytes(32));

/**
 * Data contoh untuk mengisi dashboard saat belum ada launch sungguhan.
 * Semua entri ditandai `source: 'demo'` supaya UI bisa memberi label.
 */
export function demoCoins(): LaunchRecord[] {
  const seed: Array<{
    name: string;
    symbol: string;
    description: string;
    mcapSol: number;
    progress: number;
    minutesAgo: number;
  }> = [
    { name: 'Pumping Cat', symbol: 'PUMPCAT', description: 'Kucing yang menekan tombol pump.', mcapSol: 412, progress: 0.87, minutesAgo: 24 },
    { name: 'Solana Rats', symbol: 'RATS', description: 'Tikus jalanan yang paham chart.', mcapSol: 96, progress: 0.34, minutesAgo: 7 },
    { name: 'Moon Sate', symbol: 'SATE', description: 'Sate madura tapi on-chain.', mcapSol: 58, progress: 0.21, minutesAgo: 12 },
    { name: 'Based Ketoprak', symbol: 'KTPRK', description: 'Ketoprak dengan likuiditas dalam.', mcapSol: 27, progress: 0.11, minutesAgo: 41 },
    { name: 'Jajan Bull', symbol: 'JAJAN', description: 'Bull yang suka jajan di warung.', mcapSol: 18, progress: 0.07, minutesAgo: 63 },
    { name: 'Rugpull Antidote', symbol: 'ANTIDOTE', description: 'Obat untuk luka hati kena rug.', mcapSol: 63, progress: 0.62, minutesAgo: 88 },
    { name: 'Cikarang Whale', symbol: 'WHALE', description: 'Paus dari Cikarang, bukan laut.', mcapSol: 7.4, progress: 0.03, minutesAgo: 3 },
    { name: 'Gorengan DAO', symbol: 'GORENG', description: 'DAO yang cuma rapat sambil makan gorengan.', mcapSol: 33, progress: 0.48, minutesAgo: 31 },
    { name: 'Mie Ayam Maxi', symbol: 'MIEAYAM', description: 'Mie ayam porsi dewa.', mcapSol: 112, progress: 0.71, minutesAgo: 52 },
    { name: 'Satoshi Warkop', symbol: 'WARKOP', description: 'Ngopi sambil baca whitepaper.', mcapSol: 4.2, progress: 0.02, minutesAgo: 1 },
    { name: 'Degen Pasar', symbol: 'DEGEN', description: 'Trader pasar Indodax generasi baru.', mcapSol: 76, progress: 0.55, minutesAgo: 19 },
    { name: 'Tuyul Finance', symbol: 'TUYUL', description: 'Protokol yang menghilang perlahan.', mcapSol: 2.1, progress: 0.01, minutesAgo: 0 },
  ];

  return seed.map((coin, index) => ({
    id: `demo-${index}`,
    mint: randomAddress(),
    name: coin.name,
    symbol: coin.symbol,
    description: coin.description,
    imageUrl: null,
    uri: null,
    creator: randomAddress(),
    devBuySol: 0.5,
    tokensReceived: null,
    signature: null,
    simulated: true,
    createdAt: new Date(Date.now() - coin.minutesAgo * 60_000).toISOString(),
    marketCapSol: coin.mcapSol,
    progress: coin.progress,
    graduated: coin.progress >= 1,
    links: {},
    source: 'demo',
  }));
}
