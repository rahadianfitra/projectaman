/* Kompres PDF — 100% di browser.
 *
 * Mode pintar (default): teks, font & vektor TIDAK disentuh, jadi hasil tetap bisa dicari/diseleksi.
 *   1. Setiap gambar di dalam PDF (JPEG atau gambar mentah/Flate) di-decode, diperkecil ke DPI target,
 *      lalu disimpan ulang sebagai JPEG dengan kualitas sesuai persentase. Hanya diganti bila lebih kecil.
 *   2. Stream yang belum terkompresi (konten halaman, font, dll) dikompres Flate.
 *   3. Disimpan dengan object stream. Bila hasil akhir tidak lebih kecil, file asli dipertahankan.
 * Mode gambar: tiap halaman di-render jadi JPEG (paling kecil untuk hasil scan, teks tidak bisa dicari). */
'use strict';
(() => {
  const { $, $$, clamp, setupDropzone, isPdf, toast, loading, loadPdfLib, downloadBlob, pdfBlob, openPdfJs,
    renderPage, baseName, sanitize, libsReady, startTask, isCancel, tick, canvasToBlob, formatBytes,
    bindCompare } = App;

  const drop = $('#cpdf-drop');
  const input = $('#cpdf-input');
  const panel = $('#cpdf-panel');
  const level = $('#cpdf-level');
  const resultBox = $('#cpdf-result');
  const cmp = bindCompare($('#cpdf-cmp'));
  const MAX_SIDE = 4000;          // batas piksel kanvas per sisi (mode gambar)
  const MAX_IMG_PIXELS = 50e6;    // gambar lebih besar dari ini dilewati agar tidak kehabisan memori
  const MIN_IMG_BYTES = 8 * 1024; // gambar kecil tidak sebanding untuk dikompres ulang

  const st = { file: null, buf: null, pdf: null, result: null, page: 1, renderToken: 0 };

  setupDropzone(drop, input, (f) => load(f[0]), isPdf);
  $('#cpdf-reset').addEventListener('click', () => { reset(); input.click(); });
  $('#cpdf-run').addEventListener('click', run);
  $('#cpdf-download').addEventListener('click', () => {
    if (st.result) downloadBlob(st.result.blob, `${sanitize(baseName(st.file.name))}-compressed.pdf`);
  });
  $('#cpdf-prev').addEventListener('click', () => showPage(st.page - 1));
  $('#cpdf-next').addEventListener('click', () => showPage(st.page + 1));
  $('#cpdf-zoom').addEventListener('change', () => showPage(st.page));
  level.addEventListener('input', () => { updateHint(); clearResult(); });
  $$('input[name="cpdf-mode"]').forEach((r) => r.addEventListener('change', () => { updateHint(); clearResult(); }));
  $$('#view-compress .chip').forEach((b) => b.addEventListener('click', () => {
    level.value = b.dataset.level; updateHint(); clearResult();
  }));

  const mode = () => $('input[name="cpdf-mode"]:checked').value;

  /* Persentase -> kualitas JPEG & DPI.
   * pintar: 10% -> 86%/280 DPI · 50% -> 60%/190 DPI · 90% -> 34%/100 DPI
   * gambar: 10% -> 87%/186 DPI · 50% -> 53%/130 DPI · 90% -> 19%/74 DPI */
  function params(lv, m = mode()) {
    return m === 'raster'
      ? { q: clamp(0.95 - lv * 0.0085, 0.15, 0.9), dpi: Math.round(200 - lv * 1.4) }
      : { q: clamp(0.92 - lv * 0.0065, 0.3, 0.9), dpi: Math.round(300 - lv * 2.2) };
  }

  function updateHint() {
    const lv = +level.value;
    $('#cpdf-level-val').textContent = lv;
    $$('#view-compress .chip').forEach((b) => b.classList.toggle('active', +b.dataset.level === lv));
    const p = params(lv);
    $('#cpdf-level-hint').textContent = mode() === 'raster'
      ? `Halaman dijadikan gambar JPEG: kualitas ${Math.round(p.q * 100)}% · ${p.dpi} DPI. Teks tidak bisa dicari lagi.`
      : `Gambar di dalam PDF: kualitas ${Math.round(p.q * 100)}% · maks ${p.dpi} DPI. Teks, font & vektor tidak diubah (tetap bisa dicari).`;
  }
  updateHint();

  function clearResult() {
    st.renderToken++;
    st.result?.pdf?.destroy();
    st.result = null;
    resultBox.hidden = true;
    cmp.clear();
  }

  function reset() {
    clearResult();
    st.pdf?.destroy();
    Object.assign(st, { file: null, buf: null, pdf: null, page: 1 });
    panel.hidden = true;
    drop.hidden = false;
  }

  async function load(file) {
    if (!libsReady(['PDFLib', 'pdfjsLib'])) return;
    reset();
    loading(true, 'Membuka PDF…');
    try {
      st.buf = await file.arrayBuffer();
      st.pdf = await openPdfJs(st.buf);
      st.file = file;
      $('#cpdf-info').textContent = `${file.name} · ${st.pdf.numPages} halaman · ${formatBytes(file.size)}`;
      panel.hidden = false;
      drop.hidden = true;
    } catch (e) {
      reset();
      toast(e.message, 'error');
    } finally {
      loading(false);
    }
  }

  /* ================= Mode pintar ================= */
  const N = (s) => PDFLib.PDFName.of(s); // PDFName.of mengembalikan instance yang sama -> bisa dibandingkan dengan ===
  const RAW_FILTERS = ['FlateDecode', 'Fl', 'LZWDecode', 'LZW', 'ASCII85Decode', 'A85', 'ASCIIHexDecode', 'AHx', 'RunLengthDecode', 'RL'];

  function makeHelpers(ctx) {
    const { PDFName, PDFArray, PDFNumber, PDFDict, PDFRawStream } = PDFLib;
    const look = (o) => ctx.lookup(o);
    const num = (o) => { const v = look(o); return v instanceof PDFNumber ? v.asNumber() : undefined; };
    const nameIs = (o, ...names) => { const v = look(o); return v instanceof PDFName && names.some((n) => v === N(n)); };

    function filters(dict) {
      const f = dict.lookup(N('Filter'));
      if (!f) return [];
      const arr = f instanceof PDFArray ? f.asArray().map(look) : [f];
      return arr.map((x) => (x instanceof PDFName ? (RAW_FILTERS.concat('DCTDecode', 'DCT', 'JPXDecode', 'JBIG2Decode', 'CCITTFaxDecode').find((n) => x === N(n)) || '?') : '?'));
    }

    /* Jumlah komponen warna yang aman diproses: 1 (abu-abu) / 3 (RGB), selain itu 0 = lewati */
    function components(cs) {
      cs = look(cs);
      if (cs instanceof PDFName) return cs === N('DeviceRGB') ? 3 : cs === N('DeviceGray') ? 1 : 0;
      if (cs instanceof PDFArray && cs.size() >= 1) {
        const t = look(cs.get(0));
        if (t === N('CalRGB')) return 3;
        if (t === N('CalGray')) return 1;
        if (t === N('ICCBased')) {
          const s = look(cs.get(1));
          const n = s instanceof PDFRawStream ? num(s.dict.get(N('N'))) : undefined;
          return n === 3 || n === 1 ? n : 0;
        }
      }
      return 0;
    }

    function decodeParms(dict, idx) {
      let p = dict.lookup(N('DecodeParms')) || dict.lookup(N('DP'));
      if (p instanceof PDFArray) p = look(p.get(idx));
      return p instanceof PDFDict ? p : null;
    }

    return { look, num, nameIs, filters, components, decodeParms };
  }

  /* Membalik PNG predictor (Predictor >= 10) untuk data 8-bit */
  function unpredictPng(data, colors, columns) {
    const rowLen = colors * columns;
    const rows = Math.floor(data.length / (rowLen + 1));
    const out = new Uint8Array(rows * rowLen);
    let prev = new Uint8Array(rowLen);
    for (let r = 0; r < rows; r++) {
      const type = data[r * (rowLen + 1)];
      const src = r * (rowLen + 1) + 1;
      const cur = out.subarray(r * rowLen, (r + 1) * rowLen);
      for (let i = 0; i < rowLen; i++) {
        const x = data[src + i];
        const a = i >= colors ? cur[i - colors] : 0;
        const b = prev[i];
        const c = i >= colors ? prev[i - colors] : 0;
        let v;
        switch (type) {
          case 1: v = x + a; break;
          case 2: v = x + b; break;
          case 3: v = x + ((a + b) >> 1); break;
          case 4: {
            const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
            v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
            break;
          }
          default: v = x;
        }
        cur[i] = v & 255;
      }
      prev = cur;
    }
    return out;
  }

  /* Ubah satu image XObject jadi sumber yang bisa digambar di canvas, atau null bila tidak didukung */
  async function imageSource(stream, h) {
    const d = stream.dict;
    const w = h.num(d.get(N('Width')));
    const ht = h.num(d.get(N('Height')));
    if (!w || !ht || w * ht > MAX_IMG_PIXELS) return null;
    if (d.lookup(N('ImageMask')) === PDFLib.PDFBool.True || d.get(N('Decode'))) return null;
    const comps = h.components(d.get(N('ColorSpace')));
    if (!comps) return null;
    const f = h.filters(d);

    if (f.length === 1 && (f[0] === 'DCTDecode' || f[0] === 'DCT')) {
      const bmp = await createImageBitmap(new Blob([stream.contents], { type: 'image/jpeg' }));
      return { src: bmp, w: bmp.width, h: bmp.height, comps };
    }
    if (!f.every((x) => RAW_FILTERS.includes(x))) return null; // JPX, JBIG2, CCITT, dll -> lewati
    if (h.num(d.get(N('BitsPerComponent'))) !== 8) return null;

    let data = PDFLib.decodePDFRawStream(stream).decode();
    const fi = f.findIndex((x) => /^(FlateDecode|Fl|LZWDecode|LZW)$/.test(x));
    const parms = fi >= 0 ? h.decodeParms(d, fi) : null;
    const pred = parms ? h.num(parms.get(N('Predictor'))) || 1 : 1;
    if (pred >= 10) {
      const colors = h.num(parms.get(N('Colors'))) || 1;
      const cols = h.num(parms.get(N('Columns'))) || 1;
      const bpc = h.num(parms.get(N('BitsPerComponent'))) || 8;
      if (colors !== comps || cols !== w || bpc !== 8) return null;
      data = unpredictPng(data, colors, cols);
    } else if (pred !== 1) {
      return null; // TIFF predictor: jarang, lewati
    }
    if (data.length < w * ht * comps) return null;

    const img = new ImageData(w, ht);
    const px = img.data;
    for (let i = 0, j = 0, n = w * ht; i < n; i++, j += comps) {
      const o = i * 4;
      if (comps === 3) { px[o] = data[j]; px[o + 1] = data[j + 1]; px[o + 2] = data[j + 2]; }
      else { px[o] = px[o + 1] = px[o + 2] = data[j]; }
      px[o + 3] = 255;
    }
    return { src: await createImageBitmap(img), w, h: ht, comps };
  }

  async function recompressImage(stream, h, maxSide, q) {
    let s;
    try { s = await imageSource(stream, h); } catch { return null; }
    if (!s) return null;
    try {
      const ratio = Math.min(1, maxSide / Math.max(s.w, s.h));
      const w = Math.max(1, Math.round(s.w * ratio));
      const ht = Math.max(1, Math.round(s.h * ratio));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = ht;
      const cx = canvas.getContext('2d');
      cx.fillStyle = '#fff';
      cx.fillRect(0, 0, w, ht);
      cx.imageSmoothingQuality = 'high';
      cx.drawImage(s.src, 0, 0, w, ht);
      const blob = await canvasToBlob(canvas, 'image/jpeg', q);
      canvas.width = canvas.height = 0;
      if (!blob) return null;
      return { bytes: new Uint8Array(await blob.arrayBuffer()), w, h: ht, comps: s.comps };
    } finally {
      s.src.close?.();
    }
  }

  async function smartCompress(task) {
    const { PDFRawStream, PDFNumber, PDFRef } = PDFLib;
    const { q, dpi } = params(+level.value, 'smart');
    task.progress(0.02, 'Membaca struktur PDF…');
    await tick();
    const doc = await loadPdfLib(st.buf);
    const ctx = doc.context;
    const h = makeHelpers(ctx);

    // Batas piksel gambar = sisi halaman terbesar (inci) × DPI target.
    const maxPageIn = Math.max(...doc.getPages().map((p) => Math.max(p.getWidth(), p.getHeight()))) / 72;
    const maxSide = Math.max(600, Math.round(maxPageIn * dpi));

    const objs = ctx.enumerateIndirectObjects();
    const isImage = (o) => o instanceof PDFRawStream && o.dict.lookup(N('Subtype')) === N('Image');
    // SMask / Mask adalah gambar abu-abu khusus transparansi: jangan diubah jadi JPEG RGB.
    const masks = new Set();
    for (const [, o] of objs) {
      if (!isImage(o)) continue;
      for (const k of ['SMask', 'Mask']) { const r = o.dict.get(N(k)); if (r instanceof PDFRef) masks.add(r.toString()); }
    }
    const images = objs.filter(([ref, o]) => isImage(o) && !masks.has(ref.toString()) && o.contents.length >= MIN_IMG_BYTES);

    let replaced = 0;
    let saved = 0;
    for (let i = 0; i < images.length; i++) {
      task.check();
      task.progress(0.05 + 0.8 * (i / images.length), `Mengompres gambar ${i + 1} dari ${images.length}…`);
      await tick();
      const [ref, stream] = images[i];
      const r = await recompressImage(stream, h, maxSide, q);
      if (!r || r.bytes.length >= stream.contents.length * 0.95) continue;
      const d = stream.dict;
      d.set(N('Filter'), N('DCTDecode'));
      d.delete(N('DecodeParms'));
      d.delete(N('DP'));
      d.set(N('Width'), PDFNumber.of(r.w));
      d.set(N('Height'), PDFNumber.of(r.h));
      d.set(N('BitsPerComponent'), PDFNumber.of(8));
      if (r.comps !== 3) d.set(N('ColorSpace'), N('DeviceRGB')); // canvas selalu menghasilkan JPEG RGB
      saved += stream.contents.length - r.bytes.length;
      ctx.assign(ref, PDFRawStream.of(d, r.bytes));
      replaced++;
    }

    // Kompres stream yang belum terkompresi (konten halaman, font, dsb). Isi tidak berubah.
    task.check();
    task.progress(0.87, 'Mengoptimasi stream teks & font…');
    await tick();
    let flated = 0;
    for (const [ref, o] of ctx.enumerateIndirectObjects()) {
      if (!(o instanceof PDFRawStream) || o.contents.length < 256) continue;
      const d = o.dict;
      if (d.get(N('Filter')) || h.nameIs(d.get(N('Type')), 'XRef', 'ObjStm', 'Metadata')) continue;
      const packed = ctx.flateStream(o.contents).contents;
      if (packed.length >= o.contents.length * 0.9) continue;
      d.set(N('Filter'), N('FlateDecode'));
      ctx.assign(ref, PDFRawStream.of(d, packed));
      flated++;
    }

    task.check();
    task.progress(0.93, 'Menyimpan PDF…');
    await tick();
    const bytes = await doc.save({ useObjectStreams: true, updateFieldAppearances: false });
    return { bytes, note: `${replaced} dari ${images.length} gambar dikompres${flated ? `, ${flated} stream teks/font dioptimasi` : ''}. Teks tetap bisa dicari & diseleksi.` };
  }

  /* ================= Mode gambar (rasterize) ================= */
  async function rasterCompress(task) {
    const n = st.pdf.numPages;
    const { q, dpi } = params(+level.value, 'raster');
    const out = await PDFLib.PDFDocument.create();
    for (let p = 1; p <= n; p++) {
      task.check();
      task.progress((p - 1) / n * 0.95, `Mengubah halaman ${p} dari ${n} jadi gambar…`);
      const page = await st.pdf.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      const scale = Math.min(dpi / 72, MAX_SIDE / Math.max(vp.width, vp.height));
      const canvas = await renderPage(st.pdf, p, { scale });
      const blob = await canvasToBlob(canvas, 'image/jpeg', q);
      canvas.width = canvas.height = 0;
      if (!blob) throw new Error(`Halaman ${p} terlalu besar untuk diproses.`);
      task.check();
      const img = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
      out.addPage([vp.width, vp.height]).drawImage(img, { x: 0, y: 0, width: vp.width, height: vp.height });
      await tick();
    }
    task.check();
    task.progress(0.96, 'Menyimpan PDF…');
    await tick();
    return { bytes: await out.save({ useObjectStreams: true }), note: 'Halaman dijadikan gambar: teks tidak bisa dicari/diseleksi.' };
  }

  async function run() {
    if (!st.pdf) return;
    clearResult();
    const task = startTask('Menyiapkan…');
    try {
      const m = mode();
      const { bytes, note } = m === 'raster' ? await rasterCompress(task) : await smartCompress(task);
      task.check();
      task.progress(1, 'Menyiapkan pratinjau…');
      // Jangan pernah memberikan file yang lebih besar dari aslinya.
      const kept = bytes.length >= st.file.size;
      const blob = kept ? pdfBlob(new Uint8Array(st.buf)) : pdfBlob(bytes);
      st.result = { blob, kept, note, pdf: await openPdfJs(await blob.arrayBuffer()) };
      showResult();
      toast(kept ? 'File ini sudah optimal, tidak bisa diperkecil lagi.' : 'Kompresi selesai! Cek pratinjau sebelum mengunduh.', kept ? 'info' : 'success');
    } catch (e) {
      if (isCancel(e)) toast('Kompresi dibatalkan.');
      else toast(e.message || 'Gagal mengompres PDF.', 'error');
      clearResult();
    } finally {
      task.end();
    }
  }

  function showResult() {
    const before = st.file.size;
    const after = st.result.blob.size;
    const pct = App.savedPct(before, after);
    $('#cpdf-before').textContent = formatBytes(before);
    $('#cpdf-after').textContent = formatBytes(after);
    $('#cpdf-saved').textContent = pct > 0 ? `${pct}% (${formatBytes(before - after)})` : '0%';
    $('#cpdf-bar-after').style.width = clamp((after / before) * 100, 1, 100) + '%';
    $('#cpdf-note').textContent = st.result.kept ? '' : st.result.note;
    const warn = $('#cpdf-warn');
    warn.hidden = !st.result.kept;
    if (st.result.kept) {
      warn.textContent = mode() === 'raster'
        ? 'Hasil tidak lebih kecil, jadi file asli dipertahankan. Dokumen ini lebih efisien dengan mode "Kompres pintar".'
        : 'PDF ini sudah optimal (kemungkinan isinya teks/vektor tanpa gambar besar), jadi file asli dipertahankan apa adanya. Naikkan persentase bila PDF berisi foto/hasil scan.';
    }
    resultBox.hidden = false;
    showPage(1);
    resultBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function showPage(p) {
    if (!st.result) return;
    const n = st.pdf.numPages;
    st.page = clamp(p, 1, n);
    $('#cpdf-page').textContent = `Hal. ${st.page} / ${n}`;
    $('#cpdf-prev').disabled = st.page <= 1;
    $('#cpdf-next').disabled = st.page >= n;

    const token = ++st.renderToken;
    const zoom = +$('#cpdf-zoom').value;
    const box = $('#cpdf-cmp');
    const viewW = box.parentElement.clientWidth || 800;
    const page = await st.pdf.getPage(st.page);
    const vp = page.getViewport({ scale: 1 });
    // Pas layar: dibatasi tinggi layar. Zoom: 2x lebar kontainer (bisa digulir).
    const fitW = Math.min(viewW, (window.innerHeight * 0.7) * (vp.width / vp.height));
    const cssW = Math.round(zoom === 1 ? fitW : viewW * zoom);
    const pxW = Math.round(cssW * Math.min(window.devicePixelRatio || 1, 2));
    try {
      const [a, b] = await Promise.all([
        renderPage(st.pdf, st.page, { width: pxW }),
        renderPage(st.result.pdf, st.page, { width: pxW }),
      ]);
      if (token !== st.renderToken) return;
      box.style.width = cssW + 'px';
      cmp.set(a, b);
    } catch {
      if (token === st.renderToken) toast('Gagal menampilkan pratinjau halaman.', 'error');
    }
  }
})();
