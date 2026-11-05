# pumping.fun

Launcher token memecoin **pump.fun** + **dashboard HTML ala pump.fun**.
Ditulis dengan TypeScript ringan (Node 22, tanpa framework) dan dashboard
vanilla HTML/CSS/JS tanpa build step.

```
┌──────────────────────────────────────────────────────────────┐
│  Dashboard (web/)         →  form, preview, papan coin        │
│  API (src/server.ts)      →  /api/launch, /api/quote, …       │
│  Core (src/launch.ts)     →  create_v2 + dev buy via SDK      │
│  SDK (@pump-fun/pump-sdk) →  instruksi on-chain pump.fun      │
└──────────────────────────────────────────────────────────────┘
```

---

## 1. Penting dulu: "smart contract"-nya di mana?

pump.fun **tidak** memakai kontrak per-token. Semua coin dibuat oleh satu
program on-chain resmi:

```
6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P      (program pump.fun)
   ↳ create_v2   : buat mint + bonding curve dalam 1 instruksi
   ↳ buy / sell  : trading di curve
   ↳ migrate     : pindah ke Raydium setelah ~85 SOL
```

Jadi kode yang kamu butuhkan adalah **klien yang membangun instruksi
`create_v2`**, bukan kontrak baru. Repo ini menyediakan tiga lapisan:

| Lapisan | File | Status |
|---|---|---|
| Klien produksi (TypeScript) | `src/launch.ts` | ✅ diuji (`npm run selftest`) |
| REST API + dashboard | `src/server.ts`, `web/` | ✅ jalan |
| Wrapper Anchor (CPI) | `contracts/pump-launcher/` | 📄 referensi, jalankan `anchor build` |

Kalau butuh logika on-chain sendiri (fee tim, registry, allowlist) sambil tetap
membuat coin — pakai wrapper Anchor di `contracts/`, ia memanggil `create_v2`
lewat CPI dalam transaksi atomik. Serializer-nya sudah diverifikasi identik
dengan SDK lewat `node scripts/cpi-accounts.mjs`.

---

## 2. Fitur

**Launcher**

- Buat coin penuh: nama, ticker, deskripsi, gambar, sosial media.
- **Dev buy** di transaksi yang sama (`create_v2_and_buy`).
- Creator fee (`creator_fee_bps`), mayhem mode, holder reward, slippage.
- Upload metadata ke IPFS pump.fun, Pinata, atau host sendiri.
- Mode **SIMULASI** otomatis kalau wallet/RPC belum siap — UI tetap bisa dicoba
  tanpa mengirim transaksi.
- CLI satu perintah (`npm run launch`), API REST, dan riwayat launch tersimpan.

**Dashboard** (`web/`)

- Tema gelap-hijau ala pump.fun, responsif, tanpa dependency eksternal.
- Papan coin: tab Trending / Baru / Hampir lulus / Graduated, pencarian,
  sparkline, progress bar menuju Raydium.
- Form dengan **preview kartu langsung** + estimasi token/market cap real-time.
- Tab kode otomatis (cURL / JS / CLI) mengikuti isi form.
- Modal detail coin (chart + progres curve), modal sukses, toast, confetti.

---

## 3. Quickstart

Butuh **Node.js ≥ 22.9** (memakai `--env-file-if-exists` & type stripping bawaan).

```bash
git clone https://github.com/SLREV/pumping.fun
cd pumping.fun
npm install

# 1. konfigurasi
cp .env.example .env

# 2. buat wallet launcher (hot wallet) — tersimpan di data/launcher.json
npm run wallet:new

# 3. isi saldo alamat tersebut (mainnet) atau airdrop (devnet)
#    devnet: solana airdrop 2 <ADDRESS> --url devnet

# 4. jalankan
npm start
# → http://localhost:3000
```

Belum punya SOL? Biarkan saja — server otomatis masuk **mode SIMULASI**:
semua fitur dashboard dan API berjalan, hanya transaksi on-chain yang tidak
dikirim.

### Deploy produksi singkat

```bash
# RPC sendiri (disarankan) + wallet dari env, bukan file
RPC_URL=https://mainnet.helius-rpc.com/?api-key=xxx \
LAUNCHER_SECRET_KEY=<base58-secret> \
METADATA_PROVIDER=pump \
PUBLIC_BASE_URL=https://launch.domainmu.xyz \
node src/server.ts
```

