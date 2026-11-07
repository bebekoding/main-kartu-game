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
- Bomb hanya melawan lima kartu. Bomb tak dilawan memberi pemilik pilihan membalik kekuatan kartu dan kombo; bomb berikutnya boleh membalik kembali ke normal. Pembagian berikutnya selalu kembali normal.
- Semua lawan pass membuka meja baru, ronde berakhir saat salah satu tangan habis.
- Ronde pertama searah jarum jam, ronde kedua berlawanan, selanjutnya bergantian setiap pembagian kartu. Ini terpisah dari pembalikan kekuatan bomb.
- Timer **30 detik per giliran**.
- Tambahan skor akhir ronde = jumlah kartu tersisa ×10; poin terendah terbaik. Sesi berakhir setelah pemberian skor saat ada total >=250.
- Pembuka ronde pertama wajib memuat 3♦, boleh single, pair, atau kombo lima kartu sah. Ronde berikutnya dibuka pemenang sebelumnya. Semua pemain wajib klik Ready di awal setiap ronde.
- Straight normal memakai ujung straight lalu suit ujung; A2345 memakai ujung 5. Flush normal mengikuti ♠ > ♥ > ♣ > ♦. Full house ditentukan rank triple.
- Ujung straight dan suit ikut terbalik. Pair/flush memilih ulang kartu terkuat menurut keadaan aktif. Straight sah A2345 sampai 10-J-Q-K-A, tanpa J-Q-K-A-2. Flush sesama suit memakai kartu terkuat aktif; pair sesama rank memakai suit terkuat aktif. Pass sukarela dan bermain lagi pada giliran berikutnya diperbolehkan. Skor akhir sama mendapat peringkat bersama.
- Timeout: membalas menjadi pass; membuka menjadi single terendah legal; pilihan bomb mempertahankan keadaan aktif. Ready tanpa batas waktu. Detail dan contoh penerimaan ada di `docs/CAPSA_RULES_DRAFT.md`.
- Agregasi leaderboard lintas sesi belum diputuskan; Capsa awal tetap tanpa award leaderboard.
- Peta integrasi dan verifikasi kickoff tercatat di `docs/CAPSA_KICKOFF_PLAN-v4.4.md`.

## Batas persiapan ini

Engine murni Capsa sudah dibuat di `capsa-engine.js`, dengan 26 tes aturan. Capsa sudah dapat dimainkan dari lobby lokal melalui gateway emulator, tanpa leaderboard. Panduan dan bukti pengujian ada di `docs/CAPSA_LOCAL.md`; integrasi produksi belum dibuat. Kontrak API ada di `docs/CAPSA_ENGINE.md`. Tidak membuat Firebase project/database baru, memindahkan akun pemain, mengganti URL live atau melakukan deploy. Konfigurasi `.firebaserc` masih menunjuk **produksi `truf-e3256`**; kickoff berikutnya sebaiknya mulai dengan emulator/preview lokal. Dokumen dan struktur project pengembangan tidak sama dengan migrasi data produksi.

PR keamanan sumber tentang kartu tersembunyi publik, validasi komunikasi room dan beberapa aksi permainan dicatat di handoff. Jangan menyatakan sudah selesai tanpa reproduksi dan verifikasi yang sesuai.

## Teks untuk memulai chat di project baru

> Kita mulai kickoff Main Kartu 4.4 di folder `/Users/960075/Documents/Main Kartu 4.4`. Baca `docs/KICKOFF-v4.4.md`, `docs/RINGKASAN-v4.4.md` dan `docs/CAPSA_RULES_DRAFT.md`. Tujuan berikutnya menambah Capsa sesuai keputusan pengguna. Periksa status Git terkini, pertahankan file audit untracked dan jangan menimpa perubahan lain. Mulai dari memetakan integrasi dan menyelesaikan detail aturan yang masih terbuka; jangan membuat asumsi aturan ambigu. Pengembangan serta pengujian awal dilakukan lokal/emulator. Belum ada instruksi deploy atau migrasi data produksi dari kickoff ini.

## Keputusan deploy 3 November 2026

Pengguna meminta deploy web dan memilih tetap gratis: browser host dipercaya serta dapat membaca seluruh kartu. Adapter/rules produksi disiapkan sesuai `CAPSA_HOST.md`; izin deploy sudah diberikan, tidak perlu meminta ulang. Akun online tetap; tidak menyalin emulator atau mengaktifkan billing.

## Keputusan tampilan dan timer terbaru

Pembaruan 3 November 2026: waktu berpikir 30 detik. Kartu aktif ditampilkan besar di tengah meja; riwayat tersembunyi sampai tombol Historis ditekan. Jeda kemenangan tetap 7 detik, lalu pembagian otomatis dan Ready manusia yang baru.

Tampilan terbaru mengikuti susunan Remi: utara/barat/timur mengelilingi tengah, pengguna di selatan. Seluruh kartu yang sudah dimainkan dalam ronde tampil bersama di tengah dan hanya direset pada pembagian ronde berikutnya. Ini menggantikan keputusan sebelumnya untuk menampilkan hanya kartu terakhir di tengah.
