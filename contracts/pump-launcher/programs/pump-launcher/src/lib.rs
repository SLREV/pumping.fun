//! # pump-launcher — wrapper CPI ke program pump.fun
//!
//! ⚠️  CATATAN PENTING
//! pump.fun **tidak** memakai kontrak buatan kita untuk membuat token. Token
//! dibuat oleh program resmi pump.fun (`create_v2`). Program ini adalah lapisan
//! opsional di atasnya: ia memanggil (CPI) instruksi `create_v2` sehingga kamu
//! bisa menggabungkan pembuatan coin dengan logika lain dalam SATU transaksi
//! atomik — misalnya memungut fee tim, mencatat registry, atau memberi hadiah.
//!
//! Bagian produksi (yang sudah diuji di repo ini) ada di `src/launch.ts`
//! (TypeScript + `@pump-fun/pump-sdk`). Program Anchor ini adalah referensi;
//! kompilasi dengan `anchor build` sebelum dipakai.
//!
//! Alur:
//!   1. Client membangun 16 akun `create_v2` (lihat `node scripts/cpi-accounts.mjs`).
//!   2. Client memanggil `create_coin` dengan 16 akun itu sebagai `remaining_accounts`.
//!   3. Program memvalidasi lalu CPI ke pump.fun — mint di bawah ini dibuat.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke;

declare_id!("CcJghvKjRtUUayDHiefHpobwFDDjbfdtjXjBVF5Afosi");

