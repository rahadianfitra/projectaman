/* Penghitung pengunjung anonim + halaman Statistik.
 *
 * Yang dikirim ke server sendiri (/api/hit, domain yang sama) HANYA:
 *   { d: true/false, m: true/false, n: true/false }
 *   d = kunjungan pertama hari ini, m = pertama bulan ini, n = pertama kali.
 * Tidak ada cookie, ID, nama file, isi file, URL, atau referrer. Browser yang mengaktifkan
 * Do Not Track / Global Privacy Control tidak mengirim apa pun. */
'use strict';
(() => {
  const { $, toast, downloadBlob } = App;

  const TZ = 'Asia/Jakarta';
  const KEY = 'pdfaman_last_visit';
  const host = location.hostname;
  const isLocal = location.protocol === 'file:' || !host || host === 'localhost' || host === '127.0.0.1';
  const optOut = navigator.globalPrivacyControl === true || navigator.doNotTrack === '1' || window.doNotTrack === '1';
  const nf = new Intl.NumberFormat('id-ID');
  const fmt = (n) => nf.format(n || 0);

  const store = {
    get() { try { return localStorage.getItem(KEY); } catch { return null; } },
    set(v) { try { localStorage.setItem(KEY, v); } catch { /* mode privat: abaikan */ } },
  };
  const todayWib = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

  const api = (path, opts = {}) => fetch(path, {
    credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', ...opts,
  }).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });

  /* ---------- hitung kunjungan (sekali per buka halaman) ---------- */
  function countVisit() {
    if (isLocal) return;
    let req;
    if (optOut) {
      req = api('/api/stats');
    } else {
      const today = todayWib();
      const last = store.get();
      const body = { d: last !== today, m: !last || last.slice(0, 7) !== today.slice(0, 7), n: !last };
      store.set(today);
      req = api('/api/hit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), keepalive: true });
    }
    req.then(showFooter).catch(() => { /* statistik opsional, abaikan error */ });
  }

  function showFooter(s) {
    if (!s || !s.today) return;
    const el = $('#visit-line');
    el.textContent = `👥 ${fmt(s.today.v)} pengunjung hari ini · ${fmt(s.month.v)} bulan ini · ${fmt(s.total.v)} total`;
    el.hidden = false;
    $('#visit-sep').hidden = false;
  }

  /* ---------- halaman Statistik ---------- */
  let data = null;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const DAYS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
  const dayLabel = (d) => { const [y, m, dd] = d.split('-').map(Number); const w = new Date(Date.UTC(y, m - 1, dd)).getUTCDay(); return `${DAYS[w]}, ${dd} ${MONTHS[m - 1]} ${y}`; };
  const monthLabel = (m) => { const [y, mm] = m.split('-').map(Number); return `${MONTHS[mm - 1]} ${y}`; };

  function message(text) {
    $('#stats-msg').textContent = text;
    $('#stats-msg').hidden = !text;
  }

  async function loadStats() {
    if (isLocal) {
      message('Statistik hanya tersedia setelah situs di-deploy ke Netlify (butuh Netlify Function & Blobs). Di localhost tidak ada data.');
      $('#stats-body').hidden = true;
      return;
    }
    try {
      data = await api('/api/stats');
      message('');
      renderStats();
    } catch {
      message('Statistik belum bisa dimuat. Pastikan Netlify Function "visits" sudah ter-deploy.');
      $('#stats-body').hidden = true;
    }
  }

  function renderStats() {
    $('#stats-body').hidden = false;
    $('#k-today-v').textContent = fmt(data.today.v);
    $('#k-today-pv').textContent = `${fmt(data.today.pv)} page view`;
    $('#k-month-v').textContent = fmt(data.month.v);
    $('#k-month-pv').textContent = `${fmt(data.month.pv)} page view`;
    $('#k-total-v').textContent = fmt(data.total.v);
    $('#k-total-pv').textContent = `${fmt(data.total.pv)} page view${data.total.since ? ' · sejak ' + dayLabel(data.total.since).split(', ')[1] : ''}`;

    barChart($('#chart-days'), data.days.map((d, i) => ({
      v: d.v, pv: d.pv, full: dayLabel(d.date),
      tick: (i % 5 === 4 || i === data.days.length - 1) ? String(+d.date.slice(8)) + ' ' + MONTHS[+d.date.slice(5, 7) - 1] : '',
    })));
    barChart($('#chart-months'), data.months.map((m) => ({
      v: m.v, pv: m.pv, full: monthLabel(m.month), tick: MONTHS[+m.month.slice(5) - 1],
    })));
    table($('#table-days'), ['Tanggal', 'Pengunjung', 'Page view'], data.days.map((d) => [dayLabel(d.date), fmt(d.v), fmt(d.pv)]).reverse());
    table($('#table-months'), ['Bulan', 'Pengunjung', 'Page view'], data.months.map((m) => [monthLabel(m.month), fmt(m.v), fmt(m.pv)]).reverse());
  }

  function niceMax(v) {
    if (v <= 4) return 4;
    const p = 10 ** Math.floor(Math.log10(v));
    for (const s of [1, 2, 2.5, 5, 10]) if (s * p >= v) return s * p;
    return 10 * p;
  }

  function barChart(el, rows) {
    const max = niceMax(Math.max(...rows.map((r) => r.v), 0));
    el.innerHTML = '';
    const plot = document.createElement('div');
    plot.className = 'plot';
    [1, 0.5, 0].forEach((f) => {
      const g = document.createElement('div');
      g.className = 'grid-line' + (f === 0 ? ' base' : '');
      g.style.bottom = f * 100 + '%';
      g.innerHTML = `<span>${fmt(max * f)}</span>`;
      plot.appendChild(g);
    });
    const bars = document.createElement('div');
    bars.className = 'bars';
    rows.forEach((r, i) => {
      const col = document.createElement('div');
      col.className = 'bar-col';
      col.tabIndex = 0;
      col.dataset.i = i;
      col.setAttribute('aria-label', `${r.full}: ${r.v} pengunjung, ${r.pv} page view`);
      col.innerHTML = `<div class="bar" style="height:${(r.v / max) * 100}%"></div><span class="bar-tick">${r.tick}</span>`;
      bars.appendChild(col);
    });
    plot.appendChild(bars);
    const tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.hidden = true;
    plot.appendChild(tip);
    el.appendChild(plot);

    const show = (col) => {
      const r = rows[+col.dataset.i];
      tip.innerHTML = '<b></b><span></span>';
      tip.firstChild.textContent = r.full;
      tip.lastChild.textContent = `${fmt(r.v)} pengunjung · ${fmt(r.pv)} page view`;
      tip.hidden = false;
      const pr = plot.getBoundingClientRect();
      const cr = col.getBoundingClientRect();
      const x = cr.left - pr.left + cr.width / 2;
      tip.style.left = Math.min(Math.max(x, tip.offsetWidth / 2), pr.width - tip.offsetWidth / 2) + 'px';
      bars.querySelectorAll('.hover').forEach((c) => c.classList.remove('hover'));
      col.classList.add('hover');
    };
    const hide = () => { tip.hidden = true; bars.querySelectorAll('.hover').forEach((c) => c.classList.remove('hover')); };
    bars.addEventListener('mouseover', (e) => { const c = e.target.closest('.bar-col'); if (c) show(c); });
    bars.addEventListener('focusin', (e) => { const c = e.target.closest('.bar-col'); if (c) show(c); });
    bars.addEventListener('mouseleave', hide);
    bars.addEventListener('focusout', hide);
  }

  function table(el, head, rows) {
    const t = document.createElement('table');
    const tr = (cells, tag) => { const r = document.createElement('tr'); cells.forEach((c) => { const x = document.createElement(tag); x.textContent = c; r.appendChild(x); }); return r; };
    const th = document.createElement('thead'); th.appendChild(tr(head, 'th')); t.appendChild(th);
    const tb = document.createElement('tbody'); rows.forEach((r) => tb.appendChild(tr(r, 'td'))); t.appendChild(tb);
    el.replaceChildren(t);
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-csv]');
    if (!b || !data) return;
    const isDays = b.dataset.csv === 'days';
    const lines = isDays
      ? ['tanggal,pengunjung,page_view', ...data.days.map((d) => `${d.date},${d.v},${d.pv}`)]
      : ['bulan,pengunjung,page_view', ...data.months.map((m) => `${m.month},${m.v},${m.pv}`)];
    downloadBlob(new Blob([lines.join('\n') + '\n'], { type: 'text/csv' }), `pdfaman-pengunjung-${isDays ? 'harian' : 'bulanan'}.csv`);
    toast('CSV diunduh.', 'success');
  });

  document.addEventListener('view:stats', loadStats);
  document.addEventListener('DOMContentLoaded', countVisit);
})();
