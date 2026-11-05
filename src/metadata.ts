import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.ts';

export type LaunchInput = {
  name: string;
  symbol: string;
  description: string;
  /** URL gambar, atau data URL (base64) hasil upload dari browser. */
  image?: string;
  twitter?: string;
  telegram?: string;
  website?: string;
  devBuySol: number;
  slippageBps?: number;
  creatorFeeBps?: number;
  mayhemMode?: boolean;
  holderReward?: boolean;
};

export type MetadataJson = {
  name: string;
  symbol: string;
  description: string;
  image: string;
  showName: boolean;
  createdOn: string;
  twitter?: string;
  telegram?: string;
  website?: string;
};

export class ValidationError extends Error {}

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/** Bersihkan + validasi input dari form / CLI. */
export function normalizeInput(raw: Partial<LaunchInput>): LaunchInput {
  const name = (raw.name ?? '').trim();
  const symbol = (raw.symbol ?? '').trim().replace(/^\$/, '');
  const description = (raw.description ?? '').trim();

  if (name.length < 1 || name.length > 32) {
    throw new ValidationError('Nama coin wajib 1–32 karakter.');
  }
  if (!/^[A-Za-z0-9 ]+$/.test(name)) {
    throw new ValidationError('Nama coin hanya boleh huruf, angka, dan spasi.');
  }
  if (!/^[A-Za-z0-9]{1,10}$/.test(symbol)) {
    throw new ValidationError('Ticker wajib 1–10 karakter alfanumerik (tanpa spasi).');
  }
  if (description.length > 500) {
    throw new ValidationError('Deskripsi maksimal 500 karakter.');
  }

  const devBuySol = Number(raw.devBuySol ?? 0);
  if (!Number.isFinite(devBuySol) || devBuySol < 0) {
    throw new ValidationError('Dev buy harus angka ≥ 0.');
  }
  if (devBuySol > config.maxDevBuySol) {
    throw new ValidationError(
      `Dev buy ${devBuySol} SOL melebihi batas MAX_DEV_BUY_SOL (${config.maxDevBuySol}).`,
    );
  }

  const creatorFeeBps = Math.trunc(Number(raw.creatorFeeBps ?? 0));
  if (creatorFeeBps < 0 || creatorFeeBps > 1000) {
    throw new ValidationError('Creator fee harus 0–1000 bps (0–10%).');
  }

  const slippageBps = Math.trunc(Number(raw.slippageBps ?? 100));
  if (slippageBps < 1 || slippageBps > 5000) {
    throw new ValidationError('Slippage harus 1–5000 bps.');
  }

  return {
    name,
    symbol: symbol.toUpperCase(),
    description,
    image: raw.image?.trim() || undefined,
    twitter: cleanUrl(raw.twitter),
    telegram: cleanUrl(raw.telegram),
    website: cleanUrl(raw.website),
    devBuySol,
    slippageBps,
    creatorFeeBps,
    mayhemMode: Boolean(raw.mayhemMode),
    holderReward: Boolean(raw.holderReward),
  };
}

function cleanUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('protokol');
    if (withScheme.length > 200) throw new Error('terlalu panjang');
    return withScheme;
  } catch {
    throw new ValidationError(`Link tidak valid: ${trimmed}`);
  }
}

export type ImageAsset = { bytes: Uint8Array; mime: string; filename: string };

