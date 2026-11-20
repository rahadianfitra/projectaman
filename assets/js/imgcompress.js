/* Kompres Gambar — 100% di browser (canvas). Tidak ada file yang dikirim ke mana pun. */
'use strict';
(() => {
  const { $, $$, clamp, setupDropzone, toast, downloadBlob, baseName, sanitize, libsReady, startTask, isCancel,
    tick, canvasToBlob, formatBytes, savingText, bindCompare, loading } = App;

  const drop = $('#cimg-drop');
  const input = $('#cimg-input');
  const panel = $('#cimg-panel');
  const list = $('#cimg-list');
  const level = $('#cimg-level');
  const fmtSel = $('#cimg-format');
  const maxSel = $('#cimg-max');
  const modal = $('#cimg-modal');
  const cmp = bindCompare($('#cimg-cmp'));
  const items = [];
  let uid = 0;
  let modalItem = null;

  const isImage = (f) => /^image\/(jpeg|png|webp|bmp|gif)$/.test(f.type) || /\.(jpe?g|png|webp|bmp|gif)$/i.test(f.name);
  const EXT = { 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/png': 'png' };
  const NAME = { 'image/jpeg': 'JPG', 'image/webp': 'WebP', 'image/png': 'PNG' };

  // Safari lama tidak bisa menyimpan WebP dari canvas → pakai JPG.
  const webpOk = (() => {
    try { const c = document.createElement('canvas'); c.width = c.height = 1; return c.toDataURL('image/webp').startsWith('data:image/webp'); }
    catch { return false; }
  })();

  setupDropzone(drop, input, addFiles, isImage);
  $('#cimg-add').addEventListener('click', () => input.click());
  $('#cimg-clear').addEventListener('click', () => { items.splice(0).forEach(freeItem); render(); });
  $('#cimg-run').addEventListener('click', run);
  $('#cimg-zip').addEventListener('click', zipAll);
  level.addEventListener('input', settingsChanged);
  fmtSel.addEventListener('change', settingsChanged);
  maxSel.addEventListener('change', settingsChanged);
  $$('#view-imgcompress .chip').forEach((b) => b.addEventListener('click', () => { level.value = b.dataset.level; settingsChanged(); }));
  $('#cimg-modal-close').addEventListener('click', () => modal.close());
  $('#cimg-modal-cancel').addEventListener('click', () => modal.close());
  $('#cimg-modal-dl').addEventListener('click', () => { if (modalItem) downloadItem(modalItem); });
  modal.addEventListener('close', () => { cmp.clear(); modalItem = null; });

  list.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const i = items.findIndex((it) => it.id === +btn.closest('li').dataset.id);
    const it = items[i];
    if (btn.dataset.act === 'del') { freeItem(it); items.splice(i, 1); render(); }
    if (btn.dataset.act === 'preview') openPreview(it);
    if (btn.dataset.act === 'dl') downloadItem(it);
  });

  const quality = () => clamp(1 - +level.value / 100, 0.05, 0.95);

  function targetMime(file) {
    const v = fmtSel.value;
    if (v === 'image/webp' && !webpOk) return 'image/jpeg';
    if (v !== 'auto') return v;
    if (file.type === 'image/jpeg' || /\.jpe?g$/i.test(file.name)) return 'image/jpeg';
    return webpOk ? 'image/webp' : 'image/jpeg';
  }

  function settingsChanged() {
    const lv = +level.value;
    $('#cimg-level-val').textContent = lv;
    $$('#view-imgcompress .chip').forEach((b) => b.classList.toggle('active', +b.dataset.level === lv));
    const png = fmtSel.value === 'image/png';
    $('#cimg-hint').textContent = png
      ? 'PNG tidak punya pengaturan kualitas; ukuran hanya turun bila gambar diperkecil (pilih ukuran maksimum).'
      : `Kualitas ${Math.round(quality() * 100)}%.${!webpOk ? ' Browser ini tidak mendukung WebP, hasil disimpan sebagai JPG.' : ''} Gambar transparan yang disimpan sebagai JPG akan berlatar putih.`;
    // Hasil lama tidak lagi sesuai pengaturan
    let changed = false;
    items.forEach((it) => { if (it.out) { URL.revokeObjectURL(it.out.url); it.out = null; changed = true; } });
    if (changed) render();
  }
  settingsChanged();

  function freeItem(it) {
    URL.revokeObjectURL(it.url);
    if (it.out) URL.revokeObjectURL(it.out.url);
  }

  async function addFiles(files) {
    loading(true, 'Membaca gambar…');
    for (const file of files) {
      try {
        const bmp = await decode(file);
        items.push({ id: ++uid, file, url: URL.createObjectURL(file), w: bmp.width, h: bmp.height, out: null, err: '' });
        bmp.close?.();
      } catch {
        toast(`${file.name}: gambar tidak bisa dibaca.`, 'error');
      }
    }
    loading(false);
    render();
  }

  async function decode(file) {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* fallback */ }
    }
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function render() {
    panel.hidden = !items.length;
    drop.classList.toggle('compact', items.length > 0);
    const done = items.filter((it) => it.out);
    const totalIn = items.reduce((s, it) => s + it.file.size, 0);
    $('#cimg-summary').textContent = `${items.length} gambar · ${formatBytes(totalIn)}`;
    if (done.length) {
      const a = done.reduce((s, it) => s + it.file.size, 0);
      const b = done.reduce((s, it) => s + it.out.blob.size, 0);
      $('#cimg-total').textContent = `Total: ${savingText(a, b)}`;
    } else {
      $('#cimg-total').textContent = '';
    }
    $('#cimg-zip').hidden = done.length < 1;
    $('#cimg-zip').textContent = done.length > 1 ? '⬇ Unduh semua (ZIP)' : '⬇ Unduh';

    list.innerHTML = '';
    for (const it of items) {
      const li = document.createElement('li');
      li.className = 'file-item';
      li.dataset.id = it.id;
      let status = `<small>${it.w}×${it.h}px · ${formatBytes(it.file.size)}</small>`;
      if (it.out) {
        const pct = App.savedPct(it.file.size, it.out.blob.size);
        status = `<small>${it.out.w}×${it.out.h}px · ${savingText(it.file.size, it.out.blob.size)} · ${NAME[it.out.mime] || ''}</small>
          ${it.out.kept ? '<span class="tag">Sudah optimal, file asli dipakai</span>' : `<span class="tag ok">Hemat ${pct}%</span>`}`;
      } else if (it.err) {
        status += `<span class="tag bad"></span>`;
      }
      li.innerHTML = `
        <div class="thumb img"><img src="${it.out ? it.out.url : it.url}" alt=""></div>
        <div class="meta"><strong></strong>${status}</div>
        <div class="row-actions">
          ${it.out ? `<button class="btn ghost sm" data-act="preview" type="button">👁 Pratinjau</button>
          <button class="btn ghost sm" data-act="dl" type="button">⬇</button>` : ''}
          <button class="icon-btn danger" data-act="del" title="Hapus" type="button">✕</button>
        </div>`;
      li.querySelector('strong').textContent = it.file.name; // aman dari XSS
      const bad = li.querySelector('.tag.bad');
      if (bad) bad.textContent = it.err;
      list.appendChild(li);
    }
  }

  async function compressOne(it, task, frac0, frac1) {
    const mime = targetMime(it.file);
    const max = +maxSel.value;
    const bmp = await decode(it.file);
    const ratio = max ? Math.min(1, max / Math.max(bmp.width, bmp.height)) : 1;
    const w = Math.max(1, Math.round(bmp.width * ratio));
    const h = Math.max(1, Math.round(bmp.height * ratio));
    task.progress(frac0 + (frac1 - frac0) * 0.3);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (mime === 'image/jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    task.check();
    let blob = await canvasToBlob(canvas, mime, quality());
    canvas.width = canvas.height = 0;
    if (!blob) throw new Error('gagal diproses (gambar terlalu besar?)');

    // Kalau hasil malah lebih besar & ukuran tidak diubah, pakai file asli.
    let kept = false;
    const sameType = it.file.type === mime;
    if (blob.size >= it.file.size && ratio === 1 && sameType) { blob = it.file; kept = true; }
    const name = `${sanitize(baseName(it.file.name))}-compressed.${EXT[mime]}`;
    return { blob, url: URL.createObjectURL(blob), w, h, mime, kept, name };
  }

  async function run() {
    if (!items.length) return;
    const task = startTask('Menyiapkan…');
    let ok = 0;
    try {
      for (let k = 0; k < items.length; k++) {
        const it = items[k];
        task.check();
        task.progress(k / items.length, `Mengompres gambar ${k + 1} dari ${items.length}…`);
        await tick();
        if (it.out) { URL.revokeObjectURL(it.out.url); it.out = null; }
        it.err = '';
        try {
          it.out = await compressOne(it, task, k / items.length, (k + 1) / items.length);
          ok++;
        } catch (e) {
          if (isCancel(e)) throw e;
          it.err = e.message || 'gagal diproses';
        }
      }
      task.progress(1);
      toast(`Selesai! ${ok} gambar dikompres. Cek pratinjau sebelum mengunduh.`, 'success');
    } catch (e) {
      if (isCancel(e)) toast(`Dibatalkan. ${ok} gambar sempat diproses.`);
      else toast(e.message || 'Gagal mengompres gambar.', 'error');
    } finally {
      task.end();
      render();
    }
  }

  function openPreview(it) {
    if (!it.out) return;
    modalItem = it;
    const a = new Image(); a.src = it.url; a.alt = 'Asli';
    const b = new Image(); b.src = it.out.url; b.alt = 'Hasil';
    cmp.set(a, b);
    $('#cimg-modal-title').textContent = it.file.name;
    $('#cimg-modal-info').textContent = `${savingText(it.file.size, it.out.blob.size)} · ${it.out.w}×${it.out.h}px`;
    modal.showModal();
    // Lebar menyesuaikan rasio gambar agar muat di layar
    const box = $('#cimg-cmp');
    const avail = box.parentElement.clientWidth || 800;
    box.style.width = Math.round(Math.min(avail, window.innerHeight * 0.62 * (it.out.w / it.out.h))) + 'px';
  }

  function downloadItem(it) {
    if (it.out) downloadBlob(it.out.blob, it.out.name);
  }

  async function zipAll() {
    const done = items.filter((it) => it.out);
    if (!done.length) return;
    if (done.length === 1) return downloadItem(done[0]);
    if (!libsReady(['JSZip'])) return;
    loading(true, 'Membuat file ZIP…');
    try {
      const zip = new JSZip();
      const used = new Set();
      done.forEach((it) => {
        let n = it.out.name;
        for (let i = 2; used.has(n); i++) n = it.out.name.replace(/(\.\w+)$/, `-${i}$1`);
        used.add(n);
        zip.file(n, it.out.blob);
      });
      downloadBlob(await zip.generateAsync({ type: 'blob' }), 'gambar-compressed.zip');
    } catch {
      toast('Gagal membuat ZIP.', 'error');
    } finally {
      loading(false);
    }
  }
})();
