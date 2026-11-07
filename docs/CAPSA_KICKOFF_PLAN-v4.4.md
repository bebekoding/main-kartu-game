# Kickoff Main Kartu V4.4: Capsa

Tanggal: 2 November 2026 (Asia/Jakarta).
Workspace: `/Users/960075/Documents/Main Kartu 4.4`.
Baseline yang diperiksa: `57baa1093a8b3ea0df7c483b24b8d8db51d81714`, branch `main`.

## Status kickoff

Dokumen kickoff, ringkasan V4.4, draft Capsa, README, SKILL project serta policy host, lifecycle, save/resume dan leaderboard telah dibaca. Kickoff telah memetakan integrasi, mencatat keputusan lanjutan pengguna, dan membuat engine murni Capsa beserta tes. UI dan transport otoritatif khusus emulator sudah dibuat; penerapan produksi belum dibuat. Agregasi leaderboard masih menunggu keputusan produk. Tidak ada deploy, akses akun pemain, migrasi data, atau perubahan konfigurasi produksi.

Git awal hanya memiliki tiga file untracked berikut; isinya tidak diubah:
- `docs/AUDIT-2026-10-26.md`
- `tests/audit-runtime.cjs`
- `tests/audit-security.py`

Ringkasan menyebut baseline kode lama `46df17f`; HEAD aktual untuk pekerjaan berikutnya adalah `57baa10`. Jangan menganggap nomor baseline dokumentasi sebagai status Git terkini.

## Aturan yang sudah dikunci

- Nama Capsa, tepat empat pemain, varian Banting, tanpa triple mandiri.
- Bomb: empat rank sama + satu kartu bebas. Setelah menang meja tanpa dilawan, pemilik memilih membalik kekuatan atau mempertahankan urutan. Bomb hanya melawan lima kartu; bomb berikutnya boleh toggle kembali normal. Pembagian berikutnya kembali normal.
- Semua lawan pass membuka meja baru oleh pemain terakhir yang bermain. Satu tangan habis mengakhiri ronde; bomb penutup tidak menunggu pilihan pembalikan.
- Arah kursi bergantian setiap pembagian: searah pada ronde pertama, berlawanan pada kedua. Arah ini terpisah dari kekuatan kartu.
- Timer giliran 15 detik; timeout membalas menjadi pass, membuka menjadi single terendah legal, pilihan bomb mempertahankan keadaan aktif. Ready tanpa batas waktu.
- Pembuka ronde pertama wajib memuat 3♦ dalam single/pair/kombo lima kartu sah; ronde selanjutnya dibuka pemenang sebelumnya.
- Semua pemain wajib klik Ready pada awal setiap ronde; kesiapan ronde lama tidak berlaku untuk ronde baru.
- Straight normal dibandingkan ujung lalu suit ujung. A2345 memakai 5; Q mengalahkan 6. Flush normal mengikuti suit ♠ > ♥ > ♣ > ♦; full house berdasarkan rank triple.
- Penalti jumlah kartu tersisa ×10, tanpa bonus penjumlahan penalti lawan. Seluruh skor ronde diterapkan bersama; sesi berakhir bila ada total >=250. Poin rendah lebih baik.
- Urutan rank normal: 3 sampai 2 sebagai terkuat. Urutan lima kartu normal: straight < flush < full house < bomb < straight flush. Keduanya dibalik saat efek aktif.

## Keputusan lanjutan sudah dicatat

Ujung straight dan suit ikut terbalik. Pair/flush memilih ulang kartu terkuat aktif. Straight sah A2345 sampai 10-J-Q-K-A, tanpa J-Q-K-A-2. Pair sesama rank memakai suit terkuat aktif; flush sesama suit memakai kartu terkuat aktif. Pass sukarela dan masuk lagi diperbolehkan; skor seri mendapat peringkat bersama. Perilaku timeout dan Ready tanpa batas waktu sudah disetujui.

