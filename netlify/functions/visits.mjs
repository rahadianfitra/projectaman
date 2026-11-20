/* PDFAman — penghitung pengunjung anonim (Netlify Function + Netlify Blobs).
 *
 * Yang DISIMPAN hanya angka agregat: jumlah pengunjung & page view per hari/bulan.
 * TIDAK disimpan: IP, cookie, user-agent, ID perangkat, URL, isi/nama file, atau data pribadi lain.
 * Browser hanya mengirim 3 nilai boolean (kunjungan pertama hari ini / bulan ini / pertama kali).
 *
 *   POST /api/hit   -> tambah hitungan, balas ringkasan
 *   GET  /api/stats -> data 30 hari & 12 bulan terakhir
 */
import { getStore } from '@netlify/blobs';

const TZ = 'Asia/Jakarta';
const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const BOT = /bot|crawl|spider|slurp|preview|monitor|headless|lighthouse|pingdom|curl|wget|python|axios|node-fetch|go-http/i;

const json = (data, status = 200, cache = 'no-store') => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cache },
});

const todayStr = (d = new Date()) => dateFmt.format(d); // "YYYY-MM-DD" (WIB)
const emptyMonth = () => ({ v: 0, pv: 0, days: {} });

async function readMonth(store, month) {
  return (await store.get('m:' + month, { type: 'json' })) || emptyMonth();
}

function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function summary(today, rec, total) {
  const day = rec.days[today.slice(8)] || { v: 0, pv: 0 };
  return {
    today: { date: today, v: day.v, pv: day.pv },
    month: { month: today.slice(0, 7), v: rec.v, pv: rec.pv },
    total: { v: total.v, pv: total.pv, since: total.since },
  };
}

async function hit(req, store) {
  const url = new URL(req.url);
  const origin = req.headers.get('origin');
  if (origin && origin !== url.origin) return json({ error: 'forbidden' }, 403);

  let body = {};
  try { body = await req.json(); } catch { /* body kosong = page view biasa */ }
  const isNewDay = body.d === true;
  const isNewMonth = body.m === true;
  const isNew = body.n === true;

  const today = todayStr();
  const month = today.slice(0, 7);
  const rec = await readMonth(store, month);
  const total = (await store.get('total', { type: 'json' })) || { v: 0, pv: 0, since: today };

  if (!BOT.test(req.headers.get('user-agent') || '')) {
    const day = (rec.days[today.slice(8)] ||= { v: 0, pv: 0 });
    day.pv++; rec.pv++; total.pv++;
    if (isNewDay) day.v++;
    if (isNewMonth) rec.v++;
    if (isNew) total.v++;
    await Promise.all([store.setJSON('m:' + month, rec), store.setJSON('total', total)]);
  }
  return json(summary(today, rec, total));
}

async function stats(store) {
  const now = new Date();
  const today = todayStr(now);
  const month = today.slice(0, 7);

  const monthKeys = Array.from({ length: 12 }, (_, i) => shiftMonth(month, i - 11));
  const recs = await Promise.all(monthKeys.map((m) => readMonth(store, m)));
  const byMonth = Object.fromEntries(monthKeys.map((m, i) => [m, recs[i]]));
  const total = (await store.get('total', { type: 'json' })) || { v: 0, pv: 0, since: today };

  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = todayStr(new Date(now.getTime() - i * 86400000));
    const r = byMonth[d.slice(0, 7)] || emptyMonth();
    const x = r.days[d.slice(8)] || { v: 0, pv: 0 };
    days.push({ date: d, v: x.v, pv: x.pv });
  }
  const months = monthKeys.map((m) => ({ month: m, v: byMonth[m].v, pv: byMonth[m].pv }));

  return json({ timezone: TZ, ...summary(today, byMonth[month], total), days, months }, 200, 'public, max-age=30');
}

export default async (req) => {
  const store = getStore({ name: 'pdfaman-visits', consistency: 'strong' });
  const { pathname } = new URL(req.url);
  try {
    if (pathname === '/api/hit' && req.method === 'POST') return await hit(req, store);
    if (pathname === '/api/stats' && req.method === 'GET') return await stats(store);
    return json({ error: 'not found' }, 404);
  } catch (e) {
    console.error(e);
    return json({ error: 'server error' }, 500);
  }
};

export const config = { path: ['/api/hit', '/api/stats'] };
