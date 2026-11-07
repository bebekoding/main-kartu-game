# Capsa V4.4: integrasi lokal/emulator

Diperbarui 3 November 2026. Capsa sekarang dapat dimainkan dari lobby **pada loopback lokal**, dengan empat manusia atau manusia + bot. Ini belum rilis online; produksi, akun asli dan data pemain tidak diubah.

## Menjalankan

Di folder `/Users/960075/Documents/Main Kartu 4.4`:

```bash
npm run dev:local
```

Buka `http://127.0.0.1:18844/capsa`. Daftarkan akun **uji baru**; akun produksi tidak tersedia di emulator. Untuk empat pemain pada satu komputer, gunakan empat profil/konteks browser terpisah, supaya sesi Auth/localStorage tidak saling mengganti. Tab biasa dalam profil yang sama bukan empat identitas.

Kebutuhan: Node, Firebase CLI, Java untuk RTDB emulator, dan dependensi proyek terpasang. Launcher memakai jar emulator RTDB resmi v4.11.2 yang sudah tersimpan bila tersedia (kompatibel dengan Java 17 di mesin ini), lalu Auth emulator melalui CLI. Jika cache jar tidak tersedia, CLI menjalankan kedua emulator dan mungkin memerlukan Java 21+. Tidak memasang/mengubah JDK sistem. SDK Firebase dan font masih dimuat dari CDN, sehingga browser membutuhkan koneksi internet untuk aset tersebut.

Alamat tetap:
- Web dan gateway Capsa: `127.0.0.1:18844`.
- RTDB emulator: `127.0.0.1:19000`.
- Auth emulator: `127.0.0.1:19099`.
- Project demo: `demo-main-kartu-v44`; ini bukan pembuatan Firebase project cloud baru.

Ctrl+C menghentikan gateway, menyimpan checkpoint akhir, lalu menghentikan emulator dan seluruh proses anaknya. Akun uji dan data game sekarang dipulihkan otomatis saat `npm run dev:local` dijalankan lagi. Checkpoint juga dibuat tiap 5 detik selama layanan hidup. Jika proses/komputer mati paksa, perubahan setelah checkpoint terakhir masih bisa hilang; jangan menganggapnya jaminan penyimpanan tanpa kehilangan data.

Cadangan berada di `artifacts/local-state/latest.json`, dengan satu generasi cadangan `previous.json`. Keduanya berisi Auth emulator dan seluruh namespace demo dalam satu file dengan checksum, termasuk tangan privat, skor, UID, receipt dan kontrol save/resume. Folder memakai izin 0700, file 0600, diabaikan Git/Hosting dan diblokir server preview. Hash password emulator bersifat test-only dan dapat membocorkan password uji; gunakan password khusus uji dan jangan membagikan file cadangan.

Pemulihan dilakukan sebelum gateway menerima pemain. Cadangan dengan project/checksum tidak sah ditolak; jika latest rusak, previous yang valid dipakai dengan pesan di terminal. Pemulihan menolak menimpa emulator yang sudah berisi data. Snapshot menjaga timestamp asli: retensi tujuh hari game tersimpan tidak diperpanjang diam-diam oleh restart. Room biasa yang sudah kedaluwarsa tetap mengikuti lifecycle aplikasi.

`npm run local:checkpoint` membuat checkpoint manual ketika emulator hidup. Jika port milik layanan lain atau instance lama masih dipakai, launcher berhenti sebelum memulai/mengimpor apa pun; jangan menjalankan beberapa instance pada port yang sama.

## Yang terhubung

- Pilihan Capsa hanya tampil pada localhost/loopback. `/capsa` dan `/capsa/KODE` didukung server lokal dan router aplikasi. Tidak menambahkan Hosting rewrite produksi untuk Capsa.
- Konfigurasi Firebase pada loopback selalu memakai demo + Auth/RTDB emulator, sebelum listener/login berjalan. Jika emulator mati, aplikasi tidak jatuh ke Firebase produksi. Situs nonloopback tetap memakai konfigurasi lama dan menyembunyikan Capsa.
- Host memulai, slot kosong diisi bot, semua manusia Ready tiap ronde. Ready bersamaan mengambil revisi terbaru dan mencoba ulang suara tersebut; aksi kartu tidak otomatis diterapkan ulang pada revisi baru.
- Play/pass/bomb choice, timer 15 detik server, ronde berikutnya, skor/seri, kartu sendiri, jumlah kartu lawan dan hasil ronde sudah terhubung.
- Bot dasar memilih kombinasi legal lewat engine yang sama. Belum ada perbedaan strategi empat tingkat kesulitan untuk Capsa; selector kesulitan game lama tidak menjadi klaim AI Capsa bertingkat.
- Membership, profil, chat, online, keluar, refresh/back dan host handoff memakai alur room yang ada. Host adalah pemilik room, tetapi pemeriksaan aksi/bot lokal dijalankan gateway, bukan browser host.
- Simpan/lanjut menggunakan persetujuan semua manusia asli. Gateway memeriksa save control dalam commit yang sama dengan aksi dan membekukan state. Setelah resume, timer aktif mulai lagi 15 detik; kartu, skor, giliran dan Ready ronde tetap. Save akhir sesi Capsa ditolak. Tidak mengganti konfirmasi manusia offline dengan persetujuan otomatis.
- Capsa tetap **tanpa leaderboard**. Agregasi lintas sesi belum diputuskan. Penonton Capsa belum diaktifkan; pilot penonton Remi tetap tersedia.

## Batas kepercayaan dan data

`capsa-engine.js` tetap murni. `scripts/capsa-local-server.cjs` adalah adapter otoritatif **khusus emulator**:

