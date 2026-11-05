import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.ts';
import { web3 } from './sdk.ts';

export type Keypair = InstanceType<typeof web3.Keypair>;

/** Terima secret key dalam format base58 (dari Phantom "Export Private Key") atau JSON array. */
export function keypairFromSecret(secret: string): Keypair {
  const trimmed = secret.trim();
  if (trimmed.startsWith('[')) {
    const bytes = Uint8Array.from(JSON.parse(trimmed) as number[]);
    return web3.Keypair.fromSecretKey(bytes);
  }
  return web3.Keypair.fromSecretKey(bs58Decode(trimmed));
}

/** Decoder base58 kecil-kecilan supaya tidak perlu dependency tambahan. */
export function bs58Decode(input: string): Uint8Array {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const bytes: number[] = [0];
  for (const char of input) {
    const value = alphabet.indexOf(char);
    if (value < 0) throw new Error(`Karakter base58 tidak valid: ${char}`);
    let carry = value;
    for (let i = 0; i < bytes.length; i += 1) {
      carry += bytes[i]! * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const char of input) {
    if (char !== '1') break;
    bytes.push(0);
  }
  return Uint8Array.from(bytes.reverse());
}

export function bs58Encode(bytes: Uint8Array): string {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const digits: number[] = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i += 1) {
      carry += digits[i]! << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = '';
  for (const byte of bytes) {
    if (byte !== 0) break;
    out += '1';
  }
  for (let i = digits.length - 1; i >= 0; i -= 1) out += alphabet[digits[i]!];
  return out;
}

/**
 * Muat keypair penanda tangan dari:
 *   1. LAUNCHER_SECRET_KEY (base58 / JSON array)
 *   2. file LAUNCHER_KEYPAIR_PATH (format `solana-keygen` atau JSON)
 * Mengembalikan null kalau belum ada → server masuk mode SIMULASI.
 */
export function loadLauncherKeypair(): Keypair | null {
  try {
    if (config.launcherSecretKey) return keypairFromSecret(config.launcherSecretKey);
    if (existsSync(config.launcherKeypairPath)) {
      const raw = readFileSync(config.launcherKeypairPath, 'utf8').trim();
      if (!raw) return null;
      return keypairFromSecret(raw);
    }
    return null;
  } catch (error) {
    console.warn('[wallet] gagal memuat launcher keypair:', (error as Error).message);
    return null;
  }
}

export function writeLauncherKeypair(path: string, keypair: Keypair): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(Array.from(keypair.secretKey)), { mode: 0o600 });
}
