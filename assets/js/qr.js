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
    const margin = Math.round((+el.margin.value) * (size / +el.size.value));
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
      imageOptions: { crossOrigin: 'anonymous', margin: 6, imageSize: (+el.logoSize.value) / 100, hideBackgroundDots: true },
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

  function checkWarnings() {
    const msgs = [];
    if (!el.transparent.checked && contrast(el.fg.value, el.bg.value) < 3) msgs.push('Kontras warna QR dan latar terlalu rendah — bisa sulit di-scan.');
    if (lum(el.fg.value) > lum(el.bg.value) && !el.transparent.checked) msgs.push('QR terang di latar gelap tidak didukung sebagian scanner.');
    if (el.logoOn.checked && logoData && +el.logoSize.value > 35) msgs.push('Logo besar bisa membuat QR gagal dibaca. Disarankan ≤ 35%.');
    el.warn.hidden = !msgs.length;
    el.warn.textContent = msgs.join(' ');
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