Taruh di belakang reverse proxy (Caddy/Nginx) + HTTPS. Jangan pernah commit
`.env` atau `data/launcher.json` (sudah masuk `.gitignore`).

---

## 4. Konfigurasi (`.env`)

| Variabel | Default | Keterangan |
|---|---|---|
| `NETWORK` | `mainnet-beta` | `mainnet-beta` atau `devnet` |
| `RPC_URL` | RPC publik | Pakai provider sendiri untuk produksi |
| `PORT` | `3000` | Port dashboard/API |
| `PUBLIC_BASE_URL` | `http://localhost:3000` | Dipakai saat metadata di-host sendiri |
| `LAUNCHER_SECRET_KEY` | — | Base58 / JSON array. Prioritas tertinggi |
| `LAUNCHER_KEYPAIR_PATH` | `./data/launcher.json` | Alternatif file keypair |
| `METADATA_PROVIDER` | `pump` | `pump` \| `pinata` \| `self` |
| `PINATA_JWT` | — | Wajib kalau `METADATA_PROVIDER=pinata` |
| `PUMP_IPFS_ENDPOINT` | `https://frontend-api.pump.fun/ipfs` | Endpoint upload pump.fun |
| `PRIORITY_FEE_MICRO_LAMPORTS` | `150000` | Priority fee (µLamports/CU) |
| `COMPUTE_UNIT_LIMIT` | `250000` | Budget compute |
| `SOL_PRICE_USD` | `150` | Hanya untuk estimasi USD di UI |
| `MAX_DEV_BUY_SOL` | `5` | Pengaman agar hot wallet tidak terkuras |

**Pilihan provider metadata**

- `pump` — paling kompatibel; metadata langsung muncul rapi di UI pump.fun.
- `pinata` — kalau endpoint pump.fun diblokir/rate-limited; butuh JWT.
- `self` — file disimpan di `data/uploads` + `data/metadata` dan disajikan
  server ini. Cocok untuk devnet/testing (`PUBLIC_BASE_URL` harus bisa diakses
  publik oleh klien pump.fun).

---

## 5. Pemakaian

### CLI

```bash
npm run launch -- \
  --name "Pumping Cat" \
  --symbol PUMPCAT \
  --description "Kucing yang menekan tombol pump" \
  --image ./logo.png \
  --dev-buy 0.5 \
  --twitter x.com/pumpingfun \
  --website pumping.fun

# coba tanpa kirim transaksi
npm run launch -- --name "Tes" --symbol TES --simulate
```

Flag lain: `--creator-fee 100`, `--mayhem`, `--holder-reward`.

### API

```bash
# status jaringan & wallet
curl localhost:3000/api/status

# estimasi dev buy
curl -X POST localhost:3000/api/quote \
  -H 'Content-Type: application/json' \
  -d '{"devBuySol":0.5}'

# buat coin
curl -X POST localhost:3000/api/launch \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Pumping Cat",
    "symbol": "PUMPCAT",
    "description": "Kucing yang menekan tombol pump",
    "image": "https://contoh.com/logo.png",
    "devBuySol": 0.5,
    "twitter": "x.com/pumpingfun"
  }'
```

Respons `POST /api/launch`:

```json
{
  "ok": true,
  "simulated": false,
  "mint": "7xKQ…8Qe",
  "signature": "5vB9…",
  "uri": "https://ipfs.io/ipfs/bafy…",
  "tokensReceived": 17417117.5,
  "pumpUrl": "https://pump.fun/coin/7xKQ…8Qe",
  "explorerUrl": "https://solscan.io/account/7xKQ…8Qe"
}
```

`image` menerima URL https **atau** data URL base64 (dipakai form dashboard).
Rate limit: 6 launch/menit/IP.

---

## 6. Alur teknis

1. **Validasi** — nama ≤ 32, ticker ≤ 10, deskripsi ≤ 500, dev buy ≤
   `MAX_DEV_BUY_SOL` (`src/metadata.ts`).
2. **Metadata** — gambar disiapkan (upload atau avatar SVG generatif), lalu
   diunggah; hasilnya `uri` JSON.
