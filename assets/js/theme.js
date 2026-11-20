/* Tema terang/gelap. Dimuat di <head> (sinkron) agar tidak ada kedipan warna saat halaman dibuka.
 * Default mengikuti sistem. Saklar geser menyimpan pilihan di localStorage perangkat ini: 'light' | 'dark'. */
'use strict';
(() => {
  const KEY = 'pdfaman_theme';
  const root = document.documentElement;
  const mq = window.matchMedia('(prefers-color-scheme: dark)');

  const saved = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
  const save = (v) => { try { localStorage.setItem(KEY, v); } catch { /* mode privat: abaikan */ } };
  const current = () => saved() || (mq.matches ? 'dark' : 'light');

  function apply() {
    const s = saved();
    if (s) root.dataset.theme = s; else delete root.dataset.theme;
    const dark = current() === 'dark';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = dark ? '#0b1020' : '#4338ca';
    const sw = document.getElementById('theme-toggle');
    if (sw) {
      sw.checked = dark;
      sw.setAttribute('aria-checked', String(dark));
    }
  }

  apply();
  mq.addEventListener?.('change', apply); // ikut berubah bila sistem berganti & pengguna belum memilih
  document.addEventListener('DOMContentLoaded', () => {
    apply();
    document.getElementById('theme-toggle')?.addEventListener('change', (e) => {
      save(e.target.checked ? 'dark' : 'light');
      apply();
    });
  });
})();
