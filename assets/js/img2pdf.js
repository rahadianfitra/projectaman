/* JPG/PNG ke PDF — 100% di browser (pdf-lib). Gambar tidak dikirim ke mana pun. */
'use strict';
(() => {
  const { $, setupDropzone, toast, loading, downloadBlob, pdfBlob, openPdfJs, renderPage, baseName, sanitize,
    libsReady, startTask, isCancel, tick, canvasToBlob, formatBytes } = App;

  const drop = $('#i2p-drop');
  const input = $('#i2p-input');
  const panel = $('#i2p-panel');
  const list = $('#i2p-list');
  const resultBox = $('#i2p-result');
  const items = [];
  let uid = 0;
  let dragId = null;
  let result = null;
  let previewToken = 0;

  // Ukuran kertas dalam point (1/72 inci), posisi potret
  const SIZES = { a4: [595.28, 841.89], f4: [609.45, 935.43], letter: [612, 792], legal: [612, 1008] };
  // Kualitas: maks sisi terpanjang (px) & kualitas JPEG. 'original' = file JPG/PNG disisipkan apa adanya.
  const QUALITY = { original: null, balanced: { max: 2480, q: 0.82 }, small: { max: 1600, q: 0.65 } };

  const isImage = (f) => /^image\/(jpeg|png|webp|gif|bmp)$/.test(f.type) || /\.(jpe?g|png|webp|gif|bmp)$/i.test(f.name);
  const isJpeg = (f) => f.type === 'image/jpeg' || /\.jpe?g$/i.test(f.name);
  const isPng = (f) => f.type === 'image/png' || /\.png$/i.test(f.name);

  setupDropzone(drop, input, addFiles, isImage);
  $('#i2p-add').addEventListener('click', () => input.click());
  $('#i2p-clear').addEventListener('click', () => { items.splice(0).forEach((it) => URL.revokeObjectURL(it.url)); changed(); });
  $('#i2p-run').addEventListener('click', run);
  $('#i2p-download').addEventListener('click', () => { if (result) downloadBlob(result.blob, result.name); });
  ['#i2p-size', '#i2p-orient', '#i2p-margin', '#i2p-quality'].forEach((s) => $(s).addEventListener('change', () => { syncControls(); clearResult(); }));

  function syncControls() {
    $('#i2p-orient').disabled = $('#i2p-size').value === 'fit';
  }
  syncControls();

  async function addFiles(files) {
    if (!libsReady(['PDFLib', 'pdfjsLib'])) return;
    loading(true, 'Membaca gambar…');
    for (const file of files) {
      try {
        const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); // ikut orientasi EXIF
        items.push({ id: ++uid, file, url: URL.createObjectURL(file), w: bmp.width, h: bmp.height, rot: 0 });
        bmp.close();
      } catch {
        toast(`${file.name}: gambar tidak bisa dibaca.`, 'error');
      }
    }
    loading(false);
    changed();
  }

  function clearResult() {
    previewToken++;
    result?.pdf?.destroy();
    result = null;
    resultBox.hidden = true;
    $('#i2p-preview').replaceChildren();
  }

  function changed() { clearResult(); render(); }

  function render() {
    panel.hidden = !items.length;
    drop.classList.toggle('compact', items.length > 0);
    const total = items.reduce((s, it) => s + it.file.size, 0);
    $('#i2p-summary').textContent = `${items.length} gambar · ${formatBytes(total)}`;
    list.innerHTML = '';
    items.forEach((it, i) => {
      const [w, h] = it.rot % 180 ? [it.h, it.w] : [it.w, it.h];
      const li = document.createElement('li');
      li.className = 'file-item';
      li.draggable = true;
      li.dataset.id = it.id;
      li.innerHTML = `
        <span class="grip" aria-hidden="true">⋮⋮</span>
        <div class="thumb img"><img src="${it.url}" alt="" style="transform:rotate(${it.rot}deg)"></div>
        <div class="meta"><strong></strong><small>Hal. ${i + 1} · ${w}×${h}px · ${formatBytes(it.file.size)}</small></div>
        <div class="row-actions">
          <button class="icon-btn" data-act="rot" title="Putar 90°" type="button">↻</button>
          <button class="icon-btn" data-act="up" title="Naikkan" type="button" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="icon-btn" data-act="down" title="Turunkan" type="button" ${i === items.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="icon-btn danger" data-act="del" title="Hapus" type="button">✕</button>
        </div>`;
      li.querySelector('strong').textContent = it.file.name; // aman dari XSS
      list.appendChild(li);
    });
  }

  const indexOf = (id) => items.findIndex((it) => it.id === id);
  function move(from, to) {
    if (to < 0 || to >= items.length || from === to) return;
    const [it] = items.splice(from, 1);
    items.splice(to, 0, it);
    changed();
  }

  list.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const i = indexOf(+btn.closest('li').dataset.id);
    const act = btn.dataset.act;
    if (act === 'up') move(i, i - 1);
    if (act === 'down') move(i, i + 1);
    if (act === 'rot') { items[i].rot = (items[i].rot + 90) % 360; changed(); }
    if (act === 'del') { URL.revokeObjectURL(items[i].url); items.splice(i, 1); changed(); }
  });

  // Drag & drop untuk urutan
  list.addEventListener('dragstart', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    dragId = +li.dataset.id;
    li.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(dragId));
  });
  list.addEventListener('dragend', () => {
    dragId = null;
    list.querySelectorAll('.dragging, .over').forEach((el) => el.classList.remove('dragging', 'over'));
  });
  list.addEventListener('dragover', (e) => {
    if (dragId == null) return;
    e.preventDefault();
    e.stopPropagation();
    list.querySelectorAll('.over').forEach((el) => el.classList.remove('over'));
    e.target.closest('li')?.classList.add('over');
  });
  list.addEventListener('drop', (e) => {
    if (dragId == null) return;
    e.preventDefault();
    e.stopPropagation();
    const li = e.target.closest('li');
    if (li) move(indexOf(dragId), indexOf(+li.dataset.id));
  });

  /* Orientasi EXIF dari JPEG (1 = normal). JPEG dengan orientasi lain harus digambar ulang. */
  function jpegOrientation(b) {
    if (b[0] !== 0xff || b[1] !== 0xd8) return 1;
    let o = 2;
    while (o + 10 < b.length && b[o] === 0xff) {
      const marker = b[o + 1];
      const len = (b[o + 2] << 8) | b[o + 3];
      if (marker === 0xe1 && b[o + 4] === 0x45 && b[o + 5] === 0x78 && b[o + 6] === 0x69 && b[o + 7] === 0x66) {
        const t = o + 10;
        const le = b[t] === 0x49;
        const r16 = (p) => (le ? b[p] | (b[p + 1] << 8) : (b[p] << 8) | b[p + 1]);
        const r32 = (p) => (le ? (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) : ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3])) >>> 0;
        const ifd = t + r32(t + 4);
        if (ifd + 2 > b.length) return 1;
        for (let i = 0, n = r16(ifd); i < n; i++) {
          const e = ifd + 2 + i * 12;
          if (e + 10 > b.length) break;
          if (r16(e) === 0x0112) return r16(e + 8) || 1;
        }
        return 1;
      }
      if (marker === 0xda) break; // awal data gambar
      o += 2 + len;
    }
    return 1;
  }

  /* Siapkan gambar untuk disisipkan: { kind: 'jpg'|'png', bytes, w, h } */
  async function prepare(it, quality) {
    const bytes = new Uint8Array(await it.file.arrayBuffer());
    const jpg = isJpeg(it.file);
    const png = isPng(it.file);
    const orient = jpg ? jpegOrientation(bytes) : 1;
    if (!quality && !it.rot && orient === 1 && (jpg || png)) {
      return { kind: jpg ? 'jpg' : 'png', bytes, w: it.w, h: it.h, raw: true };
    }
    // Gambar ulang lewat canvas: putar, perkecil, konversi WebP/GIF/BMP, atau kompres.
    const bmp = await createImageBitmap(it.file, { imageOrientation: 'from-image' });
    const ratio = quality ? Math.min(1, quality.max / Math.max(bmp.width, bmp.height)) : 1;
    const sw = Math.max(1, Math.round(bmp.width * ratio));
    const sh = Math.max(1, Math.round(bmp.height * ratio));
    const swap = it.rot % 180 !== 0;
    const canvas = document.createElement('canvas');
    canvas.width = swap ? sh : sw;
    canvas.height = swap ? sw : sh;
    const cx = canvas.getContext('2d');
    const keepAlpha = !quality && !jpg; // mode Asli untuk PNG/WebP: pertahankan transparansi
    if (!keepAlpha) { cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, canvas.width, canvas.height); }
    cx.imageSmoothingQuality = 'high';
    cx.translate(canvas.width / 2, canvas.height / 2);
    cx.rotate((it.rot * Math.PI) / 180);
    cx.drawImage(bmp, -sw / 2, -sh / 2, sw, sh);
    bmp.close();
    const blob = keepAlpha ? await canvasToBlob(canvas, 'image/png') : await canvasToBlob(canvas, 'image/jpeg', quality ? quality.q : 0.92);
    const out = { kind: keepAlpha ? 'png' : 'jpg', bytes: new Uint8Array(await blob.arrayBuffer()), w: canvas.width, h: canvas.height };
    canvas.width = canvas.height = 0;
    return out;
  }

  async function run() {
    if (!items.length) return;
    if (!libsReady(['PDFLib', 'pdfjsLib'])) return;
    clearResult();
    const size = $('#i2p-size').value;
    const orient = $('#i2p-orient').value;
    const margin = +$('#i2p-margin').value;
    const quality = QUALITY[$('#i2p-quality').value];
    const task = startTask('Menyiapkan…');
    try {
      const doc = await PDFLib.PDFDocument.create();
      doc.setTitle(baseName(items[0].file.name));
      doc.setProducer('PDFAman');
      doc.setCreator('PDFAman (diproses di browser)');
      for (let i = 0; i < items.length; i++) {
        task.check();
        task.progress(i / (items.length + 1), `Memasukkan gambar ${i + 1} dari ${items.length}…`);
        await tick();
        const it = items[i];
        let img;
        let p = await prepare(it, quality);
        try {
          img = p.kind === 'jpg' ? await doc.embedJpg(p.bytes) : await doc.embedPng(p.bytes);
        } catch {
          // Format JPG/PNG yang tidak biasa: gambar ulang lewat canvas
          p = await prepare(it, quality || { max: 10000, q: 0.92 });
          img = await doc.embedJpg(p.bytes);
        }
        task.check();

        let pw, ph;
        if (size === 'fit') {
          // 1 piksel = 0,75 pt (96 DPI), dibatasi 200 inci (batas PDF)
          const k = Math.min(0.75, 14000 / Math.max(p.w, p.h));
          pw = p.w * k + margin * 2;
          ph = p.h * k + margin * 2;
        } else {
          [pw, ph] = SIZES[size];
          const land = orient === 'landscape' || (orient === 'auto' && p.w > p.h);
          if (land) [pw, ph] = [ph, pw];
        }
        const aw = pw - margin * 2;
        const ah = ph - margin * 2;
        const s = Math.min(aw / p.w, ah / p.h);
        const dw = p.w * s;
        const dh = p.h * s;
        doc.addPage([pw, ph]).drawImage(img, { x: (pw - dw) / 2, y: (ph - dh) / 2, width: dw, height: dh });
      }
      task.check();
      task.progress(items.length / (items.length + 1), 'Menyimpan PDF…');
      await tick();
      const bytes = await doc.save({ useObjectStreams: true });
      task.check();
      const blob = pdfBlob(bytes);
      const name = `${sanitize(baseName(items[0].file.name))}${items.length > 1 ? `-dan-${items.length - 1}-lainnya` : ''}.pdf`;
      result = { blob, name, pdf: await openPdfJs(await blob.arrayBuffer()) };
      showResult();
      toast('PDF siap! Cek pratinjau sebelum mengunduh.', 'success');
    } catch (e) {
      if (isCancel(e)) toast('Pembuatan PDF dibatalkan.');
      else toast(e.message || 'Gagal membuat PDF.', 'error');
      clearResult();
    } finally {
      task.end();
    }
  }

  async function showResult() {
    const total = items.reduce((s, it) => s + it.file.size, 0);
    $('#i2p-before').textContent = formatBytes(total);
    $('#i2p-after').textContent = formatBytes(result.blob.size);
    $('#i2p-pages').textContent = String(result.pdf.numPages);
    resultBox.hidden = false;
    resultBox.scrollIntoView({ behavior: 'smooth', block: 'start' });

    const grid = $('#i2p-preview');
    const token = ++previewToken;
    const n = result.pdf.numPages;
    const MAX = 60;
    $('#i2p-preview-note').textContent = n > MAX ? `Menampilkan ${MAX} dari ${n} halaman` : '';
    for (let p = 1; p <= Math.min(n, MAX); p++) {
      if (token !== previewToken) return;
      try {
        const c = await renderPage(result.pdf, p, { width: 260 });
        if (token !== previewToken) return;
        const fig = document.createElement('figure');
        const cap = document.createElement('figcaption');
        cap.textContent = `Hal. ${p}`;
        fig.append(c, cap);
        grid.appendChild(fig);
      } catch { /* lewati halaman yang gagal dipratinjau */ }
    }
  }
})();