3. **Instruksi** (`src/launch.ts`):
   ```ts
   const global = await online.fetchGlobal();
   const amount = getBuyTokenAmountFromSolAmount({ global, feeConfig, bondingCurve: null, … });
   const ixs = await PUMP_SDK.createV2AndBuyInstructions({ global, mint, name, symbol, uri, creator, user, amount, solAmount });
   ```
4. **Transaksi** — `ComputeBudget` (limit + priority fee), blokhash terbaru,
   ditandatangani mint keypair + wallet launcher, dikirim, lalu dikonfirmasi.
5. **Riwayat** — disimpan di `data/launches.json`, tampil di papan dashboard.

Catatan biaya: ±0.002–0.004 SOL (signature + rent account + ATA), ditambah dev
buy dan priority fee. pump.fun mengambil fee dari **trading**, bukan pembuatan.

---

## 7. Struktur repo

```
pumping.fun/
├─ src/
│  ├─ sdk.ts          # jembatan ke @pump-fun/pump-sdk (CJS interop)
│  ├─ config.ts       # env → config
│  ├─ curve.ts        # matematika bonding curve (simulasi + estimasi)
│  ├─ metadata.ts     # validasi, gambar, upload IPFS/Pinata/self
│  ├─ wallet.ts       # keypair base58/JSON + generator
│  ├─ launch.ts       # inti: bangun + kirim create_v2 (+ dev buy)
│  ├─ store.ts        # riwayat launch + data demo papan
│  ├─ server.ts       # Express: API + file statis dashboard
│  └─ cli/            # launch.ts, wallet.ts, selftest.ts
├─ web/               # dashboard (vanilla, tanpa build)
├─ contracts/         # wrapper Anchor CPI (opsional)
├─ scripts/           # smoke test DOM + generator akun CPI
└─ data/              # runtime: keypair, uploads, metadata, riwayat (gitignored)
```

---

## 8. Testing

```bash
npm run typecheck    # tsc --noEmit
npm run selftest     # SDK + curve + validasi + metadata, tanpa RPC
node scripts/smoke-dom.mjs      # dashboard di jsdom (render, form, submit, modal)
node scripts/cpi-accounts.mjs   # akun create_v2 + verifikasi serializer CPI
```

`selftest` membuktikan: program id benar, `create_v2` membawa 16 akun,
transaksi bisa diserialisasi, matematika curve masuk akal, validasi input
bekerja, dan upload metadata lokal menulis file yang benar.

---

## 9. Keamanan

- **Hot wallet** yang menandatangani ada di server. Isi seperlunya
  (mis. 0.5–2 SOL), bukan treasury.
- `MAX_DEV_BUY_SOL` membatasi kerugian kalau ada input aneh.
- Rate limit 6 launch/menit/IP sudah aktif; tambahkan reverse-proxy limit di
  produksi.
- Jalankan sebagai user non-root, `chmod 600` pada file keypair.
- Untuk serius: ganti `loadLauncherKeypair()` dengan KMS/HSM atau
  `@solana/kit` signer kustom.
- **DYOR / risiko:** memecoin sangat volatil, banyak penipuan. Dashboard ini
  alat teknis, bukan saran investasi, dan tidak berafiliasi resmi dengan pump.fun.

---

## 10. Troubleshooting

| Gejala | Penyebab & solusi |
|---|---|
| `Named export 'BN' not found` | Import ESM SDK bermasalah. Repo ini memakai `createRequire` di `src/sdk.ts` — jangan ubah ke `import` biasa |
| `Mode SIMULASI` terus | `LAUNCHER_KEYPAIR_PATH` salah atau saldo 0. Cek `GET /api/status` |
| Upload metadata gagal (HTTP 4xx/5xx) | Endpoint pump.fun menolak. Coba `METADATA_PROVIDER=pinata` atau `self` |
| `Blockhash not found` / timeout | RPC lambat. Pakai provider sendiri, naikkan `PRIORITY_FEE_MICRO_LAMPORTS` |
| `429` | Rate limit launch (6/menit/IP) |
| Coin jadi tapi metadata kosong | `uri` tidak bisa diakses publik — cek `PUBLIC_BASE_URL` (khusus provider `self`) |
| `anchor build` belum dicoba | Wrapper di `contracts/` belum dikompilasi di repo ini; jalankan sendiri |

---

## 11. Lisensi

MIT. Gunakan dengan risiko sendiri.