/// Program bonding curve resmi pump.fun (mainnet & devnet).
pub const PUMP_PROGRAM_ID: Pubkey =
    anchor_lang::solana_program::pubkey!("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

/// 8 byte pertama sha256("global:create_v2") — Anchor instruction discriminator.
pub const CREATE_V2_DISCRIMINATOR: [u8; 8] = [214, 144, 76, 236, 95, 139, 49, 180];

/// Jumlah akun yang diharapkan `create_v2`.
pub const CREATE_V2_ACCOUNTS: usize = 16;

/// Indeks akun penting di dalam daftar 16 akun tersebut.
pub const IDX_MINT: usize = 0;
pub const IDX_USER: usize = 5;
pub const IDX_PROGRAM: usize = 15;

pub const MAX_NAME: usize = 32;
pub const MAX_SYMBOL: usize = 10;
pub const MAX_URI: usize = 200;

#[program]
pub mod pump_launcher {
    use super::*;

    /// Buat coin pump.fun lewat CPI.
    ///
    /// * `name` / `symbol` / `uri` — metadata (uri = URL JSON hasil upload IPFS).
    /// * `mayhem_mode` — mode curve acak milik pump.fun.
    /// * `creator_fee_bps` — 0..=1000 (0–10%).
    pub fn create_coin(
        ctx: Context<CreateCoin>,
        name: String,
        symbol: String,
        uri: String,
        mayhem_mode: bool,
        creator_fee_bps: u64,
    ) -> Result<()> {
        require!(!name.is_empty() && name.len() <= MAX_NAME, LaunchError::InvalidName);
        require!(
            !symbol.is_empty() && symbol.len() <= MAX_SYMBOL,
            LaunchError::InvalidSymbol
        );
        require!(!uri.is_empty() && uri.len() <= MAX_URI, LaunchError::InvalidUri);
        require!(creator_fee_bps <= 1_000, LaunchError::CreatorFeeTooHigh);

        let remaining = ctx.remaining_accounts;
        require!(
            remaining.len() == CREATE_V2_ACCOUNTS,
            LaunchError::WrongAccountCount
        );

        // Akun pertama harus mint yang baru dibuat, kelima harus user/creator.
        require_keys_eq!(
            remaining[IDX_MINT].key(),
            ctx.accounts.mint.key(),
            LaunchError::MintMismatch
        );
        require_keys_eq!(
            remaining[IDX_USER].key(),
            ctx.accounts.creator.key(),
            LaunchError::CreatorMismatch
        );
        require_keys_eq!(
            remaining[IDX_PROGRAM].key(),
            ctx.accounts.pump_program.key(),
            LaunchError::PumpProgramMismatch
        );
        require_keys_eq!(
            ctx.accounts.pump_program.key(),
            PUMP_PROGRAM_ID,
            LaunchError::WrongPumpProgram
        );

        // Mint harus menandatangani transaksi (pump.fun membuat mint account).
        require!(ctx.accounts.mint.is_signer, LaunchError::MintNotSigner);

        let data = build_create_v2_data(
            &name,
            &symbol,
            &uri,
            &ctx.accounts.creator.key(),
            mayhem_mode,
            creator_fee_bps,
        );

        let accounts: Vec<AccountMeta> = remaining
            .iter()
            .map(|account| AccountMeta {
                pubkey: *account.key,
                is_signer: account.is_signer,
                is_writable: account.is_writable,
            })
            .collect();

        let instruction = Instruction {
            program_id: PUMP_PROGRAM_ID,
            accounts,
            data,
        };

        invoke(&instruction, remaining)?;

        emit!(CoinCreated {
            mint: ctx.accounts.mint.key(),
            creator: ctx.accounts.creator.key(),
            name,
            symbol,
            uri,
        });

        Ok(())
    }
}

/// Serialisasi argumen `create_v2` persis seperti yang dikirim SDK resmi:
///
/// ```text
/// discriminator(8) | name(u32+bytes) | symbol(u32+bytes) | uri(u32+bytes)
/// | creator(32) | is_mayhem_mode(bool) | is_cashback_enabled(bool)
/// | creator_fee_bps(u64) | is_holder_reward(bool)
/// ```
fn build_create_v2_data(
    name: &str,
    symbol: &str,
    uri: &str,
    creator: &Pubkey,
    mayhem_mode: bool,
    creator_fee_bps: u64,
) -> Vec<u8> {
    let mut data = Vec::with_capacity(8 + 4 * 3 + name.len() + symbol.len() + uri.len() + 32 + 11);
    data.extend_from_slice(&CREATE_V2_DISCRIMINATOR);

    for value in [name, symbol, uri] {
        data.extend_from_slice(&(value.len() as u32).to_le_bytes());
        data.extend_from_slice(value.as_bytes());
    }

    data.extend_from_slice(creator.as_ref());
    data.push(u8::from(mayhem_mode)); // is_mayhem_mode
    data.push(0); // is_cashback_enabled = false (cashback sudah deprecated)
    data.extend_from_slice(&creator_fee_bps.to_le_bytes()); // creator_fee_bps
    data.push(0); // is_holder_reward = false

    data
}

#[derive(Accounts)]
pub struct CreateCoin<'info> {
    /// Pembayar + pembuat coin (harus sama dengan akun ke-5 `create_v2`).
    #[account(mut)]
    pub creator: Signer<'info>,

    /// Mint baru. Harus signer karena pump.fun yang menginisialisasi account-nya.
    #[account(mut)]
    pub mint: Signer<'info>,

    /// Program pump.fun. Dicek harus `6EF8…F6P`.
    pub pump_program: AccountInfo<'info>,
}

#[event]
pub struct CoinCreated {
    pub mint: Pubkey,
    pub creator: Pubkey,
    pub name: String,
    pub symbol: String,
    pub uri: String,
}

#[error_code]
pub enum LaunchError {
    #[msg("Nama coin harus 1–32 karakter.")]
    InvalidName,
    #[msg("Ticker harus 1–10 karakter.")]
    InvalidSymbol,
    #[msg("URI metadata tidak valid (maks 200 karakter).")]
    InvalidUri,
    #[msg("Creator fee maksimal 1000 bps.")]
    CreatorFeeTooHigh,
    #[msg("Jumlah remaining account harus tepat 16 (akun create_v2).")]
    WrongAccountCount,
    #[msg("Akun mint tidak cocok dengan argumen.")]
    MintMismatch,
    #[msg("Akun creator tidak cocok dengan akun user pump.fun.")]
    CreatorMismatch,
    #[msg("Akun program pump.fun tidak cocok.")]
    PumpProgramMismatch,
    #[msg("Program yang dipanggil bukan program pump.fun.")]
    WrongPumpProgram,
    #[msg("Mint harus menandatangani transaksi.")]
    MintNotSigner,
}
