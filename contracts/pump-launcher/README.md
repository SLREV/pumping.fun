# pump-launcher (Anchor, opsional)

Program Solana kecil yang **memanggil (CPI) `create_v2` milik pump.fun**.

## Kenapa bukan kontrak besar?

Di pump.fun, token dibuat oleh program resmi
`6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`. Tidak ada deployment kontrak
per-token. Jadi "smart contract untuk membuat token" yang benar adalah:
**klien yang membangun instruksi `create_v2`** (ada di `src/launch.ts`, sudah
diuji) — atau, kalau kamu butuh logika on-chain tambahan, wrapper seperti ini.

## Kegunaan wrapper ini

- Menyatukan pembuatan coin + aksi lain dalam **satu transaksi atomik**
  (mis. registry on-chain, fee tim, allowlist, atau hadiah).
- Menambahkan validasi sendiri (panjang nama, batas creator fee, dsb.).
- Menjadi titik masuk tunggal untuk program lain (composability).

## Akun

`create_coin` menerima 16 akun `create_v2` lewat `remaining_accounts`.
Urutannya persis seperti yang dibangun SDK:

| # | akun | signer | writable |
|---|------|--------|----------|
| 0 | mint | ✅ | ✅ |
| 1 | mint_authority (PDA) | | |
| 2 | bonding_curve (PDA) | | ✅ |
| 3 | associated_bonding_curve (ATA) | | ✅ |
| 4 | global (PDA) | | |
| 5 | user (= creator) | ✅ | ✅ |
| 6 | system_program | | |
| 7 | token_program (Token-2022) | | |
| 8 | associated_token_program | | |
| 9 | mayhem_program_id | | ✅ |
| 10 | global_params | | |
| 11 | sol_vault | | ✅ |
| 12 | mayhem_state | | ✅ |
| 13 | mayhem_token_vault | | ✅ |
| 14 | event_authority | | |
| 15 | pump program | | |

Cek dengan:

```bash
node scripts/cpi-accounts.mjs            # daftar akun untuk mint acak
```

## Build & deploy

```bash
cd contracts/pump-launcher
anchor build
anchor deploy --provider.cluster devnet
```

> Kode ini adalah **referensi** dan belum dikompilasi di environment repo ini
> (tidak ada toolchain Rust/Anchor saat dibuat). Jalankan `anchor build` dan
> `anchor test` sebelum dipakai on-chain. Untuk produksi, jalur yang sudah
> diuji adalah klien TypeScript di `src/launch.ts`.
