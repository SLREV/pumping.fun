import express from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { config, safeConfig } from './config.ts';
import { getStatus, launchCoin, quoteLaunch, invalidateStatus } from './launch.ts';
import { ValidationError } from './metadata.ts';
import { demoCoins, store } from './store.ts';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '8mb' }));

// ── CORS sederhana (dashboard & integrator boleh memanggil API) ──────────────
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── Log ringkas ──────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  const started = Date.now();
  res.on('finish', () => {
    if (req.path.startsWith('/api')) {
      console.log(
        `${req.method} ${req.path} → ${res.statusCode} (${Date.now() - started}ms)`,
      );
    }
  });
  next();
});

// ── Rate limit mini untuk endpoint yang membelanjakan SOL ────────────────────
const hits = new Map<string, { count: number; resetAt: number }>();
function rateLimit(max = 5, windowMs = 60_000) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const key = req.ip ?? 'unknown';
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.resetAt < now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) {
      res.status(429).json({ ok: false, error: 'Terlalu banyak permintaan. Coba lagi sebentar.' });
      return;
    }
    next();
  };
}

// ── API ──────────────────────────────────────────────────────────────────────
app.get('/api/status', async (_req, res) => {
  const status = await getStatus();
  res.json({ ok: true, ...safeConfig, ...status });
});

app.get('/api/coins', (req, res) => {
  const limit = Math.min(96, Math.max(1, Number(req.query.limit ?? 48)));
  const userCoins = store.list();
  const coins = [...userCoins, ...demoCoins()].slice(0, limit);
  res.json({ ok: true, total: coins.length, coins });
});

app.post('/api/quote', (req, res) => {
  const devBuySol = Number(req.body?.devBuySol ?? 0);
  if (!Number.isFinite(devBuySol) || devBuySol < 0 || devBuySol > config.maxDevBuySol) {
    res.status(400).json({ ok: false, error: `devBuySol harus 0–${config.maxDevBuySol}.` });
    return;
  }
  res.json({ ok: true, ...quoteLaunch(devBuySol) });
});

app.post('/api/launch', rateLimit(6, 60_000), async (req, res) => {
  try {
    const result = await launchCoin(req.body ?? {}, {
      forceSimulation: req.body?.simulate === true,
    });
    res.json(result);
  } catch (error) {
    const isValidation = error instanceof ValidationError;
    console.error('[launch]', (error as Error).message);
    res.status(isValidation ? 400 : 502).json({
      ok: false,
      error: (error as Error).message,
      hint: isValidation
        ? 'Periksa kembali isi form.'
        : 'Cek saldo wallet launcher, RPC_URL, dan METADATA_PROVIDER.',
    });
  }
});

app.get('/api/launch/:mint', (req, res) => {
  const record = store.byMint(req.params.mint);
  if (!record) {
    res.status(404).json({ ok: false, error: 'Launch tidak ditemukan di riwayat server ini.' });
    return;
  }
  res.json({ ok: true, record });
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime(), version: config.version });
});

// ── File statis: gambar & metadata (provider "self") ─────────────────────────
app.use('/uploads', express.static(join(process.cwd(), 'data', 'uploads'), { maxAge: '1h' }));
app.use('/metadata', express.static(join(process.cwd(), 'data', 'metadata'), { maxAge: '1h' }));

// ── Dashboard ────────────────────────────────────────────────────────────────
const webDir = join(process.cwd(), 'web');
app.use(express.static(webDir, { extensions: ['html'] }));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    res.status(404).json({ ok: false, error: 'Endpoint tidak ada.' });
    return;
  }
  const indexFile = join(webDir, 'index.html');
  if (!existsSync(indexFile)) {
    res.status(500).send('web/index.html tidak ditemukan.');
    return;
  }
  res.sendFile(indexFile);
});

app.listen(config.port, '0.0.0.0', () => {
  invalidateStatus();
  console.log('');
  console.log('  ██ pumping.fun');
  console.log(`  ├─ dashboard : http://localhost:${config.port}`);
  console.log(`  ├─ network   : ${config.network}`);
  console.log(`  ├─ rpc       : ${safeConfig.rpcHost}`);
  console.log(`  └─ metadata  : ${config.metadataProvider}`);
  console.log('');
  void getStatus(true).then((status) => {
    if (status.simulation) {
      console.log(`  ⚠  Mode SIMULASI — ${status.reason ?? 'wallet launcher belum siap.'}`);
      console.log('     Jalankan `npm run wallet:new`, isi saldo, lalu restart.\n');
    } else {
      console.log(
        `  ✓ Wallet launcher ${status.launcherAddress} — ${status.launcherBalanceSol?.toFixed(4)} SOL\n`,
      );
    }
  });
});

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