Agregasi leaderboard lintas sesi tetap terbuka. Capsa belum masuk ranked. Detail teknis engine: bot siap otomatis, manusia klik Ready per ronde, pembagian sebelum Ready, engine tidak menyelesaikan presence/disconnect atau save/resume sendiri. Lihat `CAPSA_ENGINE.md` untuk batas adapter berikutnya.

## Peta integrasi berdasarkan kode aktual

Tabel ini adalah peta baseline saat kickoff. Nomor baris dapat bergeser; status implementasi terkini ada di bagian Hasil tahap integrasi lokal dan `CAPSA_LOCAL.md`.

| Area | Titik integrasi | Pekerjaan berikutnya |
| --- | --- | --- |
| Firebase lokal | `truf-multiplayer-v3.html:39–63` | Inisialisasi sekarang langsung memakai produksi; belum ada koneksi Auth/Database emulator. Siapkan jalur khusus lokal dengan project demo dan guard agar tidak jatuh ke produksi. |
| Pilihan game/lobby | `showGameSelect` sekitar 9549, `handleCreateRoom` 9813, `renderRoom` 10142 | Label, kartu pilihan game, empat kursi tetap; audit semua map nama dan status admin. Registry terpusat adalah usulan refactor, belum tersedia. |
| Router/Hosting | `ROUTER_GAMES` 18816, parser 18823/18827, `firebase.json` | Tambah `/capsa` dan `/capsa/KODE`, rewrite keduanya, tetap pertahankan base href root dan perilaku back/refresh. |
| Memulai | `handleStartGame` 14614 | Branch Capsa harus eksplisit sebelum fallback Truf. Sekarang ranked prepare berjalan sebelum branching; Capsa awal perlu melewati registrasi/award dengan aman. |
| Listener/render | `enterRoomView` 9980 | Tambah dispatch fase Capsa dan pembersihan view; satu listener aktif. Sertakan alur penonton yang terpisah dan jangan mengaktifkan kontrol aksi baginya. |
| Engine | Modul murni `capsa-engine.js` sudah tersedia | Fungsi murni klasifikasi, perbandingan, aksi legal, pass, efek bomb, ronde dan skor; rulesVersion immutable pada match. Tidak menyalin resolver snapshot lama. |
| Aksi database | Adapter baru yang diusulkan | UID/kursi/giliran, revision, actionId, kepemilikan kartu, konservasi 52 kartu dan terminal check. Transaksi pada subtree otoritatif yang memuat semua invariant; jangan sekadar update hasil snapshot client. Rules juga harus memvalidasi, bukan hanya UI. |
| Bot/timer/host | `resetHostTrackers` 18480, lifecycle enter/exit | Callback terikat room, host, revision dan save epoch. Arah kursi berdasarkan ronde; 15 detik. Bot memakai engine legal move yang sama. |
| Save/resume | `room-saves.js:19`, `room-save-ui.js:15`, `scripts/room-save-policy.cjs:16` | Tambah label dan pengecualian fase terminal Capsa. Saat ini whitelist negatif berisiko menganggap fase akhir Capsa dapat disimpan. Freeze harus mencakup Ready, pilihan bomb serta semua callback; resume tidak boleh menganggap seluruh pemain sudah Ready ronde. |
| Membership/lifecycle | `room-membership.js`, `room-lifecycle.js`, `gameState/roster` | Helper kapasitas default empat dapat dipakai, tetapi tetap uji kursi, reconnect, bot replacement dan host handoff serta roster asli. |
| Rules | `scripts/build-room-rules.cjs:72–86`, `scripts/card-schema.cjs:65` | Policy Capsa eksplisit; fallback `$gameState` saat ini memberi member izin state nonreserved. Reservasi nama Capsa dan validasi aksi wajib mencegah bypass. Ubah generator, bukan hasil saja. |
| Leaderboard | `ranked-client.js`, `ranked-leaderboard.js`, `scripts/leaderboard-policy.cjs` | END map, eligibility dan game allowlist saat ini hanya empat game. Jangan menambahkan Capsa sampai aturan ranked lengkap. Skor sesi rendah tidak boleh diteruskan ke sort game lain. |
| UI/media | `SKILL.md`, `game-display.js`, Voice, exit/modal helpers | Ikuti design system project sebelum perubahan UI; render sanitizer, profil UID, online, suara, timer dan modal harus punya cleanup saat keluar/logout/simpan. |

