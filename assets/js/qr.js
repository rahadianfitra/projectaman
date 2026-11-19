/* Pembuat QR Code (dengan / tanpa logo) */
'use strict';
(() => {
  const { $, $$, toast, sanitize } = App;
  if (!window.QRCodeStyling) {
    document.addEventListener('view:qr', () => toast('Library QR gagal dimuat. Periksa koneksi lalu muat ulang.', 'error'));
    return;
  }

  const el = {
    data: $('#qr-data'), hint: $('#qr-data-hint'), dot: $('#qr-dot'), corner: $('#qr-corner'),
    fg: $('#qr-fg'), cornerColor: $('#qr-corner-color'), bg: $('#qr-bg'), transparent: $('#qr-transparent'),
    size: $('#qr-size'), margin: $('#qr-margin'), logoOn: $('#qr-logo-on'), logoFields: $('#qr-logo-fields'),
    logo: $('#qr-logo'), logoSize: $('#qr-logo-size'), preview: $('#qr-preview'), warn: $('#qr-warn'),
    name: $('#qr-name'),
  };
  const QUIET_RATIO = 0.08;
  const MAX_LOGO = 30;
  let logoData = null;
  let qr = null;
  let timer = null;

  function normalizedData() {
    const raw = el.data.value.trim();
    if (!raw || raw === 'https://' || raw === 'http://') return { text: '', note: 'Masukkan link atau teks.' };
    if (/^[\w-]+(\.[\w-]+)+([/?#].*)?$/i.test(raw) && !/^[a-z]+:/i.test(raw)) {
      return { text: 'https://' + raw, note: 'https:// ditambahkan otomatis.' };
    }
    return { text: raw, note: '' };
  }

  function options(previewOnly) {
    const { text } = normalizedData();
    const useLogo = el.logoOn.checked && !!logoData;
    const size = previewOnly ? 300 : +el.size.value;
    // Quiet zone: standar QR butuh area kosong ± 4 modul di sekeliling kode.
    // Tanpa itu banyak kamera HP gagal mengenali QR. Paksa minimal 8% dari ukuran.
    const margin = Math.max(
      Math.round((+el.margin.value) * (size / +el.size.value)),
      Math.round(size * QUIET_RATIO),
    );
    const cornerDot = el.corner.value === 'square' ? 'square' : 'dot';
    return {
      width: size,
      height: size,
      type: 'canvas',
      data: text || 'https://example.com',
      margin,
      image: useLogo ? logoData : '',
      qrOptions: { errorCorrectionLevel: useLogo ? 'H' : 'Q' },
      dotsOptions: { color: el.fg.value, type: el.dot.value },
      cornersSquareOptions: { color: el.cornerColor.value, type: el.corner.value },
      cornersDotOptions: { color: el.cornerColor.value, type: cornerDot },
      backgroundOptions: { color: el.transparent.checked ? 'rgba(0,0,0,0)' : el.bg.value },
      imageOptions: { crossOrigin: 'anonymous', margin: 4, imageSize: Math.min(+el.logoSize.value, MAX_LOGO) / 100, hideBackgroundDots: true },
    };
  }

  function render() {
    const { note } = normalizedData();
    el.hint.textContent = note;
    el.preview.innerHTML = '';
    qr = new QRCodeStyling(options(true));
    qr.append(el.preview);
    checkWarnings();
  }
  const schedule = () => { clearTimeout(timer); timer = setTimeout(render, 150); };

  // Masalah yang membuat QR gagal di-scan (bukan sekadar saran).
  function problems() {
    const out = [];
    const fgL = lum(el.fg.value), cornerL = lum(el.cornerColor.value), bgL = lum(el.bg.value);
    if (el.transparent.checked) {
      // Latar transparan biasanya ditempel di atas putih: titik QR wajib gelap.
      if (fgL > 0.4 || cornerL > 0.4) out.push('Latar transparan butuh warna QR & sudut yang gelap.');
    } else {
      if (fgL > bgL || cornerL > bgL) out.push('Warna terbalik: QR terang di latar gelap tidak bisa dibaca banyak kamera HP.');
      else if (contrast(el.fg.value, el.bg.value) < 4 || contrast(el.cornerColor.value, el.bg.value) < 4) out.push('Kontras warna QR dan latar terlalu rendah.');
    }
    return out;
  }

  function fixColors() {
    const darkest = (a, b) => (lum(a) <= lum(b) ? a : b);
    let fg = el.fg.value, bg = el.bg.value;
    if (lum(fg) > lum(bg)) [fg, bg] = [bg, fg];           // tukar warna terbalik
    if (el.transparent.checked || contrast(fg, bg) < 4) { fg = darkest(fg, '#111111'); bg = '#ffffff'; }
    el.fg.value = fg;
    el.bg.value = bg;
    if (lum(el.cornerColor.value) > lum(bg) || contrast(el.cornerColor.value, bg) < 4) el.cornerColor.value = fg;
    render();
    toast('Warna QR diperbaiki: titik gelap di latar terang.');
  }

  function checkWarnings() {
    const errs = problems();
    const tips = [];
    if (el.logoOn.checked && logoData && +el.logoSize.value > MAX_LOGO) tips.push(`Ukuran logo dibatasi ${MAX_LOGO}% agar QR tetap terbaca.`);
    el.warn.replaceChildren();
    el.warn.hidden = !errs.length && !tips.length;
    if (errs.length) {
      el.warn.append(errs.join(' ') + ' ');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn ghost sm';
      b.textContent = 'Perbaiki otomatis';
      b.addEventListener('click', fixColors);
      el.warn.append(b);
    }
    if (tips.length) el.warn.append(' ' + tips.join(' '));
  }
  function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function lum(h) {
    return hexToRgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
      .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  }
  function contrast(a, b) { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); }

  // events
  [el.data, el.fg, el.cornerColor, el.bg].forEach((i) => i.addEventListener('input', schedule));
  [el.dot, el.corner, el.transparent].forEach((i) => i.addEventListener('change', schedule));
  el.size.addEventListener('input', () => { $('#qr-size-val').textContent = el.size.value; });
  el.margin.addEventListener('input', () => { $('#qr-margin-val').textContent = el.margin.value; schedule(); });
  el.logoSize.addEventListener('input', () => { $('#qr-logo-size-val').textContent = el.logoSize.value; schedule(); });
  el.logoOn.addEventListener('change', () => { el.logoFields.hidden = !el.logoOn.checked; schedule(); });
  el.logo.addEventListener('change', () => {
    const f = el.logo.files[0];
    if (!f) return;
    if (!/^image\//.test(f.type)) return toast('Logo harus berupa gambar.', 'error');
    if (f.size > 5 * 1048576) return toast('Ukuran logo maksimal 5 MB.', 'error');
    const r = new FileReader();
    r.onload = () => { logoData = r.result; schedule(); };
    r.readAsDataURL(f);
  });

  $$('[data-ext]', $('#view-qr')).forEach((b) => b.addEventListener('click', async () => {
    const { text } = normalizedData();
    if (!text) return toast('Masukkan link atau teks dulu.', 'error');
    const errs = problems();
    if (errs.length) return toast(errs[0] + ' Klik "Perbaiki otomatis" dulu.', 'error');
    if (el.logoOn.checked && !logoData) toast('Logo belum dipilih — QR diunduh tanpa logo.');
    const ext = b.dataset.ext;
    const opts = options(false);
    if (ext === 'jpeg' && el.transparent.checked) opts.backgroundOptions.color = el.bg.value;
    try {
      const out = new QRCodeStyling(opts);
      await out.download({ name: sanitize(el.name.value || 'qrcode'), extension: ext });
    } catch {
      toast('Gagal mengunduh QR.', 'error');
    }
  }));

  render();
})();
