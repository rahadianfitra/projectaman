# PDFAman

Alat PDF & QR code pribadi: **Gabung PDF, Pisah PDF, PDF ke JPG/PNG, Tanda Tangan PDF, dan QR Code (dengan/tanpa logo)**.

Semua proses berjalan **di browser pengguna** (client-side). File tidak pernah diupload ke server mana pun, termasuk Netlify. Netlify cuma mengirim file HTML/CSS/JS-nya.

## Struktur folder

```
pdfaman/
├── index.html            # Halaman utama + semua tampilan tool
├── netlify.toml          # Konfigurasi Netlify + header keamanan (CSP, dll)
├── assets/
│   ├── css/style.css
│   ├── img/favicon.svg
│   └── js/
│       ├── app.js        # Utilitas bersama + router menu
│       ├── merge.js      # Gabung PDF
│       ├── split.js      # Pisah PDF
│       ├── pdf2img.js    # PDF ke JPG/PNG
│       ├── sign.js       # Tanda tangan PDF
│       └── qr.js         # QR code generator
```

Library yang dipakai (dimuat dari CDN jsDelivr, versinya dikunci):
- pdf-lib 1.17.1: membuat/mengedit PDF (gabung, pisah, tempel tanda tangan)
- pdf.js 3.11.174: me-render halaman PDF (thumbnail, konversi ke gambar)
- JSZip 3.10.1: membuat file ZIP
- qr-code-styling 1.5.0: membuat QR code dengan gaya & logo

## Menjalankan di komputer sendiri

Jangan buka `index.html` dengan double-click (`file://`), karena sebagian fitur browser butuh server. Pakai salah satu cara ini:

**Cara 1 – VS Code (paling mudah)**
1. Install ekstensi **Live Server**.
2. Buka folder `pdfaman`, klik kanan `index.html` → **Open with Live Server**.

**Cara 2 – Terminal**
```bash
cd pdfaman
npx serve .          # atau: python -m http.server 8080
```
Lalu buka `http://localhost:3000` (atau `:8080`).

## Deploy ke Netlify

**Cara cepat (drag & drop):**
1. Buka https://app.netlify.com/drop
2. Seret folder `pdfaman` ke halaman tersebut. Selesai, kamu langsung dapat URL.

**Cara rekomendasi (lewat GitHub, auto-deploy tiap update):**
1. Upload folder ini ke repository GitHub.
2. Di Netlify: **Add new site → Import an existing project → GitHub** → pilih repo.
3. Build command: *(kosongkan)*, Publish directory: `.`
4. Deploy. Setiap kamu `git push`, situs otomatis ter-update.

## Catatan keamanan

- File diproses 100% di browser. Bisa dicek: buka DevTools → tab Network saat memproses file, tidak ada upload.
- `netlify.toml` memasang Content-Security-Policy ketat: script hanya boleh dari situs sendiri dan jsDelivr, halaman tidak bisa di-iframe, dan form tidak bisa mengirim data keluar.
- **Opsional, lebih aman lagi (self-host library):** download keempat file library di `index.html` ke folder `assets/vendor/`, ganti `src`-nya ke path lokal, lalu hapus `https://cdn.jsdelivr.net` dari CSP. Untuk pdf.js, salin juga `pdf.worker.min.js`, folder `cmaps/`, dan `standard_fonts/`, lalu ubah `PDFJS_BASE` di `assets/js/app.js`. Dengan begitu situs tidak bergantung pada pihak ketiga sama sekali.
- Font tampilan diambil dari Google Fonts. Kalau tidak ingin ada request ke Google, self-host font-nya juga.

## Keterbatasan

- PDF yang dilindungi password harus dibuka kuncinya dulu.
- Tanda tangan di sini berupa **gambar tanda tangan** (seperti Smallpdf versi standar), bukan *digital signature* bersertifikat (PKI).
- File sangat besar (ratusan MB) bergantung pada RAM perangkat pengguna. Batas di aplikasi 200 MB per file (`MAX_FILE_MB` di `app.js`).
# projectaman