## Urutan pekerjaan

1. Selesai: kunci keputusan aturan di draft dan contoh penerimaan untuk normal/terbalik, straight/flush, bomb kedua, pass, timeout serta seri. Agregasi leaderboard tetap terpisah.
2. Siapkan lingkungan demo lokal: Auth + RTDB emulator, identitas sintetis, rules hasil generator, tanpa fallback produksi. Server HTML lokal saja belum cukup.
3. Selesai untuk tahap murni: engine dan 26 tes aturan, termasuk konservasi kartu, urutan ronde, skor 240+20=260, dan seluruh skor diterapkan sebelum sesi dinilai selesai.
4. Implementasikan adapter aksi atomik dan policy; buktikan reject untuk UID salah, out-of-turn, revision lama, kartu bukan milik sendiri, duplicate click serta race dua tab.
5. Integrasikan lobby/router, view, bot, timer, lifecycle dan save/resume; mulai tanpa leaderboard Capsa.
6. Jalankan empat manusia, manusia+bot, back/refresh, disconnect/host handoff, simpan saat menunggu pilihan bomb, resume dan mobile. Uji privasi kartu melalui akses database langsung.
7. Integrasi leaderboard setelah keputusan produk dan pengujian contract 3. Deploy/migrasi produksi menunggu instruksi tersendiri.

Rancangan fase yang diusulkan: `lobby → capsa_round_ready → capsa_playing → capsa_bomb_choice → capsa_playing`, dengan jalur akhir `capsa_round_end → capsa_round_ready / capsa_session_end`. Setiap ronde baru membutuhkan kesiapan baru sebelum giliran pertama aktif. Engine membagi kartu sebelum Ready, menyiapkan bot otomatis, dan tetap menunggu klik manusia; presence/disconnect diselesaikan adapter berikutnya. Prioritas terminal tangan habis harus mendahului bomb choice. Engine memakai fase tanpa prefiks `capsa_` di dalam state tersendiri; nama fase room global ditetapkan saat integrasi agar tidak berbenturan dengan game lain.

## Verifikasi baseline kickoff

- `npm test`: 125/125 lulus, tidak ada kegagalan.
- `npm run check:render`: seluruh inline script dapat di-parse; tidak ada penulisan HTML tanpa filter yang terdeteksi gate.
- Generator rules dijalankan di salinan terisolasi dalam folder kerja chat; setelah melengkapi dependensi lokal `player-profiles.js`, hasil identik byte demi byte dengan rules baseline. Tidak mengubah rules workspace.
- Ukuran `database.rules.json`: 253.831 byte. Sisa terhadap batas 262.144 yang dicatat handoff: 8.313 byte. Ukur setiap regenerasi; jangan membuka wildcard untuk menghemat ekspresi.
- Suite rules emulator, pengujian browser, permainan Capsa dan produksi belum diuji pada kickoff ini. Angka historis di handoff bukan hasil pengujian baru.

Temuan keamanan pada handoff tetap terbuka: pembacaan publik subtree rooms/kartu, validasi komunikasi dan aksi permainan lama. Kickoff ini tidak menutup atau mereproduksi semua temuan tersebut. Revision client saja tidak menyembunyikan kartu dan tidak menggantikan validasi server/rules.

## Hasil tahap engine