/** Ubah input gambar (data URL / URL publik) menjadi bytes siap upload. */
export async function resolveImage(image: string | undefined, symbol: string): Promise<ImageAsset> {
  if (!image) return svgAvatar(symbol);

  if (image.startsWith('data:')) {
    const match = /^data:([^;,]+);base64,(.+)$/s.exec(image);
    if (!match) throw new ValidationError('Format data URL gambar tidak dikenali.');
    const mime = match[1]!;
    if (!/^image\/(png|jpe?g|gif|webp|svg\+xml)$/.test(mime)) {
      throw new ValidationError('Format gambar harus PNG, JPG, GIF, WEBP, atau SVG.');
    }
    const bytes = Buffer.from(match[2]!, 'base64');
    if (bytes.byteLength > MAX_IMAGE_BYTES) throw new ValidationError('Ukuran gambar maksimal 4 MB.');
    return { bytes, mime, filename: `logo.${mime.split('/')[1]!.replace('svg+xml', 'svg')}` };
  }

  if (/^https?:\/\//i.test(image)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(image, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const mime = response.headers.get('content-type')?.split(';')[0] ?? 'image/png';
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > MAX_IMAGE_BYTES) throw new ValidationError('Ukuran gambar maksimal 4 MB.');
      return { bytes, mime, filename: `logo.${mime.split('/')[1] ?? 'png'}` };
    } catch (error) {
      console.warn('[metadata] gagal mengunduh gambar, pakai avatar generatif:', (error as Error).message);
      return svgAvatar(symbol);
    } finally {
      clearTimeout(timer);
    }
  }

  throw new ValidationError('Gambar harus URL https atau upload file.');
}

/** Avatar SVG deterministik — dipakai kalau user tidak upload gambar. */
export function svgAvatar(seed: string): ImageAsset {
  const palette = [
    ['#00ffa3', '#00c2ff'],
    ['#ff2d95', '#7a5cff'],
    ['#ffb800', '#ff3d00'],
    ['#3ef0a0', '#00c853'],
    ['#8a2be2', '#00d4ff'],
    ['#ff6f61', '#ffd166'],
  ];
  const hash = createHash('sha256').update(seed || 'pump').digest();
  const [from, to] = palette[hash[0]! % palette.length]!;
  const angle = hash[1]! % 360;
  const letter = (seed || 'P').slice(0, 1).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">
  <defs><linearGradient id="g" gradientTransform="rotate(${angle} .5 .5)">
    <stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>
  </linearGradient></defs>
  <rect width="400" height="400" rx="64" fill="url(#g)"/>
  <circle cx="200" cy="200" r="120" fill="rgba(0,0,0,.28)"/>
  <text x="200" y="252" font-family="Inter,Arial,sans-serif" font-size="180" font-weight="800"
        fill="#ffffff" text-anchor="middle">${letter}</text>
</svg>`;
  return { bytes: Buffer.from(svg, 'utf8'), mime: 'image/svg+xml', filename: 'logo.svg' };
}

export type UploadResult = { uri: string; provider: string; imageUrl: string; metadata: MetadataJson };

/**
 * Upload metadata + gambar ke storage yang bisa dibaca publik.
 * pump.fun butuh `uri` berupa URL JSON (biasanya IPFS).
 */
export async function uploadMetadata(
  input: LaunchInput,
  image: ImageAsset,
  providerOverride?: 'pump' | 'pinata' | 'self',
): Promise<UploadResult> {
  switch (providerOverride ?? config.metadataProvider) {
    case 'pinata':
      return uploadToPinata(input, image);
    case 'self':
      return hostSelf(input, image);
    case 'pump':
    default:
      return uploadToPump(input, image);
  }
}

async function uploadToPump(input: LaunchInput, image: ImageAsset): Promise<UploadResult> {
  const form = new FormData();
  form.append(
    'file',
    new Blob([image.bytes as unknown as BlobPart], { type: image.mime }),
    image.filename,
  );
  form.append('name', input.name);
  form.append('symbol', input.symbol);
  form.append('description', input.description);
  form.append('showName', 'true');
  if (input.twitter) form.append('twitter', input.twitter);
  if (input.telegram) form.append('telegram', input.telegram);
  if (input.website) form.append('website', input.website);

  const response = await fetch(config.pumpIpfsEndpoint, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `Upload metadata ke pump.fun gagal (HTTP ${response.status}). ${text.slice(0, 200)} ` +
        'Coba METADATA_PROVIDER=pinata atau self.',
    );
  }

  const json = (await response.json()) as Record<string, unknown>;
  const uri =
    (json.metadataUri as string) ||
    (json.metadataURI as string) ||
    (json.uri as string) ||
    (json.metadataUriV2 as string) ||
    '';
  if (!uri) throw new Error('Respons upload pump.fun tidak memuat metadataUri.');

  return {
    uri,
    provider: 'pump',
    imageUrl: (json.image as string) || uri,
    metadata: {
      name: input.name,
      symbol: input.symbol,
      description: input.description,
      image: (json.image as string) || '',
      showName: true,
      createdOn: 'https://pumping.fun',
      twitter: input.twitter,
      telegram: input.telegram,
      website: input.website,
    },
  };
}

async function uploadToPinata(input: LaunchInput, image: ImageAsset): Promise<UploadResult> {
  if (!config.pinataJwt) throw new Error('PINATA_JWT belum diisi di .env');

  const form = new FormData();
  form.append('file', new Blob([image.bytes as unknown as BlobPart], { type: image.mime }), image.filename);
  form.append('pinataMetadata', JSON.stringify({ name: `${input.symbol}-logo` }));

  const imageResponse = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.pinataJwt}` },
    body: form,
    signal: AbortSignal.timeout(45_000),
  });
  if (!imageResponse.ok) {
    throw new Error(`Pinata (file) gagal: HTTP ${imageResponse.status} ${await imageResponse.text()}`);
  }
  const imageJson = (await imageResponse.json()) as { IpfsHash: string };
  const imageUrl = `https://gateway.pinata.cloud/ipfs/${imageJson.IpfsHash}`;

  const metadata: MetadataJson = {
    name: input.name,
    symbol: input.symbol,
    description: input.description,
    image: imageUrl,
    showName: true,
    createdOn: 'https://pumping.fun',
    twitter: input.twitter,
    telegram: input.telegram,
    website: input.website,
  };

  const jsonResponse = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.pinataJwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      pinataContent: metadata,
      pinataMetadata: { name: `${input.symbol}-metadata.json` },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!jsonResponse.ok) {
    throw new Error(`Pinata (json) gagal: HTTP ${jsonResponse.status} ${await jsonResponse.text()}`);
  }
  const jsonJson = (await jsonResponse.json()) as { IpfsHash: string };
  const uri = `https://gateway.pinata.cloud/ipfs/${jsonJson.IpfsHash}`;
  return { uri, provider: 'pinata', imageUrl, metadata };
}

