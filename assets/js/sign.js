/* Tanda tangan PDF */
'use strict';
(() => {
  const { $, $$, clamp, setupDropzone, isPdf, toast, loading, loadPdfLib, downloadBlob, pdfBlob, openPdfJs,
    baseName, sanitize, dataUrlToBytes, libsReady } = App;

  const drop = $('#sign-drop');
  const input = $('#sign-input');
  const panel = $('#sign-panel');
  const pagesEl = $('#sign-pages');
  const sigListEl = $('#sig-list');
  const modal = $('#sig-modal');
  const st = { file: null, buf: null, pdf: null, signatures: [], active: null };
  let observer = null;
  let token = 0;
  let sigUid = 0;
  let selectedPl = null;

  const FONTS = ['Dancing Script', 'Great Vibes', 'Satisfy', 'Caveat'];

  setupDropzone(drop, input, (f) => load(f[0]), isPdf);
  $('#sign-reset').addEventListener('click', () => { reset(); input.click(); });
  $('#sign-save').addEventListener('click', save);
  $('#sig-new').addEventListener('click', openModal);
  $('#sig-date').addEventListener('click', addDate);

  /* ================= Load & render pages ================= */
  function reset() {
    token++;
    observer?.disconnect();
    st.pdf?.destroy();
    Object.assign(st, { file: null, buf: null, pdf: null });
    pagesEl.innerHTML = '';
    panel.hidden = true;
    drop.hidden = false;
    selectedPl = null;
  }

  async function load(file) {
    if (!libsReady(['PDFLib', 'pdfjsLib'])) return;
    reset();
    loading(true, 'Membuka PDF…');
    try {
      st.buf = await file.arrayBuffer();
      await loadPdfLib(st.buf);
      st.pdf = await openPdfJs(st.buf);
      st.file = file;
      $('#sign-info').textContent = `${file.name} · ${st.pdf.numPages} halaman`;
      panel.hidden = false;
      drop.hidden = true;
      await buildPages();
      refreshCursor();
      if (!st.signatures.length) setTimeout(openModal, 300);
    } catch (e) {
      reset();
      toast(e.message || 'Gagal membuka PDF.', 'error');
    } finally {
      loading(false);
    }
  }

  async function buildPages() {
    const t = token;
    observer = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        observer.unobserve(en.target);
        drawPage(en.target, t);
      });
    }, { rootMargin: '600px' });

    for (let i = 1; i <= st.pdf.numPages; i++) {
      const page = await st.pdf.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      const box = document.createElement('div');
      box.className = 'sign-page-box';
      box.innerHTML = `<div class="sign-page-label">Halaman ${i} / ${st.pdf.numPages}</div>`;
      const wrap = document.createElement('div');
      wrap.className = 'sign-page';
      wrap.dataset.index = i - 1;
      wrap.style.aspectRatio = `${vp.width} / ${vp.height}`;
      wrap.appendChild(document.createElement('canvas'));
      wrap.addEventListener('click', onPageClick);
      box.appendChild(wrap);
      pagesEl.appendChild(box);
      observer.observe(wrap);
    }
  }

  async function drawPage(wrap, t) {
    if (t !== token || !st.pdf) return;
    try {
      const page = await st.pdf.getPage(+wrap.dataset.index + 1);
      const cssW = wrap.clientWidth || 800;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: (cssW * dpr) / base.width });
      const canvas = wrap.querySelector('canvas');
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      page.cleanup();
    } catch { /* lewati */ }
  }

  function refreshCursor() {
    $$('.sign-page', pagesEl).forEach((p) => p.classList.toggle('no-sig', !st.active));
  }

  /* ================= Placement ================= */
  function onPageClick(e) {
    if (e.target.closest('.placement')) return;
    deselect();
    const sig = st.signatures.find((s) => s.id === st.active);
    if (!sig) return toast('Buat atau pilih tanda tangan dulu di panel kiri.', 'error');
    const wrap = e.currentTarget;
    const r = wrap.getBoundingClientRect();
    const wFrac = sig.kind === 'date' ? 0.2 : 0.25;
    const wPx = wFrac * r.width;
    const hPx = wPx * (sig.h / sig.w);
    const left = clamp(e.clientX - r.left - wPx / 2, 0, r.width - wPx);
    const top = clamp(e.clientY - r.top - hPx / 2, 0, Math.max(0, r.height - hPx));
    addPlacement(wrap, sig, left / r.width, top / r.height, wFrac);
  }

  function addPlacement(wrap, sig, u, v, w) {
    const el = document.createElement('div');
    el.className = 'placement';
    el.style.left = u * 100 + '%';
    el.style.top = v * 100 + '%';
    el.style.width = w * 100 + '%';
    el.innerHTML = `<img alt="Tanda tangan" draggable="false"><button class="pl-del" type="button" title="Hapus">✕</button><span class="pl-resize" title="Ubah ukuran">◢</span>`;
    el.querySelector('img').src = sig.dataUrl;
    el.querySelector('.pl-del').addEventListener('click', (e) => { e.stopPropagation(); el.remove(); selectedPl = null; });
    el.addEventListener('click', (e) => e.stopPropagation());
    makeInteractive(el, wrap);
    wrap.appendChild(el);
    select(el);
  }

  function select(el) { deselect(); selectedPl = el; el.classList.add('selected'); }
  function deselect() { selectedPl?.classList.remove('selected'); selectedPl = null; }

  document.addEventListener('keydown', (e) => {
    if (!selectedPl || modal.open) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName)) return;
      e.preventDefault();
      selectedPl.remove();
      selectedPl = null;
    }
  });

  function makeInteractive(el, wrap) {
    el.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.pl-del')) return;
      e.preventDefault();
      e.stopPropagation();
      select(el);
      const resizing = e.target.classList.contains('pl-resize');
      const W = wrap.clientWidth;
      const H = wrap.clientHeight;
      const sx = e.clientX, sy = e.clientY;
      const sl = el.offsetLeft, stp = el.offsetTop, sw = el.offsetWidth;
      const ratio = el.offsetHeight / el.offsetWidth;
      el.setPointerCapture(e.pointerId);

      const onMove = (ev) => {
        const dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (resizing) {
          let w = clamp(sw + dx, 24, W - sl);
          if (stp + w * ratio > H) w = (H - stp) / ratio;
          el.style.width = (w / W) * 100 + '%';
        } else {
          const l = clamp(sl + dx, 0, W - el.offsetWidth);
          const t = clamp(stp + dy, 0, Math.max(0, H - el.offsetHeight));
          el.style.left = (l / W) * 100 + '%';
          el.style.top = (t / H) * 100 + '%';
        }
      };
      const onUp = () => {
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        el.removeEventListener('pointercancel', onUp);
      };
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointercancel', onUp);
    });
  }

  /* ================= Simpan ke PDF ================= */
  async function save() {
    const placements = $$('.placement', pagesEl);
    if (!placements.length) return toast('Belum ada tanda tangan yang ditempel di halaman.', 'error');
    loading(true, 'Menyimpan PDF bertanda tangan…');
    try {
      const doc = await loadPdfLib(st.buf);
      const cache = new Map();
      for (const el of placements) {
        const wrap = el.parentElement;
        const page = doc.getPage(+wrap.dataset.index);
        const src = el.querySelector('img').src;
        let img = cache.get(src);
        if (!img) { img = await doc.embedPng(dataUrlToBytes(src)); cache.set(src, img); }

        // posisi relatif (0..1) terhadap tampilan halaman
        const W = wrap.clientWidth, H = wrap.clientHeight;
        const u0 = el.offsetLeft / W, v0 = el.offsetTop / H;
        const du = el.offsetWidth / W, dv = el.offsetHeight / H;
        const vb = v0 + dv; // tepi bawah gambar

        const rot = ((page.getRotation().angle % 360) + 360) % 360;
        const { x: bx, y: by, width: bw, height: bh } = page.getCropBox();
        let x, y;
        switch (rot) {
          case 90: x = bx + vb * bw; y = by + u0 * bh; break;
          case 180: x = bx + (1 - u0) * bw; y = by + vb * bh; break;
          case 270: x = bx + (1 - vb) * bw; y = by + (1 - u0) * bh; break;
          default: x = bx + u0 * bw; y = by + (1 - vb) * bh;
        }
        const sideways = rot === 90 || rot === 270;
        page.drawImage(img, {
          x, y,
          width: du * (sideways ? bh : bw),
          height: dv * (sideways ? bw : bh),
          rotate: PDFLib.degrees(rot),
        });
      }
      const bytes = await doc.save();
      downloadBlob(pdfBlob(bytes), `${sanitize(baseName(st.file.name))}-ttd.pdf`);
      toast('Berhasil! PDF bertanda tangan sedang diunduh.', 'success');
    } catch (e) {
      toast(e.message || 'Gagal menyimpan PDF.', 'error');
    } finally {
      loading(false);
    }
  }

  /* ================= Daftar tanda tangan ================= */
  function addSignature(dataUrl, w, h, kind = 'sig') {
    const sig = { id: 's' + ++sigUid, dataUrl, w, h, kind };
    st.signatures.push(sig);
    st.active = sig.id;
    renderSigList();
    refreshCursor();
  }

  function renderSigList() {
    if (!st.signatures.length) {
      sigListEl.innerHTML = '<p class="muted small">Belum ada. Buat dulu di bawah.</p>';
      return;
    }
    sigListEl.innerHTML = '';
    st.signatures.forEach((s) => {
      const d = document.createElement('div');
      d.className = 'sig-item' + (s.id === st.active ? ' active' : '');
      d.title = 'Klik untuk memakai tanda tangan ini';
      d.innerHTML = `<img alt=""><button class="icon-btn danger sig-del" type="button" title="Hapus">✕</button>`;
      d.querySelector('img').src = s.dataUrl;
      d.addEventListener('click', () => { st.active = s.id; renderSigList(); refreshCursor(); });
      d.querySelector('.sig-del').addEventListener('click', (e) => {
        e.stopPropagation();
        st.signatures = st.signatures.filter((x) => x.id !== s.id);
        if (st.active === s.id) st.active = st.signatures[0]?.id || null;
        renderSigList();
        refreshCursor();
      });
      sigListEl.appendChild(d);
    });
  }

  async function addDate() {
    const text = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    const out = await textToImage(text, 'Inter', currentColor(), 64, 500);
    addSignature(out.dataUrl, out.w, out.h, 'date');
    toast('Tanggal ditambahkan. Klik di halaman untuk menempel.', 'success');
  }

  /* ================= Modal pembuat tanda tangan ================= */
  const canvas = $('#sig-canvas');
  const ctx = canvas.getContext('2d');
  let tab = 'draw';
  let hasInk = false;
  let drawing = false;
  let last = null;
  let uploadData = null;
  let fontChoice = FONTS[0];

  const currentColor = () => $('input[name="sig-color"]:checked').value;

  function openModal() {
    modal.showModal();
    setTab(tab);
    setupCanvas();
  }

  $$('.tab', modal).forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  function setTab(t) {
    tab = t;
    $$('.tab', modal).forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
    $$('.pane', modal).forEach((p) => { p.hidden = p.dataset.pane !== t; });
    if (t === 'draw') setupCanvas();
    if (t === 'type') renderFonts();
  }

  function setupCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w) return;
    if (canvas.width === Math.round(w * dpr) && canvas.height === Math.round(h * dpr)) return;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    hasInk = false;
  }

  function pos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    drawing = true;
    last = pos(e);
    ctx.strokeStyle = ctx.fillStyle = currentColor();
    ctx.lineWidth = +$('#sig-thick').value;
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.arc(last.x, last.y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    hasInk = true;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of events) {
      const p = pos(ev);
      const mid = { x: (last.x + p.x) / 2, y: (last.y + p.y) / 2 };
      ctx.beginPath();
      ctx.moveTo(last.lastMid?.x ?? last.x, last.lastMid?.y ?? last.y);
      ctx.quadraticCurveTo(last.x, last.y, mid.x, mid.y);
      ctx.stroke();
      last = { x: p.x, y: p.y, lastMid: mid };
    }
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => canvas.addEventListener(ev, () => { drawing = false; }));
  $('#sig-clear').addEventListener('click', () => {
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.restore();
    hasInk = false;
  });

  // Ketik
  const sigText = $('#sig-text');
  sigText.addEventListener('input', renderFonts);
  sigText.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#sig-save-btn').click(); } });
  $$('input[name="sig-color"]').forEach((r) => r.addEventListener('change', () => { if (tab === 'type') renderFonts(); }));
  function renderFonts() {
    const list = $('#sig-fonts');
    const text = sigText.value.trim() || 'Nama Kamu';
    list.innerHTML = '';
    FONTS.forEach((f) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'font-opt' + (f === fontChoice ? ' active' : '');
      b.style.fontFamily = `"${f}", cursive`;
      b.style.color = currentColor();
      b.textContent = text;
      b.addEventListener('click', () => { fontChoice = f; renderFonts(); });
      list.appendChild(b);
    });
  }

  // Unggah
  $('#sig-upload').addEventListener('change', processUpload);
  $('#sig-removebg').addEventListener('change', processUpload);
  async function processUpload() {
    const file = $('#sig-upload').files[0];
    const prev = $('#sig-upload-preview');
    if (!file) return;
    if (!/^image\//.test(file.type)) return toast('File harus berupa gambar.', 'error');
    try {
      const img = await loadImage(URL.createObjectURL(file));
      const scale = Math.min(1, 1200 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      const cx = c.getContext('2d');
      cx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      if ($('#sig-removebg').checked) {
        const d = cx.getImageData(0, 0, c.width, c.height);
        const px = d.data;
        for (let i = 0; i < px.length; i += 4) {
          const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
          if (lum > 235) px[i + 3] = 0;
          else if (lum > 190) px[i + 3] = Math.round(px[i + 3] * (235 - lum) / 45);
        }
        cx.putImageData(d, 0, 0);
      }
      uploadData = trim(c);
      if (!uploadData) throw new Error();
      prev.innerHTML = '<img alt="Pratinjau">';
      prev.querySelector('img').src = uploadData.dataUrl;
    } catch {
      uploadData = null;
      prev.innerHTML = '<span class="muted small">Gambar tidak bisa dibaca atau kosong.</span>';
    }
  }

  $('#sig-save-btn').addEventListener('click', async () => {
    let out = null;
    if (tab === 'draw') {
      if (!hasInk) return toast('Gambar tanda tanganmu dulu.', 'error');
      out = trim(canvas);
    } else if (tab === 'type') {
      const text = sigText.value.trim();
      if (!text) return toast('Ketik namamu dulu.', 'error');
      out = await textToImage(text, fontChoice, currentColor(), 110, 400);
    } else {
      if (!uploadData) return toast('Pilih gambar tanda tangan dulu.', 'error');
      out = uploadData;
    }
    if (!out) return toast('Tanda tangan kosong.', 'error');
    addSignature(out.dataUrl, out.w, out.h);
    modal.close();
    toast('Tanda tangan siap. Klik di halaman untuk menempel.', 'success');
  });

  /* ================= util gambar ================= */
  function loadImage(src) {
    return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  }

  async function textToImage(text, font, color, size, weight) {
    const spec = `${weight} ${size}px "${font}"`;
    try { await document.fonts.load(spec, text); } catch { /* fallback font */ }
    const c = document.createElement('canvas');
    const cx = c.getContext('2d');
    cx.font = spec;
    const w = Math.ceil(cx.measureText(text).width) + size;
    c.width = w;
    c.height = Math.ceil(size * 1.8);
    cx.font = spec;
    cx.fillStyle = color;
    cx.textBaseline = 'middle';
    cx.fillText(text, size / 2, c.height / 2);
    return trim(c);
  }

  /* Potong area transparan di sekeliling gambar */
  function trim(src, pad = 6) {
    const w = src.width, h = src.height;
    const data = src.getContext('2d').getImageData(0, 0, w, h).data;
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] > 8) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null;
    minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
    maxX = Math.min(w - 1, maxX + pad); maxY = Math.min(h - 1, maxY + pad);
    const out = document.createElement('canvas');
    out.width = maxX - minX + 1;
    out.height = maxY - minY + 1;
    out.getContext('2d').drawImage(src, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
    return { dataUrl: out.toDataURL('image/png'), w: out.width, h: out.height };
  }
})();