1. Identitas diambil dari lookup token Auth emulator dan roster canonical, bukan UID/seat/timestamp kiriman payload.
2. Waktu dan shuffle berasal dari proses server. Browser tidak boleh mengirim timeout atau menentukan deck. Hanya host boleh start/next-round; server mengerjakan bot/timeout.
3. Commit memakai REST ETag + If-Match pada root namespace demo. Keanggotaan, host, save control, revision, state privat dan ringkasan room diperiksa/diubah atomik. Konflik diulang dari data terbaru. Ini sengaja sederhana untuk emulator dan belum rancangan berskala produksi.
4. State engine lengkap disimpan sebagai JSON string di `capsaPrivate/{code}/snapshot` agar empty array tidak hilang dalam konversi RTDB. Client tidak mempunyai read/write pada jalur ini, termasuk host. Receipt aksi tetap hidup sepanjang sesi.
5. `rooms/{code}` hanya membawa metadata room, roster, fase dan revisi Capsa. Seluruh tangan tidak pernah disalin ke subtree rooms yang masih publik pada baseline.
6. API hanya mengirim kartu tangan UID pemanggil + data publik meja. UID lain tidak bisa diminta lewat payload. Response tidak membawa hands lawan, snapshot atau receipts. Read parent/private lewat RTDB juga ditolak.
7. MatchId mencegah request sesi lama diterapkan ke sesi baru. Record privat diikat ke createdAt room; kode room yang dipakai ulang tidak memulihkan state generasi sebelumnya. Room dihapus menyebabkan cleanup privat pada tick server berikutnya.
8. Gateway hanya bind loopback, menolak Host/Origin di luar alamat lokal yang ditentukan, memblokir file konfigurasi/source internal pada static server, dan tidak menerima alamat database produksi dari environment/request.

Auth emulator memakai token pengujian tanpa jaminan kriptografi produksi. Pengujian izin lokal tidak menjadikan konfigurasi emulator layak dibuka ke internet. Model deployment/backend produksi untuk adapter ini belum dipilih atau diimplementasikan. Masalah privasi game lama di handoff tetap pekerjaan terpisah.

## Rules dan Hosting

- `database.rules.json` dan generator produksi **tetap sama**: 253.831 byte.
- `scripts/build-local-rules.cjs` menghasilkan `database.local.rules.json`: 254.275 byte pada verifikasi ini.
- Overlay lokal menolak state privat, pemalsuan fase/revisi/game Capsa oleh client, dan save pada fase akhir Capsa. Tidak menggunakan wildcard baru untuk state permainan.
- `firebase.local.json` menunjuk rules lokal; `.firebaserc` tetap menunjuk produksi seperti sebelumnya. Launcher selalu memberikan `--project demo-main-kartu-v44` eksplisit.
- `firebase.json` hanya ditambah pengecualian file konfigurasi/rules lokal dari Hosting. Tidak melakukan deploy. File script/tests/docs tetap dikecualikan seperti baseline.

## Bukti verifikasi

- Unit/regresi terbaru: 167 tes lulus (termasuk 8 tes checkpoint/pemulihan); satu induk suite emulator dilewati dalam `npm test` karena dijalankan terpisah.
- Capsa emulator: `npm run test:capsa:local`; 12 skenario integrasi (13 hasil tes termasuk induk), meliputi login/member, privasi, rules, UID palsu, Ready, start/bot, duplicate click dan race, aksi ilegal, save/resume, host handoff, cleanup, generasi room serta static/deep links.
- Regresi rules lama: 136 tes Python dan 18 skenario integrasi client/emulator lulus. Namespace lama `demo-main-kartu-host` terpisah dari namespace Capsa.
- Browser Chrome desktop dan viewport 390×844: empat identitas terpisah, pembuka 3♦, tiga pass/meja baru, persetujuan simpan/lanjut empat manusia, tangan tetap, refresh, tanpa horizontal overflow dokumen. Tidak ada page error atau request ke project Firebase produksi pada alur tersebut.
- Solo + bot: start, Ready dan refresh browser diuji. Strategi kombo bot juga diuji terhadap engine; bukan klaim bermain seluruh sesi multiplayer manusia melalui browser.
- Pengujian restart 3 November: seluruh 15 UID lokal sebelumnya dipertahankan, registrasi akun fixture dan save/keluar lewat izin client berhasil, penghentian normal menulis akun/data terbaru, login password setelah cold restart mempertahankan UID, buka/lanjut game mempertahankan kartu dan matchId serta memulai timer 15 detik setelah konfirmasi. Folder checkpoint tidak dapat diunduh lewat HTTP. Fixture uji kemudian dibersihkan; akun lama tetap utuh. Ini pengujian backend/API emulator sungguhan; bukan pengujian ulang UI browser untuk fitur checkpoint.
- Suite Capsa lokal memilih kode room kosong dan membersihkan akun fixture sendiri agar tidak menimpa akun/game lokal yang sudah tersimpan.
- Pemeriksaan render dan syntax modul lulus. Dua tangkapan layar disimpan pada outputs chat untuk review visual. Ini belum pengujian perangkat fisik, voice lintas perangkat atau deployment.

Rujukan implementasi: [REST conditional writes Firebase](https://firebase.google.com/docs/database/rest/save-data#section-conditional-requests), [Auth emulator](https://firebase.google.com/docs/emulator-suite/connect_auth).

## Jalur web berikutnya

Pengguna memilih model browser host untuk rilis gratis pada 3 November 2026. Situs publik memakai `capsa-host.js`; di emulator dapat dipilih dengan `?host=1`. Lihat `CAPSA_HOST.md`. Catatan gateway lokal di atas menjelaskan adapter demo sebelumnya, bukan backend publik.
