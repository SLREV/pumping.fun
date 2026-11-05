/* ═══════════════════════════════════════════════════════════════
   pumping.fun — dashboard logic
   Vanilla JS, tanpa build step. Semua data dari /api/*.
   ═══════════════════════════════════════════════════════════════ */

(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const state = {
    status: null,
    coins: [],
    tab: 'trending',
    query: '',
    imageData: null,
    codeTab: 'curl',
    submitting: false,
    solPrice: 150,
  };

  /* ──────────────────────────── Utils ──────────────────────────── */

  const nf = (opts) => new Intl.NumberFormat('id-ID', opts);
  const compact = nf({ notation: 'compact', maximumFractionDigits: 2 });
  const plain = nf({ maximumFractionDigits: 0 });

  function fmtUsd(value, digits = 0) {
    if (!Number.isFinite(value)) return '$0';
    if (Math.abs(value) >= 1_000_000) return `$${compact.format(value)}`;
    return `$${nf({ minimumFractionDigits: digits, maximumFractionDigits: Math.abs(value) < 1 ? 6 : digits }).format(value)}`;
  }

  function fmtSol(value) {
    if (!Number.isFinite(value)) return '0 SOL';
    if (value >= 1000) return `${compact.format(value)} SOL`;
    return `${nf({ maximumFractionDigits: value < 1 ? 4 : 2 }).format(value)} SOL`;
  }

  function fmtTokens(value) {
    if (!Number.isFinite(value)) return '—';
    return compact.format(value);
  }

  function timeAgo(iso) {
    const diff = Math.max(0, Date.now() - new Date(iso).getTime());
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'baru saja';
    if (mins < 60) return `${mins}m lalu`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}j lalu`;
    return `${Math.floor(hours / 24)}h lalu`;
  }

  const short = (addr, size = 4) =>
    !addr ? '—' : addr.length <= size * 2 + 1 ? addr : `${addr.slice(0, size)}…${addr.slice(-size)}`;

  const escapeHtml = (value) =>
    String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[char]));

  function hashString(str) {
    let hash = 2166136261;
    for (let i = 0; i < str.length; i += 1) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  const PALETTES = [
    ['#00ffa3', '#00c2ff'],
    ['#ff2d95', '#7a5cff'],
    ['#ffb800', '#ff3d00'],
    ['#3ef0a0', '#00c853'],
    ['#8a2be2', '#00d4ff'],
    ['#ff6f61', '#ffd166'],
    ['#00e07a', '#0b6b4f'],
    ['#5ee7ff', '#2b6cff'],
  ];

  function paletteFor(seed) {
    return PALETTES[hashString(seed || 'pump') % PALETTES.length];
  }

  /** URL gambar dari server lokal (localhost:port) dijadikan relatif agar tetap tampil di preview. */
  function displayImage(url) {
    if (!url) return '';
    return String(url).replace(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i, '');
  }

  function avatarMarkup(coin, size = '') {
    const seed = coin.symbol || coin.name || 'P';
    const [from, to] = paletteFor(seed);
    if (coin.imageUrl) {
      return `<div class="avatar ${size}"><img src="${escapeHtml(displayImage(coin.imageUrl))}" alt="" loading="lazy" onerror="this.style.display='none';this.parentNode.textContent='${escapeHtml(seed.slice(0, 1))}'" /></div>`;
    }
    return `<div class="avatar ${size}" style="background:linear-gradient(135deg,${from},${to})">${escapeHtml(seed.slice(0, 1))}</div>`;
  }

  /** Sparkline deterministik dari seed. */
  function sparkline(seed, width = 220, height = 42, points = 24) {
    const rand = mulberry32(hashString(seed));
    let value = 0.5;
    const values = [];
    for (let i = 0; i < points; i += 1) {
      value += (rand() - 0.42) * 0.16;
      value = Math.min(1, Math.max(0.06, value));
      values.push(value);
    }
    const step = width / (points - 1);
    const coords = values.map((v, i) => [i * step, height - 4 - v * (height - 10)]);
    const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const area = `${line} L${width},${height} L0,${height} Z`;
    const rising = values[points - 1] >= values[0];
    const color = rising ? '#00e07a' : '#ff5f7a';
    const id = `g${hashString(seed) % 99999}`;
    return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stop-color="${color}" stop-opacity=".35"/>
        <stop offset="1" stop-color="${color}" stop-opacity="0"/>
      </linearGradient></defs>
      <path d="${area}" fill="url(#${id})"/>
      <path d="${line}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>
    </svg>`;
  }

  function mulberry32(seed) {
    let a = seed;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      throw new Error(data.error || `Permintaan gagal (HTTP ${response.status})`);
    }
    return data;
  }

  /* ──────────────────────────── Toast ──────────────────────────── */

  function toast(title, message = '', kind = 'info') {
    const stack = $('#toasts');
    const el = document.createElement('div');
    el.className = `toast ${kind === 'error' ? 'is-error' : kind === 'ok' ? 'is-ok' : ''}`;
    el.innerHTML = `<div><strong>${escapeHtml(title)}</strong>${message ? `<span>${escapeHtml(message)}</span>` : ''}</div>`;
    stack.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .25s, transform .25s';
      el.style.opacity = '0';
      el.style.transform = 'translateX(20px)';
      setTimeout(() => el.remove(), 260);
    }, kind === 'error' ? 6500 : 4200);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast('Disalin', 'Sudah masuk clipboard.', 'ok');
    } catch {
      toast('Gagal menyalin', 'Browser menolak akses clipboard.', 'error');
    }
  }

  /* ──────────────────────── Status & wallet ────────────────────── */

  async function loadStatus() {
    try {
      const status = await api('/api/status');
      state.status = status;
      state.solPrice = status.solPriceUsd || 150;

      const badge = $('#chainBadge');
      badge.classList.toggle('is-live', !status.simulation);
      badge.classList.toggle('is-sim', status.simulation);
      $('#chainLabel').textContent = status.simulation ? 'Mode simulasi' : 'On-chain aktif';
      badge.title = status.simulation
        ? status.reason || 'Wallet launcher belum siap — transaksi tidak dikirim.'
        : `RPC ${status.rpcHost} · ${status.network}`;

      $('#walletLabel').textContent = status.launcherAddress
        ? short(status.launcherAddress, 4)
        : 'Belum ada wallet';
      $('#walletChip').title = status.launcherAddress
        ? `Launcher ${status.launcherAddress} · ${status.launcherBalanceSol ?? 0} SOL`
        : status.reason || 'Wallet launcher belum diset';

      const pill = $('#modePill');
      pill.textContent = status.simulation
        ? 'MODE SIMULASI · transaksi tidak dikirim'
        : `ON-CHAIN · ${status.network} · ${(status.launcherBalanceSol ?? 0).toFixed(3)} SOL`;
      pill.classList.toggle('is-live', !status.simulation);
      pill.classList.toggle('is-sim', status.simulation);

      $('#ticketNet').textContent = status.network;
      $('#statWallet').textContent = status.launcherBalanceSol != null
        ? `${status.launcherBalanceSol.toFixed(2)} SOL`
        : '—';

      const devBuyInput = $('#devBuy');
      if (devBuyInput && status.maxDevBuySol) {
        devBuyInput.max = String(status.maxDevBuySol);
      }
    } catch (error) {
      console.warn('status gagal dimuat:', error);
      $('#chainLabel').textContent = 'offline';
      $('#modePill').textContent = 'API tidak terjangkau';
      $('#statWallet').textContent = '—';
    }
  }

  /* ───────────────────────────── Board ─────────────────────────── */

  const FALLBACK_COINS = [
    { id: 'f1', mint: '7xKQ3sYd2WmPqBzVn4cJt8Hr5Lk1Np9Fd6Gh2Ws4Yb8Qe', name: 'Pumping Cat', symbol: 'PUMPCAT', description: 'Kucing yang menekan tombol pump.', marketCapSol: 412, progress: 0.87, createdAt: new Date(Date.now() - 24 * 6e4).toISOString(), creator: '9aBcDeFgHiJkLmNoPqRsTuVwXyZ1234567890abcd', source: 'demo', devBuySol: 0.5, imageUrl: null, links: {} },
    { id: 'f2', mint: '3rTz9KpQwErTyUiOpAsDfGhJkLzXcVbNm12345678aBcD', name: 'Solana Rats', symbol: 'RATS', description: 'Tikus jalanan yang paham chart.', marketCapSol: 96, progress: 0.34, createdAt: new Date(Date.now() - 7 * 6e4).toISOString(), creator: '7yTrEwQaZsXdCfVgBhNjMkLpOiUyTrEwQaZsXdCf', source: 'demo', devBuySol: 0.5, imageUrl: null, links: {} },
    { id: 'f3', mint: '5kLmNoPqRsTuVwXyZaBcDeFgHiJkLmNoPqRsTuVwXyZ1', name: 'Moon Sate', symbol: 'SATE', description: 'Sate madura tapi on-chain.', marketCapSol: 58, progress: 0.21, createdAt: new Date(Date.now() - 12 * 6e4).toISOString(), creator: '4bCdEfGhIjKlMnOpQrStUvWxYz1234567890abcdef', source: 'demo', devBuySol: 0.5, imageUrl: null, links: {} },
    { id: 'f4', mint: '8mNpQrStUvWxYzAbCdEfGhIjKlMnOpQrStUvWxYzAbC2', name: 'Gorengan DAO', symbol: 'GORENG', description: 'DAO yang cuma rapat sambil makan gorengan.', marketCapSol: 33, progress: 0.48, createdAt: new Date(Date.now() - 31 * 6e4).toISOString(), creator: '2cDeFgHiJkLmNoPqRsTuVwXyZaBcDeFgHiJkLmNo', source: 'demo', devBuySol: 0.5, imageUrl: null, links: {} },
    { id: 'f5', mint: '9nPqRsTuVwXyZaBcDeFgHiJkLmNoPqRsTuVwXyZaBcDe3', name: 'Mie Ayam Maxi', symbol: 'MIEAYAM', description: 'Mie ayam porsi dewa.', marketCapSol: 112, progress: 0.71, createdAt: new Date(Date.now() - 52 * 6e4).toISOString(), creator: '6dEfGhIjKlMnOpQrStUvWxYzAbCdEfGhIjKlMnOp', source: 'demo', devBuySol: 0.5, imageUrl: null, links: {} },
    { id: 'f6', mint: '2pQrStUvWxYzAbCdEfGhIjKlMnOpQrStUvWxYzAbCdE4', name: 'Tuyul Finance', symbol: 'TUYUL', description: 'Protokol yang menghilang perlahan.', marketCapSol: 2.1, progress: 0.01, createdAt: new Date(Date.now() - 4e4).toISOString(), creator: '1eFgHiJkLmNoPqRsTuVwXyZaBcDeFgHiJkLmNoPq', source: 'demo', devBuySol: 0.5, imageUrl: null, links: {} },
  ];

  async function loadCoins() {
    renderSkeletons();
    try {
      const data = await api('/api/coins?limit=48');
      state.coins = (data.coins || []).map((coin) => ({ ...coin }));
    } catch (error) {
      console.warn('coins gagal dimuat, memakai data lokal:', error);
      state.coins = FALLBACK_COINS.slice();
    }
    renderCoins();
    renderMarquee();
    updateStats();
  }

  function renderSkeletons() {
    $('#coinGrid').innerHTML = Array.from({ length: 8 })
      .map(() => '<div class="skeleton"></div>')
      .join('');
  }

  function visibleCoins() {
    const query = state.query.trim().toLowerCase();
    let list = state.coins.slice();
    if (query) {
      list = list.filter(
        (coin) =>
          coin.name.toLowerCase().includes(query) || coin.symbol.toLowerCase().includes(query),
      );
    }
    switch (state.tab) {
      case 'new':
        list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        break;
      case 'hot':
        list = list.filter((coin) => !coin.graduated && coin.progress < 1);
        list.sort((a, b) => b.progress - a.progress);
        break;
      case 'graduated':
        list = list.filter((coin) => coin.graduated || coin.progress >= 1);
        break;
      default:
        list.sort((a, b) => b.marketCapSol - a.marketCapSol);
    }
    return list;
  }

  function badgeFor(coin) {
    if (coin.graduated || coin.progress >= 1) return '<span class="badge badge-grad">GRADUATED</span>';
    if (coin.progress >= 0.7) return '<span class="badge badge-hot">HAMPIR LULUS</span>';
    if (Date.now() - new Date(coin.createdAt).getTime() < 30 * 60_000) {
      return '<span class="badge badge-new">BARU</span>';
    }
    if (coin.source === 'demo') return '<span class="badge badge-demo">DEMO</span>';
    return '<span class="badge">LIVE</span>';
  }

  function cardHtml(coin) {
    const mcapUsd = coin.marketCapSol * state.solPrice;
    const progress = Math.round(Math.min(1, coin.progress || 0) * 100);
    return `
      <article class="coin-card" data-id="${escapeHtml(coin.id)}" tabindex="0">
        <div class="coin-top">
          ${avatarMarkup(coin)}
          <div class="coin-title">
            <strong>${escapeHtml(coin.name)}</strong>
            <span class="mono muted">$${escapeHtml(coin.symbol)}</span>
          </div>
          ${badgeFor(coin)}
        </div>
        <p class="coin-desc">${escapeHtml(coin.description || 'Tanpa deskripsi.')}</p>
        <div class="mini-chart">${sparkline(coin.symbol + coin.id)}</div>
        <div class="coin-meta">
          <div><span>Mcap</span><strong data-mcap="${escapeHtml(coin.id)}">${fmtUsd(mcapUsd)}</strong></div>
          <div><span>Dev buy</span><strong>${fmtSol(coin.devBuySol ?? 0)}</strong></div>
          <div><span>Umur</span><strong>${timeAgo(coin.createdAt)}</strong></div>
        </div>
        <div class="progress"><div class="progress-bar" style="width:${progress}%"></div></div>
        <div class="coin-foot">
          <span class="mono muted">oleh ${short(coin.creator)}</span>
          <span class="mono muted">${progress}% → Raydium</span>
        </div>
      </article>`;
  }

  function renderCoins() {
    const list = visibleCoins();
    const grid = $('#coinGrid');
    $('#emptyState').hidden = list.length > 0;
    grid.innerHTML = list.map(cardHtml).join('');
    $$('.coin-card', grid).forEach((card) => {
      const coin = state.coins.find((item) => item.id === card.dataset.id);
      if (!coin) return;
      card.addEventListener('click', () => openDetail(coin));
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openDetail(coin);
        }
      });
    });
  }

  function renderMarquee() {
    const items = state.coins.slice(0, 14).map((coin) => {
      const change = ((hashString(coin.id + coin.symbol) % 2400) - 800) / 100;
      const up = change >= 0;
      return `<span class="marquee-item">
        <b>$${escapeHtml(coin.symbol)}</b>
        <span class="muted">${fmtUsd(coin.marketCapSol * state.solPrice)}</span>
        <span class="${up ? 'up' : 'down'}">${up ? '+' : ''}${change.toFixed(1)}%</span>
      </span>`;
    });
    const html = items.join('');
    $('#marquee').innerHTML = html + html;
  }

  function updateStats() {
    const graduated = state.coins.filter((coin) => coin.graduated || coin.progress >= 1);
    const onChain = state.coins.filter((coin) => coin.source === 'user' && !coin.simulated);
    $('#statLaunched').textContent = plain.format(state.coins.length);
    $('#statGraduated').textContent = plain.format(graduated.length);
    if (onChain.length) $('#statLaunched').textContent = plain.format(state.coins.length);
  }

  /** Animasi halus: market cap coin demo bergerak sedikit tiap beberapa detik. */
  function startLiveTicker() {
    setInterval(() => {
      state.coins.forEach((coin) => {
        if (coin.source !== 'demo') return;
        const drift = ((hashString(coin.id + Math.floor(Date.now() / 6000)) % 100) - 48) / 4000;
        coin.marketCapSol = Math.max(0.5, coin.marketCapSol * (1 + drift));
        const el = document.querySelector(`[data-mcap="${coin.id}"]`);
        if (el) el.textContent = fmtUsd(coin.marketCapSol * state.solPrice);
      });
    }, 6000);
  }

  /* ──────────────────────── Detail modal ───────────────────────── */

  function openDetail(coin) {
    const body = $('#detailBody');
    const mcapUsd = coin.marketCapSol * state.solPrice;
    const progress = Math.round(Math.min(1, coin.progress || 0) * 100);
    body.innerHTML = `
      <div class="detail-head">
        ${avatarMarkup(coin, 'avatar-lg')}
        <div>
          <h3 id="detailTitle">${escapeHtml(coin.name)}</h3>
          <span class="mono muted">$${escapeHtml(coin.symbol)} · oleh ${short(coin.creator, 6)}</span>
        </div>
        <div style="margin-left:auto">${badgeFor(coin)}</div>
      </div>
      <p class="muted" style="font-size:.86rem">${escapeHtml(coin.description || 'Tanpa deskripsi.')}</p>
      <div class="detail-stats">
        <div><span>Market cap</span><strong>${fmtUsd(mcapUsd)}</strong></div>
        <div><span>Mcap (SOL)</span><strong>${fmtSol(coin.marketCapSol)}</strong></div>
        <div><span>Dev buy</span><strong>${fmtSol(coin.devBuySol ?? 0)}</strong></div>
        <div><span>Dibuat</span><strong>${timeAgo(coin.createdAt)}</strong></div>
      </div>
      <canvas class="detail-canvas" id="detailChart" width="660" height="200"></canvas>
      <div class="detail-stats">
        <div><span>Progres curve</span><strong>${progress}%</strong></div>
        <div><span>Target graduasi</span><strong>85 SOL</strong></div>
        <div><span>Mint</span><strong class="mono" style="font-size:.7rem">${short(coin.mint, 6)}</strong></div>
        <div><span>Status data</span><strong>${coin.source === 'demo' ? 'contoh' : coin.simulated ? 'simulasi' : 'on-chain'}</strong></div>
      </div>
      <div class="progress" style="margin-top:4px"><div class="progress-bar" style="width:${progress}%"></div></div>
      <div class="detail-links">
        <a href="https://pump.fun/coin/${encodeURIComponent(coin.mint)}" target="_blank" rel="noreferrer">Buka di pump.fun ↗</a>
        <a href="https://solscan.io/account/${encodeURIComponent(coin.mint)}" target="_blank" rel="noreferrer">Solscan ↗</a>
        <button type="button" data-copy="${escapeHtml(coin.mint)}">Salin mint</button>
        ${coin.links?.twitter ? `<a href="${escapeHtml(coin.links.twitter)}" target="_blank" rel="noreferrer">Twitter ↗</a>` : ''}
        ${coin.links?.telegram ? `<a href="${escapeHtml(coin.links.telegram)}" target="_blank" rel="noreferrer">Telegram ↗</a>` : ''}
        ${coin.links?.website ? `<a href="${escapeHtml(coin.links.website)}" target="_blank" rel="noreferrer">Website ↗</a>` : ''}
      </div>`;
    $('#detailModal').hidden = false;
    document.body.style.overflow = 'hidden';
    const canvas = $('#detailChart');
    if (canvas) drawChart(canvas, coin.symbol + coin.id, '#00e07a');
    $$('[data-copy]', body).forEach((button) => {
      button.addEventListener('click', () => copyText(button.dataset.copy));
    });
  }

  function closeModals() {
    $('#detailModal').hidden = true;
    $('#successModal').hidden = true;
    document.body.style.overflow = '';
  }

  /* ─────────────────────── Canvas chart ────────────────────────── */

  function drawChart(canvas, seed, color = '#00e07a') {
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || canvas.width;
    const height = canvas.clientHeight || canvas.height;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const rand = mulberry32(hashString(seed));
    const points = 72;
    let value = 0.28;
    const data = [];
    for (let i = 0; i < points; i += 1) {
      value += (rand() - 0.4) * 0.07;
      value = Math.min(0.94, Math.max(0.05, value));
      data.push(value);
    }

    // grid
    ctx.strokeStyle = 'rgba(140,255,205,0.07)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i += 1) {
      const y = (height / 4) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    const toXY = (v, i) => [(i / (points - 1)) * width, height - 8 - v * (height - 20)];
    const coords = data.map(toXY);

    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, 'rgba(0,224,122,0.35)');
    gradient.addColorStop(1, 'rgba(0,224,122,0)');
    ctx.beginPath();
    ctx.moveTo(0, height);
    coords.forEach(([x, y]) => ctx.lineTo(x, y));
    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.beginPath();
    coords.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();

    const [lastX, lastY] = coords[coords.length - 1];
    ctx.beginPath();
    ctx.arc(lastX - 2, lastY, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  /* ───────────────────────── Form create ───────────────────────── */

  function formValues() {
    return {
      name: $('#name').value.trim(),
      symbol: $('#symbol').value.trim().replace(/^\$/, '').toUpperCase(),
      description: $('#description').value.trim(),
      twitter: $('#twitter').value.trim(),
      telegram: $('#telegram').value.trim(),
      website: $('#website').value.trim(),
      devBuySol: Number($('#devBuy').value || 0),
      creatorFeeBps: Number($('#creatorFee').value || 0),
      slippageBps: Number($('#slippage').value || 100),
      mayhemMode: $('#mayhem').checked,
      holderReward: $('#holderReward').checked,
      image: state.imageData || undefined,
    };
  }

  function updatePreview() {
    const values = formValues();
    $('#previewName').textContent = values.name || 'Nama coin';
    $('#previewSymbol').textContent = `$${values.symbol || 'TICKER'}`;
    $('#previewDesc').textContent = values.description || 'Deskripsi coin akan muncul di sini.';
    $('#previewDev').textContent = fmtSol(values.devBuySol);
    $('#nameCount').textContent = String($('#name').value.length);
    $('#descCount').textContent = String($('#description').value.length);
    $('#creatorFeeLabel').textContent = `${values.creatorFeeBps} bps (${(values.creatorFeeBps / 100).toFixed(1)}%)`;
    $('#slippageLabel').textContent = `${(values.slippageBps / 100).toFixed(1)}%`;

    const avatar = $('#previewAvatar');
    if (state.imageData) {
      avatar.innerHTML = `<img src="${state.imageData}" alt="" />`;
    } else {
      const [from, to] = paletteFor(values.symbol || values.name || 'P');
      avatar.style.background = `linear-gradient(135deg, ${from}, ${to})`;
      avatar.textContent = (values.symbol || values.name || 'P').slice(0, 1).toUpperCase();
    }

    const drop = $('#dropPreview');
    if (state.imageData) {
      drop.innerHTML = `<img src="${state.imageData}" alt="" />`;
      $('#removeImage').hidden = false;
    } else {
      drop.textContent = (values.symbol || values.name || 'P').slice(0, 1).toUpperCase();
      $('#removeImage').hidden = true;
    }

    $('#previewChart').innerHTML = sparkline(values.symbol || 'preview');
    updateCode();
  }

  /** Estimasi kasar sebelum /api/quote menjawab (rumus sama dengan src/curve.ts). */
  function localQuote(devBuySol) {
    const netSol = devBuySol * 0.99;
    const startVirtualSol = 30;
    const startVirtualToken = 1_073_000_000;
    const solAfter = startVirtualSol + netSol;
    const tokenAfter = (startVirtualSol * startVirtualToken) / solAfter;
    const tokensOut = startVirtualToken - tokenAfter;
    const price = solAfter / tokenAfter;
    return {
      tokensOut,
      marketCapSol: price * 1_000_000_000,
      priceSol: price,
      progress: netSol / 85,
    };
  }

  let estimateTimer = null;
  async function updateEstimate() {
    const values = formValues();
    const fallback = localQuote(values.devBuySol);
    $('#estTokens').textContent = values.devBuySol > 0 ? fmtTokens(fallback.tokensOut) : '—';
    $('#estMcap').textContent = fmtUsd(fallback.marketCapSol * state.solPrice);
    $('#estPrice').textContent = `$${fallback.priceSol * state.solPrice < 0.0001
      ? (fallback.priceSol * state.solPrice).toExponential(2)
      : (fallback.priceSol * state.solPrice).toFixed(6)}`;

    const progress = Math.min(100, Math.round((fallback.progress || 0) * 100));
    $('#previewProgress').style.width = `${progress}%`;
    $('#previewProgressLabel').textContent = `${progress}% menuju Raydium`;
    $('#previewMcap').textContent = fmtUsd(fallback.marketCapSol * state.solPrice);

    clearTimeout(estimateTimer);
    estimateTimer = setTimeout(async () => {
      try {
        const quote = await api('/api/quote', {
          method: 'POST',
          body: JSON.stringify({ devBuySol: values.devBuySol }),
        });
        $('#estTokens').textContent = values.devBuySol > 0 ? fmtTokens(quote.after.tokensOut) : '—';
        $('#estMcap').textContent = fmtUsd(quote.after.marketCapUsd);
        $('#estPrice').textContent = `$${quote.after.priceUsd < 0.0001
          ? quote.after.priceUsd.toExponential(2)
          : quote.after.priceUsd.toFixed(6)}`;
        $('#previewMcap').textContent = fmtUsd(quote.after.marketCapUsd);
        const pct = Math.min(100, Math.round((quote.after.progress || 0) * 100));
        $('#previewProgress').style.width = `${pct}%`;
        $('#previewProgressLabel').textContent = `${pct}% menuju Raydium`;
      } catch {
        /* fallback lokal sudah terpasang */
      }
    }, 260);
  }

  function codeSnippet() {
    const values = formValues();
    const payload = {
      name: values.name || 'Pumping Cat',
      symbol: values.symbol || 'PUMPCAT',
      description: values.description || 'Coin pertama saya di pump.fun.',
      devBuySol: values.devBuySol,
      twitter: values.twitter || undefined,
      telegram: values.telegram || undefined,
      website: values.website || undefined,
    };
    const clean = Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined));

    if (state.codeTab === 'js') {
      return `const response = await fetch('${location.origin}/api/launch', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(${JSON.stringify(clean, null, 2)})
});

const result = await response.json();
console.log(result.mint, result.pumpUrl);`;
    }

    if (state.codeTab === 'cli') {
      const parts = [
        'npm run launch --',
        `--name "${values.name || 'Pumping Cat'}"`,
        `--symbol ${values.symbol || 'PUMPCAT'}`,
        `--description "${values.description || 'Coin pertama saya'}"`,
        `--dev-buy ${values.devBuySol}`,
      ];
      if (values.twitter) parts.push(`--twitter ${values.twitter}`);
      if (values.website) parts.push(`--website ${values.website}`);
      return parts.join(' \\\n  ');
    }

    return `curl -X POST ${location.origin}/api/launch \\
  -H 'Content-Type: application/json' \\
  -d '${JSON.stringify(clean, null, 2)}'`;
  }

  function updateCode() {
    $('#codeOut').innerHTML = `<code>${escapeHtml(codeSnippet())}</code>`;
  }

  /* ───────────────────────── Upload gambar ─────────────────────── */

  function handleFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast('File bukan gambar', 'Pilih PNG, JPG, GIF, atau WEBP.', 'error');
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      toast('Gambar terlalu besar', 'Maksimal 4 MB.', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      state.imageData = String(reader.result);
      updatePreview();
      toast('Gambar siap', file.name, 'ok');
    };
    reader.readAsDataURL(file);
  }

  /* ───────────────────────── Submit launch ─────────────────────── */

  async function submitLaunch(event) {
    event.preventDefault();
    if (state.submitting) return;

    const values = formValues();
    if (!values.name) return toast('Nama belum diisi', 'Isi nama coin dulu.', 'error');
    if (!values.symbol) return toast('Ticker belum diisi', 'Contoh: PUMPCAT.', 'error');

    state.submitting = true;
    const button = $('#submitBtn');
    const label = $('#submitLabel');
    button.disabled = true;
    label.textContent = 'Menyiapkan metadata…';

    const phases = [
      'Mengunggah metadata…',
      'Membangun instruksi create_v2…',
      'Menandatangani & mengirim…',
    ];
    let phase = 0;
    const phaseTimer = setInterval(() => {
      phase = Math.min(phase + 1, phases.length - 1);
      label.textContent = phases[phase];
    }, 1400);

    try {
      const result = await api('/api/launch', {
        method: 'POST',
        body: JSON.stringify({ ...values, simulate: state.status?.simulation === true }),
      });
      showSuccess(result);
      state.coins.unshift(result.record);
      renderCoins();
      renderMarquee();
      updateStats();
    } catch (error) {
      toast('Launch gagal', error.message, 'error');
    } finally {
      clearInterval(phaseTimer);
      state.submitting = false;
      button.disabled = false;
      label.textContent = 'Luncurkan coin';
    }
  }

  function showSuccess(result) {
    $('#successTitle').textContent = result.simulated ? 'Simulasi berhasil!' : 'Coin berhasil dibuat!';
    $('#successSub').textContent = result.simulated
      ? result.notice || 'Tidak ada transaksi on-chain yang dikirim.'
      : `Transaksi ${short(result.signature, 8)} sudah dikonfirmasi.`;
    $('#successIcon').textContent = result.simulated ? '🧪' : '🚀';

    $('#successKv').innerHTML = `
      <div class="kv-row"><span>Nama</span><strong>${escapeHtml(result.name)} ($${escapeHtml(result.symbol)})</strong></div>
      <div class="kv-row"><span>Mint</span><strong>${escapeHtml(result.mint)}</strong></div>
      <div class="kv-row"><span>Dev buy</span><strong>${fmtSol(result.devBuySol)}${result.tokensReceived ? ` → ${fmtTokens(result.tokensReceived)} token` : ''}</strong></div>
      <div class="kv-row"><span>Metadata</span><strong>${escapeHtml(result.uri)}</strong></div>
      ${result.signature ? `<div class="kv-row"><span>Signature</span><strong>${escapeHtml(result.signature)}</strong></div>` : ''}`;

    $('#successActions').innerHTML = `
      <button class="btn btn-primary btn-sm" data-copy="${escapeHtml(result.mint)}">Salin mint</button>
      <a class="btn btn-ghost btn-sm" href="${escapeHtml(result.pumpUrl)}" target="_blank" rel="noreferrer">pump.fun ↗</a>
      <a class="btn btn-ghost btn-sm" href="${escapeHtml(result.explorerUrl)}" target="_blank" rel="noreferrer">Explorer ↗</a>
      <button class="btn btn-ghost btn-sm" data-close>Tutup</button>`;

    $$('[data-copy]', $('#successActions')).forEach((el) =>
      el.addEventListener('click', () => copyText(el.dataset.copy)),
    );
    $$('[data-close]', $('#successActions')).forEach((el) =>
      el.addEventListener('click', closeModals),
    );

    $('#successModal').hidden = false;
    document.body.style.overflow = 'hidden';
    burstConfetti();
  }

  function burstConfetti() {
    const burst = $('#successBurst');
    const colors = ['#00e07a', '#8dffcd', '#00c2ff', '#ffd166', '#ff2d95'];
    burst.innerHTML = Array.from({ length: 26 })
      .map((_, i) => {
        const left = Math.random() * 100;
        const delay = Math.random() * 0.5;
        const color = colors[i % colors.length];
        return `<span style="left:${left}%;background:${color};animation-delay:${delay}s"></span>`;
      })
      .join('');
    setTimeout(() => { burst.innerHTML = ''; }, 2400);
  }

  /* ──────────────────────── Hero ticket ────────────────────────── */

  function animateTicket() {
    const canvas = $('#ticketChart');
    if (canvas) drawChart(canvas, 'PUMPCAT-ticket', '#00e07a');
    let mcap = 61.7;
    setInterval(() => {
      mcap = Math.max(40, mcap + (Math.random() - 0.35) * 1.2);
      $('#ticketMcap').textContent = fmtUsd(mcap * 1000);
    }, 3200);
  }

  /* ─────────────────────────── Wiring ──────────────────────────── */

  function bindEvents() {
    $('#tabs').addEventListener('click', (event) => {
      const tab = event.target.closest('.tab');
      if (!tab) return;
      state.tab = tab.dataset.tab;
      $$('.tab').forEach((el) => el.classList.toggle('is-active', el === tab));
      renderCoins();
    });

    let searchTimer = null;
    $('#search').addEventListener('input', (event) => {
      clearTimeout(searchTimer);
      const value = event.target.value;
      searchTimer = setTimeout(() => {
        state.query = value;
        renderCoins();
      }, 160);
    });

    ['#name', '#symbol', '#description', '#twitter', '#telegram', '#website', '#devBuy', '#creatorFee', '#slippage', '#mayhem', '#holderReward']
      .forEach((selector) => {
        const el = $(selector);
        if (!el) return;
        el.addEventListener('input', () => {
          updatePreview();
          updateEstimate();
        });
        el.addEventListener('change', () => {
          updatePreview();
          updateEstimate();
        });
      });

    $('#quickBuys').addEventListener('click', (event) => {
      const button = event.target.closest('button[data-sol]');
      if (!button) return;
      $('#devBuy').value = button.dataset.sol;
      $$('#quickBuys button').forEach((el) => el.classList.toggle('is-active', el === button));
      updatePreview();
      updateEstimate();
    });

    const dropzone = $('#dropzone');
    const fileInput = $('#fileInput');
    dropzone.addEventListener('click', (event) => {
      if (event.target.id === 'removeImage') return;
      fileInput.click();
    });
    dropzone.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        fileInput.click();
      }
    });
    fileInput.addEventListener('change', (event) => handleFile(event.target.files?.[0]));

    ['dragenter', 'dragover'].forEach((type) =>
      dropzone.addEventListener(type, (event) => {
        event.preventDefault();
        dropzone.classList.add('is-drag');
      }),
    );
    ['dragleave', 'drop'].forEach((type) =>
      dropzone.addEventListener(type, (event) => {
        event.preventDefault();
        dropzone.classList.remove('is-drag');
        if (type === 'drop') handleFile(event.dataTransfer?.files?.[0]);
      }),
    );

    $('#removeImage').addEventListener('click', (event) => {
      event.stopPropagation();
      state.imageData = null;
      fileInput.value = '';
      updatePreview();
    });

    $('#advancedToggle').addEventListener('click', (event) => {
      const panel = $('#advanced');
      const shown = panel.hidden;
      panel.hidden = !shown;
      event.target.textContent = shown ? 'sembunyikan' : 'tampilkan';
      event.target.setAttribute('aria-expanded', String(shown));
    });

    $('#codeTabs').addEventListener('click', (event) => {
      const tab = event.target.closest('.code-tab');
      if (!tab) return;
      state.codeTab = tab.dataset.code;
      $$('.code-tab').forEach((el) => el.classList.toggle('is-active', el === tab));
      updateCode();
    });

    $('#copyCode').addEventListener('click', () => copyText(codeSnippet()));

    $('#launchForm').addEventListener('submit', submitLaunch);

    $('#walletChip').addEventListener('click', () => {
      const address = state.status?.launcherAddress;
      if (address) copyText(address);
      else toast('Wallet belum diset', 'Jalankan `npm run wallet:new` di server.', 'error');
    });

    $('#chainBadge').addEventListener('click', () => {
      const status = state.status;
      if (!status) return;
      toast(
        status.simulation ? 'Mode simulasi' : 'On-chain aktif',
        status.simulation
          ? status.reason || 'Wallet launcher belum siap.'
          : `RPC ${status.rpcHost} · saldo ${(status.launcherBalanceSol ?? 0).toFixed(4)} SOL`,
        status.simulation ? 'info' : 'ok',
      );
    });

    $$('[data-close]').forEach((el) => el.addEventListener('click', closeModals));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeModals();
    });

    window.addEventListener('resize', () => {
      const ticket = $('#ticketChart');
      if (ticket) drawChart(ticket, 'PUMPCAT-ticket', '#00e07a');
    });
  }

  function init() {
    bindEvents();
    updatePreview();
    updateEstimate();
    animateTicket();
    startLiveTicker();
    loadStatus().then(loadCoins);

    // Muat ulang data tiap 45 detik supaya papan terasa hidup.
    setInterval(() => {
      loadStatus();
      api('/api/coins?limit=48')
        .then((data) => {
          if (data.coins) {
            const mine = state.coins.filter((coin) => coin.source === 'user' && !data.coins.some((c) => c.id === coin.id));
            state.coins = [...mine, ...data.coins];
            renderCoins();
            renderMarquee();
          }
        })
        .catch(() => {});
    }, 45_000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
