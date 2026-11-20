/* Pisah PDF */
'use strict';
(() => {
  const { $, $$, setupDropzone, isPdf, toast, loading, loadPdfLib, downloadBlob, pdfBlob, openPdfJs,
    renderPage, parseRanges, rangesToIndices, compressPages, baseName, sanitize, libsReady } = App;

  const drop = $('#split-drop');
  const input = $('#split-input');
  const panel = $('#split-panel');
  const grid = $('#split-grid');
  const rangeInput = $('#split-range');
  const st = { file: null, buf: null, pdf: null, count: 0, selected: new Set() };
  let observer = null;
  let renderChain = Promise.resolve();
  let token = 0;

  setupDropzone(drop, input, (files) => load(files[0]), isPdf);
  $('#split-reset').addEventListener('click', () => { reset(); input.click(); });
  $('#split-run').addEventListener('click', run);
  $('#split-all').addEventListener('click', () => setSelection(Array.from({ length: st.count }, (_, i) => i + 1)));
  $('#split-none').addEventListener('click', () => setSelection([]));
  $$('input[name="split-mode"]').forEach((r) => r.addEventListener('change', updateMode));

  rangeInput.addEventListener('input', () => {
    if (mode() !== 'select') return;
    try {
      const idx = rangesToIndices(parseRanges(rangeInput.value, st.count));
      highlight(new Set(idx.map((i) => i + 1)));
    } catch { /* abaikan saat masih mengetik */ }
  });

  grid.addEventListener('click', (e) => {
    const el = e.target.closest('.page-thumb');
    if (!el) return;
    const p = +el.dataset.page;
    const sel = new Set(st.selected);
    sel.has(p) ? sel.delete(p) : sel.add(p);
    if (mode() !== 'select') {
      $('input[name="split-mode"][value="select"]').checked = true;
      updateMode();
    }
    setSelection([...sel]);
  });

  const mode = () => $('input[name="split-mode"]:checked').value;

  function updateMode() {
    const m = mode();
    $('#split-fixed-field').hidden = m !== 'fixed';
    $('#split-range-field').hidden = !(m === 'ranges' || m === 'select');
    $('#split-range-label').textContent = m === 'ranges' ? 'Rentang (tiap rentang jadi 1 file)' : 'Halaman yang diambil';
    if (m === 'select') rangeInput.value = compressPages([...st.selected]);
  }

  function setSelection(pages) {
    st.selected = new Set(pages);
    highlight(st.selected);
    if (mode() === 'select') rangeInput.value = compressPages(pages);
  }
  function highlight(set) {
    st.selected = set;
    grid.querySelectorAll('.page-thumb').forEach((el) => el.classList.toggle('selected', set.has(+el.dataset.page)));
  }

  function reset() {
    token++;
    observer?.disconnect();
    st.pdf?.destroy();
    Object.assign(st, { file: null, buf: null, pdf: null, count: 0, selected: new Set() });
    grid.innerHTML = '';
    rangeInput.value = '';
    panel.hidden = true;
    drop.hidden = false;
  }

  async function load(file) {
    if (!libsReady(['PDFLib', 'pdfjsLib', 'JSZip'])) return;
    reset();
    loading(true, 'Membuka PDF…');
    try {
      st.buf = await file.arrayBuffer();
      await loadPdfLib(st.buf); // validasi (terenkripsi/rusak)
      st.pdf = await openPdfJs(st.buf);
      st.file = file;
      st.count = st.pdf.numPages;
      $('#split-info').textContent = `${file.name} · ${st.count} halaman`;
      panel.hidden = false;
      drop.hidden = true;
      updateMode();
      buildGrid();
    } catch (e) {
      reset();
      toast(e.message || 'Gagal membuka PDF.', 'error');
    } finally {
      loading(false);
    }
  }

  function buildGrid() {
    const t = token;
    observer = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        observer.unobserve(en.target);
        const el = en.target;
        renderChain = renderChain.then(async () => {
          if (t !== token || !st.pdf) return;
          try {
            const c = await renderPage(st.pdf, +el.dataset.page, { width: 220 });
            el.querySelector('.pt-canvas').replaceChildren(c);
          } catch { /* lewati */ }
        });
      });
    }, { root: grid, rootMargin: '300px' });

    const frag = document.createDocumentFragment();
    for (let i = 1; i <= st.count; i++) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'page-thumb';
      el.dataset.page = i;
      el.innerHTML = `<div class="pt-canvas"><span class="pt-loading"></span></div><span class="pt-num">Hal. ${i}</span><span class="pt-check">✓</span>`;
      frag.appendChild(el);
    }
    grid.appendChild(frag);
    grid.querySelectorAll('.page-thumb').forEach((el) => observer.observe(el));
  }

  async function run() {
    if (!st.buf) return;
    const base = sanitize(baseName(st.file.name));
    const n = st.count;
    let groups = [];
    try {
      const m = mode();
      if (m === 'every') {
        for (let i = 0; i < n; i++) groups.push({ idx: [i], name: `${base}-hal-${i + 1}.pdf` });
      } else if (m === 'fixed') {
        const size = parseInt($('#split-fixed').value, 10);
        if (!(size >= 1)) throw new Error('Jumlah halaman per file minimal 1.');
        for (let s = 0; s < n; s += size) {
          const e = Math.min(s + size, n);
          const idx = Array.from({ length: e - s }, (_, k) => s + k);
          groups.push({ idx, name: `${base}-hal-${s + 1 === e ? e : `${s + 1}-${e}`}.pdf` });
        }
      } else if (m === 'ranges') {
        groups = parseRanges(rangeInput.value, n).map(([a, b]) => ({
          idx: rangesToIndices([[a, b]]),
          name: `${base}-hal-${a === b ? a : `${a}-${b}`}.pdf`,
        }));
      } else {
        const idx = [...new Set(rangesToIndices(parseRanges(rangeInput.value, n)))];
        groups = [{ idx, name: `${base}-terpilih.pdf` }];
      }
    } catch (e) {
      return toast(e.message, 'error');
    }

    const task = App.startTask('Memisahkan PDF…');
    try {
      const src = await loadPdfLib(st.buf);
      const outputs = [];
      for (let k = 0; k < groups.length; k++) {
        task.check();
        task.progress(k / (groups.length + 1), `Membuat file ${k + 1}/${groups.length}…`);
        await App.tick();
        const out = await PDFLib.PDFDocument.create();
        const pages = await out.copyPages(src, groups[k].idx);
        pages.forEach((p) => out.addPage(p));
        outputs.push({ name: groups[k].name, bytes: await out.save() });
      }
      task.check();
      if (outputs.length === 1) {
        downloadBlob(pdfBlob(outputs[0].bytes), outputs[0].name);
      } else {
        task.progress(groups.length / (groups.length + 1), 'Membuat file ZIP…');
        const zip = new JSZip();
        outputs.forEach((o) => zip.file(o.name, o.bytes));
        const blob = await zip.generateAsync({ type: 'blob' });
        task.check();
        downloadBlob(blob, `${base}-split.zip`);
      }
      const total = outputs.reduce((s, o) => s + o.bytes.length, 0);
      toast(`Berhasil! ${outputs.length} file dibuat (${App.formatBytes(st.file.size)} → total ${App.formatBytes(total)}).`, 'success');
    } catch (e) {
      if (App.isCancel(e)) toast('Pemisahan dibatalkan.');
      else toast(e.message || 'Gagal memisahkan PDF.', 'error');
    } finally {
      task.end();
    }
  }
})();
