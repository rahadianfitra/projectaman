/* PDFAman — utilitas bersama & router.
 * Semua proses berjalan di browser. Tidak ada request yang mengirim file ke server. */
'use strict';

window.App = (() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const PDFJS_BASE = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/';
  const MAX_FILE_MB = 200;

  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_BASE + 'build/pdf.worker.min.js';
  }

  /* ---------- helpers ---------- */
  function formatBytes(b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1048576).toFixed(1) + ' MB';
  }
  const baseName = (n) => n.replace(/\.[^.]+$/, '');
  const sanitize = (n) => (n.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim().slice(0, 120) || 'file');
  const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
  const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  const pdfBlob = (bytes) => new Blob([bytes], { type: 'application/pdf' });

  let toastTimer;
  function toast(msg, type = 'info') {
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'toast show ' + type;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast'; }, type === 'error' ? 5000 : 3500);
  }

  function loading(on, text = 'Memproses…') {
    $('#loading').hidden = !on;
    $('#loading-text').textContent = text;
  }

  // Cegah browser membuka file yang tidak sengaja dijatuhkan di luar dropzone
  ['dragover', 'drop'].forEach((ev) => window.addEventListener(ev, (e) => e.preventDefault()));

  function setupDropzone(zone, input, onFiles, filter) {
    zone.addEventListener('click', () => input.click());
    zone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
    });
    ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => {
      e.preventDefault(); zone.classList.add('drag');
    }));
    ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => {
      e.preventDefault(); zone.classList.remove('drag');
    }));
    zone.addEventListener('drop', (e) => handle([...(e.dataTransfer?.files || [])]));
    input.addEventListener('change', () => { handle([...input.files]); input.value = ''; });

    function handle(files) {
      if (!files.length) return;
      const ok = files.filter(filter || (() => true));
      if (!ok.length) return toast('Format file tidak didukung.', 'error');
      if (ok.length < files.length) toast('Sebagian file dilewati karena formatnya tidak didukung.', 'error');
      const limit = MAX_FILE_MB * 1048576;
      const final = ok.filter((f) => f.size <= limit);
      if (final.length < ok.length) toast(`File di atas ${MAX_FILE_MB} MB dilewati.`, 'error');
      if (final.length) onFiles(final);
    }
  }

  /* "1-3, 5, 8-" -> [[1,3],[5,5],[8,max]] (1-based, inklusif) */
  function parseRanges(str, max) {
    const parts = String(str).split(',').map((s) => s.trim()).filter(Boolean);
    if (!parts.length) throw new Error('Isi rentang halaman dulu.');
    return parts.map((p) => {
      let a, b;
      const m = p.match(/^(\d*)\s*-\s*(\d*)$/);
      if (/^\d+$/.test(p)) { a = b = +p; }
      else if (m && (m[1] || m[2])) { a = m[1] ? +m[1] : 1; b = m[2] ? +m[2] : max; }
      else throw new Error(`Format "${p}" tidak valid. Contoh: 1-3, 5`);
      if (a < 1 || b < 1 || a > max || b > max) throw new Error(`Halaman "${p}" di luar jangkauan (1–${max}).`);
      if (a > b) throw new Error(`Rentang "${p}" terbalik.`);
      return [a, b];
    });
  }
  function rangesToIndices(ranges) {
    const out = [];
    for (const [a, b] of ranges) for (let i = a; i <= b; i++) out.push(i - 1);
    return out;
  }
  /* [1,2,3,5] -> "1-3, 5" */
  function compressPages(nums) {
    const s = [...new Set(nums)].sort((x, y) => x - y);
    const out = [];
    for (let i = 0; i < s.length; i++) {
      let j = i;
      while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
      out.push(i === j ? `${s[i]}` : `${s[i]}-${s[j]}`);
      i = j;
    }
    return out.join(', ');
  }

  /* ---------- PDF ---------- */
  function openPdfJs(buffer) {
    // pdf.js memindahkan buffer ke worker, jadi kirim salinannya
    return pdfjsLib.getDocument({
      data: new Uint8Array(buffer.slice(0)),
      isEvalSupported: false,
      cMapUrl: PDFJS_BASE + 'cmaps/',
      cMapPacked: true,
      standardFontDataUrl: PDFJS_BASE + 'standard_fonts/',
    }).promise.catch((e) => {
      if (e && e.name === 'PasswordException') throw new Error('PDF ini dilindungi password.');
      throw new Error('File PDF tidak bisa dibuka (mungkin rusak).');
    });
  }

  async function renderPage(pdf, pageNo, { scale = 1, width, canvas, background = '#ffffff' } = {}) {
    const page = await pdf.getPage(pageNo);
    let vp = page.getViewport({ scale: 1 });
    vp = page.getViewport({ scale: width ? width / vp.width : scale });
    canvas = canvas || document.createElement('canvas');
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    const ctx = canvas.getContext('2d');
    if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    page.cleanup();
    return canvas;
  }

  async function loadPdfLib(buffer) {
    try {
      return await PDFLib.PDFDocument.load(buffer);
    } catch (e) {
      if (/encrypt/i.test(e.message)) throw new Error('PDF ini terkunci/terenkripsi. Buka kuncinya dulu.');
      throw new Error('File PDF tidak bisa dibaca (mungkin rusak).');
    }
  }

  function dataUrlToBytes(dataUrl) {
    const bin = atob(dataUrl.split(',')[1]);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function libsReady(names) {
    const missing = names.filter((n) => !window[n]);
    if (missing.length) {
      toast('Library gagal dimuat. Periksa koneksi internet lalu muat ulang halaman.', 'error');
      return false;
    }
    return true;
  }

  /* ---------- router ---------- */
  const views = ['home', 'merge', 'split', 'pdf2img', 'sign', 'qr'];
  function route() {
    const h = (location.hash || '#home').slice(1);
    const v = views.includes(h) ? h : 'home';
    views.forEach((n) => { const el = $('#view-' + n); if (el) el.hidden = n !== v; });
    $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === v));
    $('#nav').classList.remove('open');
    $('#nav-toggle').setAttribute('aria-expanded', 'false');
    window.scrollTo(0, 0);
    document.dispatchEvent(new CustomEvent('view:' + v));
  }
  window.addEventListener('hashchange', route);
  document.addEventListener('DOMContentLoaded', () => {
    $('#year').textContent = new Date().getFullYear();
    $('#nav-toggle').addEventListener('click', () => {
      const open = $('#nav').classList.toggle('open');
      $('#nav-toggle').setAttribute('aria-expanded', String(open));
    });
    route();
  });

  return {
    $, $$, clamp, formatBytes, baseName, sanitize, isPdf, downloadBlob, pdfBlob, toast, loading,
    setupDropzone, parseRanges, rangesToIndices, compressPages, openPdfJs, renderPage, loadPdfLib,
    dataUrlToBytes, libsReady,
  };
})();