/**
 * Host sendiri: gambar + JSON disimpan di `data/` dan disajikan server ini.
 * Praktis untuk devnet / testing karena tidak butuh API key.
 * `PUBLIC_BASE_URL` harus bisa diakses publik (atau localhost kalau hanya untuk tes).
 */
async function hostSelf(input: LaunchInput, image: ImageAsset): Promise<UploadResult> {
  const id = randomUUID();
  const uploadsDir = join(process.cwd(), 'data', 'uploads');
  const metadataDir = join(process.cwd(), 'data', 'metadata');
  mkdirSync(uploadsDir, { recursive: true });
  mkdirSync(metadataDir, { recursive: true });

  const ext = image.mime.split('/')[1]?.replace('svg+xml', 'svg') ?? 'png';
  const imageName = `${id}.${ext}`;
  writeFileSync(join(uploadsDir, imageName), image.bytes);

  const metadata: MetadataJson = {
    name: input.name,
    symbol: input.symbol,
    description: input.description,
    image: `${config.publicBaseUrl}/uploads/${imageName}`,
    showName: true,
    createdOn: 'https://pumping.fun',
    twitter: input.twitter,
    telegram: input.telegram,
    website: input.website,
  };
  writeFileSync(join(metadataDir, `${id}.json`), JSON.stringify(metadata, null, 2));

  return {
    uri: `${config.publicBaseUrl}/metadata/${id}.json`,
    provider: 'self',
    imageUrl: metadata.image,
    metadata,
  };
}
