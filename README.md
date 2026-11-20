# PDFAman

**Your Files. Your Device. Your Privacy.**

Alat PDF, gambar & QR code pribadi: **Gabung PDF, Pisah PDF, PDF ke JPG/PNG, Kompres PDF, Kompres Gambar, Tanda Tangan PDF, QR Code**, plus **Statistik pengunjung** anonim.

Dokumen kamu diproses langsung di browser. Kami tidak mengupload, menyimpan, atau membaca file pribadimu. Netlify hanya mengirim file HTML/CSS/JS-nya.

## Fitur

| Tool | Keterangan |
|---|---|
| Kompres PDF | Slider tingkat kompresi 10–90%. Mode **pintar** (default): hanya gambar di dalam PDF yang dikompres ulang (JPEG, diperkecil ke DPI target) + stream tak terkompresi di-Flate; teks, font & vektor tidak disentuh sehingga **tetap bisa dicari**. Mode **jadikan gambar** untuk PDF hasil scan. Hasil tidak pernah lebih besar dari file asli. |
| JPG/PNG ke PDF | JPG, PNG, WebP → satu PDF. Atur urutan (seret), putar per gambar, ukuran halaman (A4, F4, Letter, Legal, sesuai gambar), orientasi, margin, dan kualitas (asli/seimbang/kecil). Orientasi EXIF foto HP otomatis diperbaiki. |
| Tema | Otomatis (ikut sistem) / Terang / Gelap, disimpan di perangkat. |
| Kompres Gambar | JPG/PNG/WebP, banyak file sekaligus. Slider kompresi 10–90%, pilihan format hasil & ukuran maksimum. Bila hasil malah lebih besar, file asli dipakai. |
| Semua tool | Progress bar + persen, tombol **Batal** (atau tombol Esc), ukuran file awal → akhir. |
| Pratinjau | Kompres PDF & gambar: pembanding geser asli ↔ hasil sebelum diunduh (PDF bisa per halaman & zoom 200%). |
| Statistik | Pengunjung harian (30 hari), bulanan (12 bulan), total, page view; tabel & unduh CSV. |

## Struktur folder

```
pdfaman/
├── index.html                 # Halaman utama + semua tampilan tool
├── netlify.toml               # Konfigurasi Netlify + header keamanan (CSP)
├── package.json               # Hanya dependency Netlify Function (@netlify/blobs)
├── netlify/functions/
│   └── visits.mjs             # Penghitung pengunjung anonim (/api/hit, /api/stats)
└── assets/
    ├── css/style.css
    ├── fonts/                 # Font Google (OFL) di-self-host
    ├── vendor/                # Library di-self-host (lihat di bawah)
    ├── img/
    └── js/
        ├── theme.js           # Tema terang/gelap (dimuat di <head>)
        ├── app.js             # Utilitas bersama, progress/batal, pembanding, router
        ├── img2pdf.js         # JPG/PNG ke PDF
        ├── merge.js  split.js  pdf2img.js  sign.js  qr.js
        ├── compress.js        # Kompres PDF
        ├── imgcompress.js     # Kompres gambar
        └── stats.js           # Penghitung kunjungan + halaman Statistik
```

Library (di-self-host di `assets/vendor/`, versi dikunci, checksum tarball npm terverifikasi):
- pdf-lib 1.17.1, pdf.js 3.11.174 (+ worker, cmaps, standard_fonts), JSZip 3.10.1, qr-code-styling 1.5.0

## Privasi: apa yang keluar dari browser?

- **File: tidak ada.** Semua konversi, kompresi & tanda tangan berjalan di browser.
- **Pihak ketiga: tidak ada.** Library & font disajikan dari situs sendiri. CSP (`netlify.toml` + `<meta>` di `index.html`) hanya mengizinkan `'self'`, jadi browser **memblokir** koneksi ke domain lain, termasuk bila ada kode yang mencoba.
- **Statistik:** sekali per buka halaman, browser mengirim `POST /api/hit` ke domain sendiri berisi 3 boolean `{d, m, n}` (kunjungan pertama hari ini / bulan ini / pertama kali, dicatat di `localStorage`). Tanpa cookie (`credentials: 'omit'`), tanpa referrer. Server **hanya menyimpan angka agregat**, tidak menyimpan IP, user-agent, atau ID. Browser dengan *Do Not Track* / *Global Privacy Control* tidak mengirim hit.
- Cek sendiri: DevTools → Network saat memproses file.

## Menjalankan di komputer sendiri

Jangan buka `index.html` dengan double-click (`file://`). Pakai **Live Server** (VS Code) atau `npx serve .` / `python -m http.server 8080`.
Di localhost semua tool berjalan normal; halaman Statistik menampilkan pesan karena Netlify Function tidak ikut jalan (pakai `netlify dev` bila ingin mencobanya).

## Deploy ke Netlify

Gunakan **Import dari GitHub** (bukan drag & drop) supaya Netlify memasang dependency `@netlify/blobs` dan mem-bundle function.
1. **Add new site → Import an existing project → GitHub** → pilih repo.
2. Build command: *(kosongkan)*, Publish directory: `.`, Functions directory terbaca otomatis dari `netlify.toml`.
3. Deploy. Netlify Blobs aktif otomatis, tidak perlu setting tambahan.

## Keterbatasan

- PDF yang dilindungi password harus dibuka kuncinya dulu.
- Kompres PDF mode pintar hanya memperkecil **gambar**. PDF yang isinya teks/vektor saja biasanya sudah optimal dan dikembalikan apa adanya. Gambar JPEG 2000, JBIG2, CCITT, CMYK, atau berpalet (Indexed) dilewati.
- Mode "jadikan gambar" mengubah halaman menjadi gambar: teks tidak bisa dicari lagi.
- Penghitung pengunjung tidak atomik: pada lonjakan trafik yang sangat padat sebagian kecil hit bisa terlewat. "Pengunjung unik" berbasis `localStorage`, jadi ganti browser/hapus data situs dihitung sebagai pengunjung baru.
- Tanda tangan berupa **gambar tanda tangan**, bukan *digital signature* bersertifikat (PKI).
- Batas 200 MB per file (`MAX_FILE_MB` di `app.js`); file besar bergantung pada RAM perangkat.
