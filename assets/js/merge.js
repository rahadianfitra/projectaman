/* Gabung PDF */
'use strict';
(() => {
  const { $, setupDropzone, isPdf, formatBytes, toast, loading, loadPdfLib, downloadBlob, pdfBlob,
    openPdfJs, renderPage, libsReady } = App;

  const drop = $('#merge-drop');
  const input = $('#merge-input');
  const panel = $('#merge-panel');
  const list = $('#merge-list');
  const items = [];
  let uid = 0;
  let dragId = null;

  setupDropzone(drop, input, addFiles, isPdf);
  $('#merge-add').addEventListener('click', () => input.click());
  $('#merge-clear').addEventListener('click', () => { items.length = 0; render(); });
  $('#merge-run').addEventListener('click', run);

  async function addFiles(files) {
    if (!libsReady(['PDFLib', 'pdfjsLib'])) return;
    loading(true, 'Membaca file…');
    for (const file of files) {
      try {
        const buf = await file.arrayBuffer();
        const doc = await loadPdfLib(buf);
        const item = { id: ++uid, file, buf, pages: doc.getPageCount(), thumb: null };
        items.push(item);
        makeThumb(item);
      } catch (e) {
        toast(`${file.name}: ${e.message}`, 'error');
      }
    }
    loading(false);
    render();
  }

  async function makeThumb(item) {
    try {
      const pdf = await openPdfJs(item.buf);
      const c = await renderPage(pdf, 1, { width: 100 });
      item.thumb = c.toDataURL('image/jpeg', 0.7);
      pdf.destroy();
      render();
    } catch { /* thumbnail opsional */ }
  }

  function render() {
    panel.hidden = !items.length;
    drop.classList.toggle('compact', items.length > 0);
    const totalPages = items.reduce((s, it) => s + it.pages, 0);
    $('#merge-summary').textContent = `${items.length} file · ${totalPages} halaman`;
    list.innerHTML = '';
    items.forEach((it, i) => {
      const li = document.createElement('li');
      li.className = 'file-item';
      li.draggable = true;
      li.dataset.id = it.id;
      li.innerHTML = `
        <span class="grip" aria-hidden="true">⋮⋮</span>
        <div class="thumb">${it.thumb ? `<img src="${it.thumb}" alt="">` : '<div class="thumb-ph">PDF</div>'}</div>
        <div class="meta"><strong></strong><small>${it.pages} halaman · ${formatBytes(it.file.size)}</small></div>
        <div class="row-actions">
          <button class="icon-btn" data-act="up" title="Naikkan" type="button" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="icon-btn" data-act="down" title="Turunkan" type="button" ${i === items.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="icon-btn danger" data-act="del" title="Hapus" type="button">✕</button>
        </div>`;
      li.querySelector('strong').textContent = it.file.name; // textContent = aman dari XSS
      list.appendChild(li);
    });
  }

  const indexOf = (id) => items.findIndex((it) => it.id === id);
  function move(from, to) {
    if (to < 0 || to >= items.length || from === to) return;
    const [it] = items.splice(from, 1);
    items.splice(to, 0, it);
    render();
  }

  list.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const i = indexOf(+btn.closest('li').dataset.id);
    if (btn.dataset.act === 'up') move(i, i - 1);
    if (btn.dataset.act === 'down') move(i, i + 1);
    if (btn.dataset.act === 'del') { items.splice(i, 1); render(); }
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

  async function run() {
    if (items.length < 2) return toast('Pilih minimal 2 file PDF untuk digabung.', 'error');
    const task = App.startTask('Menggabungkan PDF…');
    try {
      const out = await PDFLib.PDFDocument.create();
      for (let k = 0; k < items.length; k++) {
        task.check();
        task.progress(k / (items.length + 1), `Menggabungkan file ${k + 1}/${items.length}…`);
        await App.tick();
        const src = await loadPdfLib(items[k].buf);
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach((p) => out.addPage(p));
      }
      task.check();
      task.progress(items.length / (items.length + 1), 'Menyimpan PDF…');
      await App.tick();
      const bytes = await out.save();
      task.check();
      const before = items.reduce((s, it) => s + it.file.size, 0);
      downloadBlob(pdfBlob(bytes), 'gabungan.pdf');
      toast(`Berhasil! ${App.savingText(before, bytes.length)}. File sedang diunduh.`, 'success');
    } catch (e) {
      if (App.isCancel(e)) toast('Penggabungan dibatalkan.');
      else toast(e.message || 'Gagal menggabungkan PDF.', 'error');
    } finally {
      task.end();
    }
  }
})();
