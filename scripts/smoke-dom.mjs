/**
 * Smoke test DOM untuk dashboard (dev only).
 * Menjalankan web/app.js di jsdom dengan fetch & canvas di-stub, lalu memastikan
 * alur utama (render papan, preview form, submit launch, modal sukses) bekerja.
 *
 *   node scripts/smoke-dom.mjs
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync('web/index.html', 'utf8');
const appJs = readFileSync('web/app.js', 'utf8');

const demoCoin = (overrides) => ({
  id: 'x1',
  mint: 'So11111111111111111111111111111111111111112',
  name: 'Test Coin',
  symbol: 'TEST',
  description: 'coin uji',
  imageUrl: null,
  uri: null,
  creator: '9aBcDeFgHiJkLmNoPqRsTuVwXyZ1234567890abcd',
  devBuySol: 0.5,
  tokensReceived: 1000,
  signature: 'sig',
  simulated: true,
  createdAt: new Date().toISOString(),
  marketCapSol: 30,
  progress: 0.35,
  graduated: false,
  links: {},
  source: 'demo',
  ...overrides,
});

const coins = [
  demoCoin({ id: 'a', symbol: 'AAA', name: 'Alpha', marketCapSol: 400, progress: 0.9 }),
  demoCoin({ id: 'b', symbol: 'BBB', name: 'Beta', marketCapSol: 20, progress: 0.1 }),
  demoCoin({ id: 'c', symbol: 'CCC', name: 'Gamma', marketCapSol: 90, progress: 1, graduated: true }),
];

const calls = [];
let launchBody = null;

const dom = new JSDOM(html, {
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  url: 'http://localhost:3000/',
});

const { window } = dom;
window.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, {
  get: (_t, prop) => (prop === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}),
  set: () => true,
});
window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));

const json = (data, ok = true) => Promise.resolve({
  ok,
  status: ok ? 200 : 400,
  json: () => Promise.resolve(data),
  text: () => Promise.resolve(JSON.stringify(data)),
});

window.fetch = (url, options = {}) => {
  calls.push({ url, method: options.method || 'GET' });
  if (url.includes('/api/status')) {
    return json({
      ok: true, network: 'mainnet-beta', rpcHost: 'api.mainnet-beta.solana.com',
      rpcReachable: false, launcherAddress: null, launcherBalanceSol: null,
      simulation: true, metadataProvider: 'self', solPriceUsd: 150, maxDevBuySol: 5,
      pumpProgramId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', version: '1.0.0',
      reason: 'wallet belum diset',
    });
  }
  if (url.includes('/api/coins')) return json({ ok: true, total: coins.length, coins });
  if (url.includes('/api/quote')) {
    return json({ ok: true, after: { priceUsd: 0.00000447, marketCapUsd: 4475, tokensOut: 34_277_831, progress: 0.0116 } });
  }
  if (url.includes('/api/launch')) {
    launchBody = JSON.parse(options.body);
    return json({
      ok: true, simulated: true, mint: 'MintTest111', signature: 'SIM123', uri: 'http://x/m.json',
      imageUrl: 'http://x/i.svg', metadataProvider: 'self', name: launchBody.name,
      symbol: launchBody.symbol, devBuySol: launchBody.devBuySol, tokensReceived: 12345,
      marketCapSol: 29, progress: 0.01, explorerUrl: 'https://solscan.io/account/MintTest111',
      pumpUrl: 'https://pump.fun/coin/MintTest111',
      record: demoCoin({ id: 'new', name: launchBody.name, symbol: launchBody.symbol, source: 'user' }),
    });
  }
  return json({ ok: false, error: 'not found' }, false);
};

let failures = 0;
const check = (label, cond, extra = '') => {
  if (cond) console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ''}`);
  else { failures += 1; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};

const $ = (sel) => window.document.querySelector(sel);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

window.eval(appJs);
await wait(400);

console.log('\nDashboard smoke test');

check('kartu coin dirender', window.document.querySelectorAll('#coinGrid .coin-card').length === 3,
  `${window.document.querySelectorAll('#coinGrid .coin-card').length} kartu`);
check('marquee terisi', $('#marquee').children.length > 0, `${$('#marquee').children.length} item`);
check('mode pill terisi', $('#modePill').textContent.includes('SIMULASI'), $('#modePill').textContent);
check('sparkline SVG dibuat', window.document.querySelectorAll('.mini-chart svg').length >= 4,
  `${window.document.querySelectorAll('.mini-chart svg').length} chart`);
check('statistik terisi', $('#statLaunched').textContent !== '—', $('#statLaunched').textContent);

// tab Graduated
window.document.querySelector('[data-tab="graduated"]').dispatchEvent(new window.Event('click', { bubbles: true }));
check('filter graduated bekerja', window.document.querySelectorAll('#coinGrid .coin-card').length === 1);
window.document.querySelector('[data-tab="trending"]').dispatchEvent(new window.Event('click', { bubbles: true }));

// search
const search = $('#search');
search.value = 'beta';
search.dispatchEvent(new window.Event('input', { bubbles: true }));
await wait(220);
check('pencarian menyaring kartu', window.document.querySelectorAll('#coinGrid .coin-card').length === 1);
search.value = '';
search.dispatchEvent(new window.Event('input', { bubbles: true }));
await wait(220);

// preview form
const nameInput = $('#name');
nameInput.value = 'Pumping Dog';
nameInput.dispatchEvent(new window.Event('input', { bubbles: true }));
const symbolInput = $('#symbol');
symbolInput.value = 'pdog';
symbolInput.dispatchEvent(new window.Event('input', { bubbles: true }));
$('#description').value = 'Anjing yang rajin pumping';
$('#description').dispatchEvent(new window.Event('input', { bubbles: true }));
await wait(60);

check('preview nama sinkron', $('#previewName').textContent === 'Pumping Dog');
check('preview ticker uppercase', $('#previewSymbol').textContent === '$PDOG', $('#previewSymbol').textContent);
check('counter nama jalan', $('#nameCount').textContent === String('Pumping Dog'.length), $('#nameCount').textContent);
check('snippet kode berisi JSON', $('#codeOut').textContent.includes('Pumping Dog'));

// quick buy
window.document.querySelector('[data-sol="1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
check('quick buy mengubah input', $('#devBuy').value === '1');
await wait(400);
check('estimasi token terisi', $('#estTokens').textContent !== '—', $('#estTokens').textContent);

// submit
$('#launchForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
await wait(600);
check('POST /api/launch terkirim', calls.some((call) => call.url.includes('/api/launch') && call.method === 'POST'));
check('payload berisi nama', launchBody?.name === 'Pumping Dog', JSON.stringify(launchBody?.name));
check('payload menyertakan simulate', launchBody?.simulate === true, String(launchBody?.simulate));
check('modal sukses muncul', $('#successModal').hidden === false);
check('mint tampil di modal', $('#successKv').textContent.includes('MintTest111'));

// detail modal
window.document.querySelector('[data-close]').dispatchEvent(new window.Event('click', { bubbles: true }));
window.document.querySelector('#coinGrid .coin-card').dispatchEvent(new window.Event('click', { bubbles: true }));
check('modal detail terbuka', $('#detailModal').hidden === false);
check('detail memuat judul coin', $('#detailTitle').textContent.length > 0, $('#detailTitle').textContent);

// escaping
check('html di-escape', !window.document.body.innerHTML.includes('<script>alert(1)</script>'));

console.log('');
window.close();
if (failures) {
  console.error(`✗ ${failures} pemeriksaan gagal\n`);
  process.exit(1);
}
console.log('✓ Dashboard lolos smoke test\n');
process.exit(0);
