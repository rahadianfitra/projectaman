/* PDF ke JPG / PNG */
'use strict';
(() => {
  const { $, setupDropzone, isPdf, toast, loading, downloadBlob, openPdfJs, renderPage, parseRanges,
    rangesToIndices, baseName, sanitize, libsReady } = App;

  const drop = $('#img-drop');
  const input = $('#img-input');
  const panel = $('#img-panel');
  const fmtSel = $('#img-format');
  const quality = $('#img-quality');
  const resultsWrap = $('#img-results-wrap');
  const resultsEl = $('#img-results');
  const st = { file: null, pdf: null, results: [] };

  setupDropzone(drop, input, (f) => load(f[0]), isPdf);
  $('#img-reset').addEventListener('click', () => { reset(); input.click(); });
  $('#img-run').addEventListener('click', run);
  $('#img-zip').addEventListener('click', zipAll);
  fmtSel.addEventListener('change', () => { $('#img-quality-field').hidden = fmtSel.value !== 'jpg'; });
  quality.addEventListener('input', () => { $('#img-quality-val').textContent = quality.value; });

  resultsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-i]');
    if (btn) { const r = st.results[+btn.dataset.i]; downloadBlob(r.blob, r.name); }
  });

  function clearResults() {
    st.results.forEach((r) => URL.revokeObjectURL(r.url));
    st.results = [];
    resultsEl.innerHTML = '';
    resultsWrap.hidden = true;
  }

  function reset() {
    clearResults();
    st.pdf?.destroy();
    st.pdf = null;
    st.file = null;
    panel.hidden = true;
    drop.hidden = false;
  }

  async function load(file) {
    if (!libsReady(['pdfjsLib', 'JSZip'])) return;
    reset();
    loading(true, 'Membuka PDF…');
    try {
      st.pdf = await openPdfJs(await file.arrayBuffer());
      st.file = file;
      $('#img-info').textContent = `${file.name} · ${st.pdf.numPages} halaman`;
      $('#img-pages').value = '';
      panel.hidden = false;
      drop.hidden = true;
    } catch (e) {
      reset();
      toast(e.message, 'error');
    } finally {
      loading(false);
    }
  }

  async function run() {
    if (!st.pdf) return;
    const n = st.pdf.numPages;
    const isJpg = fmtSel.value === 'jpg';
    const mime = isJpg ? 'image/jpeg' : 'image/png';
    const ext = isJpg ? 'jpg' : 'png';
    const scale = +$('#img-scale').value;
    const q = +quality.value / 100;
    let pages;
    try {
      const v = $('#img-pages').value.trim();
      pages = v ? [...new Set(rangesToIndices(parseRanges(v, n)))].map((i) => i + 1)
        : Array.from({ length: n }, (_, i) => i + 1);
    } catch (e) {
      return toast(e.message, 'error');
    }

    clearResults();
    const base = sanitize(baseName(st.file.name));
    const task = App.startTask('Mengonversi…');
    try {
      for (let k = 0; k < pages.length; k++) {
        const p = pages[k];
        task.check();
        task.progress(k / pages.length, `Mengonversi halaman ${p} (${k + 1}/${pages.length})…`);
        await App.tick();
        const canvas = await renderPage(st.pdf, p, { scale });
        const blob = await new Promise((res) => canvas.toBlob(res, mime, q));
        const { width, height } = canvas;
        canvas.width = canvas.height = 0; // bebaskan memori
        if (!blob) throw new Error(`Halaman ${p} terlalu besar. Coba resolusi lebih rendah.`);
        const r = { name: `${base}-hal-${p}.${ext}`, blob, url: URL.createObjectURL(blob), width, height, page: p };
        st.results.push(r);
        appendCard(r, st.results.length - 1);
      }
      resultsWrap.hidden = false;
      const total = st.results.reduce((s, r) => s + r.blob.size, 0);
      $('#img-results-info').textContent = `${st.results.length} gambar ${ext.toUpperCase()} siap diunduh · PDF ${App.formatBytes(st.file.size)} → total ${App.formatBytes(total)}`;
      toast('Konversi selesai! Cek pratinjau di bawah sebelum mengunduh.', 'success');
    } catch (e) {
      if (App.isCancel(e)) toast(`Dibatalkan. ${st.results.length} halaman sempat dikonversi.`);
      else toast(e.message || 'Gagal mengonversi.', 'error');
      if (st.results.length) {
        resultsWrap.hidden = false;
        $('#img-results-info').textContent = `${st.results.length} gambar ${ext.toUpperCase()} siap diunduh`;
      }
    } finally {
      task.end();
    }
  }

  function appendCard(r, i) {
    const card = document.createElement('div');
    card.className = 'result-card';
    card.innerHTML = `
      <div class="img-wrap"><img src="${r.url}" alt="Halaman ${r.page}" loading="lazy"></div>
      <small>Hal. ${r.page} · ${r.width}×${r.height}px · ${App.formatBytes(r.blob.size)}</small>
      <button class="btn ghost sm" type="button" data-i="${i}">⬇ Unduh</button>`;
    resultsEl.appendChild(card);
  }

  async function zipAll() {
    if (!st.results.length) return;
    if (st.results.length === 1) return downloadBlob(st.results[0].blob, st.results[0].name);
    loading(true, 'Membuat file ZIP…');
    try {
      const zip = new JSZip();
      st.results.forEach((r) => zip.file(r.name, r.blob));
      downloadBlob(await zip.generateAsync({ type: 'blob' }), `${sanitize(baseName(st.file.name))}-gambar.zip`);
    } catch {
      toast('Gagal membuat ZIP.', 'error');
    } finally {
      loading(false);
    }
  }
})();