- `capsa-engine.js`: klasifikasi/perbandingan, Ready per ronde, alur play/pass/pilihan bomb, timeout, ronde bergantian, penalti dan hasil seri.
- `tests/capsa-engine.test.cjs`: 26 tes engine lulus. Setelah pemasangan, `npm test` pada workspace lulus **151/151** (125 baseline + 26 Capsa), `npm run check:render` lulus, dan `git diff --check` bersih. Engine juga lulus `node --check`.
- `docs/CAPSA_RULES_DRAFT.md`: keputusan pengguna terkini. `docs/CAPSA_ENGINE.md`: API, model data dan batas keamanan.
- Revision dan receipt actionId engine mencegah penerapan ulang aksi pada state reducer. Receipt hidup sepanjang sesi. Ini belum transaksi database, receipt leaderboard atau bukti identitas Auth.
- Empat simulasi sesi deterministik melewati beberapa ronde sampai >=250 dengan konservasi 52 kartu. Ini tidak menguji jaringan, empat browser, bot AI, emulator atau produksi.

Pada akhir tahap engine, adapter dan UI masih belum terhubung. Tahap tersebut kemudian dilanjutkan dan diselesaikan khusus lokal/emulator seperti dicatat di bawah; situs produksi tetap empat game.

## Hasil tahap integrasi lokal

Capsa kini terhubung ke lobby, router loopback, Ready, play/pass/pilihan bomb, bot dasar, timer server, hasil ronde, membership dan save/resume. Gateway Node khusus emulator memvalidasi aksi dengan Auth lookup dan commit REST ETag atomik. Tangan disimpan di jalur privat di luar subtree rooms publik; API mengirim tangan sendiri saja. Rules produksi tidak diubah, overlay emulator berukuran 254.275 byte. Ready yang bertabrakan revisi diperbarui/dicoba ulang tanpa mencoba ulang langkah kartu pada revisi baru.

Panduan `CAPSA_LOCAL.md` menggantikan status rencana yang belum selesai pada tabel historis di atas: 158 tes unit/regresi, 12 skenario Capsa emulator, 136 tes rules lama, 18 skenario client lama, serta empat konteks Chrome dengan save/resume dan refresh. Gateway/akun/game lokal tidak sama dengan deployment/migrasi produksi. Leaderboard Capsa dan penonton Capsa belum diaktifkan. Batas tersebut telah ditangani pada tahap persistensi lokal 3 November 2026, seperti dicatat di bawah.

## Hasil persistensi lokal, 3 November 2026

Akun uji dan namespace demo dicadangkan tiap 5 detik serta sebelum emulator dihentikan normal; pemulihan otomatis berjalan sebelum gateway siap. State disimpan di artifacts yang privat, diabaikan Git/Hosting dan tidak dilayani HTTP. Pemulihan mempertahankan UID/password uji, seluruh kartu, skor, receipt dan save control. Checksum dan previous generation melindungi pemulihan dari file rusak; emulator berisi data tidak ditimpa. Semua endpoint tetap localhost/demo, tidak ada copy akun produksi.

Delapan tes unit baru dan pengujian cold restart nyata lulus, termasuk login password setelah restart, save/keluar/buka kembali/lanjut dengan kartu identik, konfirmasi manusia baru dan reset timer 15 detik. Seluruh 15 UID sebelum pembaruan tetap utuh. Rincian, batas kehilangan perubahan setelah checkpoint terakhir, dan perintah checkpoint manual ada di `CAPSA_LOCAL.md`.

## Jalur deploy web, 3 November 2026

Pengguna sudah mengizinkan deploy dan memilih tetap gratis dengan kepercayaan kepada browser host (host dapat membaca semua kartu). `capsa-host.js`, `capsa-bot.js` dan policy Capsa memperluas integrasi ke situs publik tanpa billing; akun online lama dipertahankan. Rules dan Hosting dirilis setelah tes, dengan rollback baseline disimpan. Rincian di `CAPSA_HOST.md`.
