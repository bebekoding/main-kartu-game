# Main Kartu 4.4 — persiapan migrasi dan kickoff

Disiapkan 2 November 2026.

## Workspace pengembangan berikutnya

- Folder: `/Users/960075/Documents/Main Kartu 4.4`.
- Disalin dari `/Users/960075/Documents/truf-game` pada commit `4ea9e69`.
- Riwayat Git lengkap dan 110 file tracked dipertahankan; isi file diperiksa sama dengan sumber sebelum dokumen kickoff ini ditambahkan.
- Remote tetap `https://github.com/bebekoding/main-kartu-game.git`; bukan repository baru yang terputus dari riwayat sebelumnya.
- Tiga file audit lokal yang belum masuk Git turut disalin dan tetap untracked: `docs/AUDIT-2026-10-26.md`, `tests/audit-runtime.cjs`, `tests/audit-security.py`.
- Folder lama dipertahankan agar tidak kehilangan data lokal. Untuk pekerjaan V4.4, gunakan folder baru agar dua salinan tidak berkembang sendiri-sendiri.
- Cache, node_modules dan artefak hasil pengujian diabaikan Git; tidak termasuk salinan tracked. Bukti pengujian lama tetap berada di workspace lama/temp asal.

## Project aplikasi

Pendaftaran project sidebar tidak tersedia melalui alat project saat persiapan ini. Pengoperasian otomatis tampilan Codex diblokir oleh pembatasan aplikasi. Tambahkan project lokal bernama **Main Kartu 4.4**, pilih folder di atas sebagai folder utama. Sesudah project tersedia, pindahkan chat lama lewat menu/sidebar bila ingin membawa riwayat percakapan, atau mulai chat kickoff baru dengan teks di bawah.

## Baca dahulu

1. `docs/RINGKASAN-v4.4.md`: gambaran project, fitur, kontrak keamanan, batasan dan PR.
2. `docs/CAPSA_RULES_DRAFT.md`: aturan Capsa yang sudah dikonfirmasi dan detail yang masih terbuka.
3. `README.md`, dokumen policy terkait dan `SKILL.md` sebelum mengubah UI.

## Keputusan Capsa yang sudah ditetapkan

- Nama **Capsa**, tepat empat pemain, mekanisme Banting.
- Tanpa triple mandiri; bomb empat rank sama + satu kartu bebas.
- Bomb tak dilawan memberi pemilik pilihan membalik kekuatan kartu dan kombo sampai akhir ronde.
- Semua lawan pass membuka meja baru, ronde berakhir saat salah satu tangan habis.
- Ronde pertama searah jarum jam, ronde kedua berlawanan, selanjutnya bergantian setiap pembagian kartu. Ini terpisah dari pembalikan kekuatan bomb.
- Timer **15 detik per giliran**.
- Tambahan skor akhir ronde = jumlah kartu tersisa ×10; poin terendah terbaik. Sesi berakhir setelah pemberian skor saat ada total >=250.
- Belum diputuskan: efek bomb kedua ketika terbalik, detail pembuka dan pembanding suit/straight terbalik, timeout, seri serta agregasi leaderboard lintas sesi.

## Batas persiapan ini

Capsa belum diimplementasikan. Tidak membuat Firebase project/database baru, memindahkan akun pemain, mengganti URL live atau melakukan deploy. Konfigurasi `.firebaserc` masih menunjuk **produksi `truf-e3256`**; kickoff berikutnya sebaiknya mulai dengan emulator/preview lokal. Dokumen dan struktur project pengembangan tidak sama dengan migrasi data produksi.

PR keamanan sumber tentang kartu tersembunyi publik, validasi komunikasi room dan beberapa aksi permainan dicatat di handoff. Jangan menyatakan sudah selesai tanpa reproduksi dan verifikasi yang sesuai.

## Teks untuk memulai chat di project baru

> Kita mulai kickoff Main Kartu 4.4 di folder `/Users/960075/Documents/Main Kartu 4.4`. Baca `docs/KICKOFF-v4.4.md`, `docs/RINGKASAN-v4.4.md` dan `docs/CAPSA_RULES_DRAFT.md`. Tujuan berikutnya menambah Capsa sesuai keputusan pengguna. Periksa status Git terkini, pertahankan file audit untracked dan jangan menimpa perubahan lain. Mulai dari memetakan integrasi dan menyelesaikan detail aturan yang masih terbuka; jangan membuat asumsi aturan ambigu. Pengembangan serta pengujian awal dilakukan lokal/emulator. Belum ada instruksi deploy atau migrasi data produksi dari kickoff ini.
