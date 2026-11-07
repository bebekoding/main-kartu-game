# Capsa engine: kontrak integrasi V4.4

`capsa-engine.js` adalah modul murni UMD: Node `require`, atau global browser `CapsaEngine`. Sekarang diimpor untuk UI Capsa lokal; adapter khusus emulator berada di `scripts/capsa-local-server.cjs`. Lihat `CAPSA_LOCAL.md` untuk status integrasi dan batas produksi. Rules version: `capsa-v4.4-kickoff-1`.

## API

- `deck()`: 52 kartu `{rank,suit}` unik dalam urutan tetap, **bukan shuffle**. Rank string `3` sampai `10`, `J/Q/K/A/2`; suit `D/C/H/S`.
- `classify(cards)`: validasi single/pair/kombo lima kartu, hasil `{type,cards}`. Kartu tak sah/duplikat/kombo tidak sah dilempar sebagai error.
- `compare(left,right,reversed=false)`: 1 jika kiri lebih kuat, -1 jika kanan lebih kuat, 0 sama; `null` bila jumlah kartu berbeda. Ini bukan legal-move check terhadap kepemilikan kartu.
- `createSession(players, shuffledDeck, now)`: empat `{uid,isBot}` berurutan kursi 0–3, tepat 52 kartu unik, timestamp milidetik dari pemanggil. Pemanggil bertanggung jawab mengacak deck secara layak.
- `applyAction(state, action, now)`: mengembalikan state baru; input tidak diubah. Field wajib `id`, `uid`, `expectedRevision`, `type`. Tipe `ready`, `play` (+cards), `pass`, `choose_bomb` (+flip boolean), `timeout`, `next_round` (+deck).
- `assertState(state)`: periksa schema dasar, roster, phase, konservasi 52 kartu, meja, kesiapan dan state terminal. Tidak membuktikan riwayat state merupakan permainan autentik.
- `standings(scores)`: kelompok `{score,seats}` berurutan skor rendah; seri berada di kelompok sama, tanpa pemecah seri kursi.

## Fase dan data

Fase internal: `round_ready`, `playing`, `bomb_choice`, `round_end`, `session_end`. Pembagian sebelum Ready; bot siap otomatis dan setiap manusia perlu klik baru setiap ronde. `turn` menyimpan calon pembuka saat Ready, tetapi aksi play tetap ditolak sampai semua siap. Ready tidak memakai deadline. Arah kursi +1 pada ronde ganjil, -1 pada genap; pembagian baru mereset reversed.

State membawa roster, hands empat kursi, discard, table, passed, ready, scores, history penalti per ronde, revision, receipts, winner, turn, deadline dan rulesVersion. Kartu meja adalah referensi kartu yang sudah ada di discard, bukan salinan kartu tambahan untuk konservasi.

Setiap aksi sukses menaikkan revision satu kali. `id` alfanumerik berawalan huruf/angka, maksimal 128 karakter (underscore/hyphen diperbolehkan setelah karakter pertama). Replay ID dan payload sama mengembalikan state terkini tanpa efek baru. ID sama dengan payload berbeda ditolak. ID baru dengan revision lama ditolak. Receipt disimpan sepanjang sesi; adapter perlu memperhitungkan pertumbuhan state saat memilih bentuk penyimpanan, tanpa membuang perlindungan replay.

`now` dan UID adalah input, bukan bukti Auth/waktu server. Timeout boleh diajukan oleh UID roster setelah deadline; izin siapa yang menjalankan resolver ini adalah tanggung jawab transport. Bot memakai UID roster bot; transport hanya boleh meneruskan aksi bot dari host/resolver yang berwenang. `next_round` di reducer boleh diajukan UID roster setelah akhir ronde, tetapi adapter harus mengikat pembagian/shuffle kepada otoritas yang ditetapkan. Engine tidak menulis identitas manusia menjadi bot saat disconnect.

## Kontrak adapter dan status lokal

1. Cocokkan UID asli dengan Firebase Auth; jangan menerima field uid client tanpa pembuktian. Periksa kepemilikan host saat menjalankan bot, pembagian dan resolver.
2. Gunakan revision dan actionId dalam commit atomik pada state otoritatif. Dua request bersamaan harus menghasilkan paling banyak satu transisi; jangan sekadar read lalu update snapshot.
3. Validasi aturan di boundary tepercaya/rules juga. Client dapat memodifikasi atau melewati modul ini. RTDB rules saat ini belum menegakkan engine Capsa.
4. Pilih model privasi dan kepercayaan host sebelum mengunggah hands/deck. Jangan menyimpan seluruh state reducer pada subtree publik lalu mengklaim kartu privat. State engine berisi seluruh tangan.
5. Sediakan waktu tepercaya, timer yang tahan refresh dan race; jangan mempercayai `Date.now()` kiriman pemain. Freeze save mencakup Ready/bomb choice dan deadline; resume mengacu readiness yang sesuai, bukan menyiapkan manusia otomatis.
6. Tangani presence, host handoff, bot epoch, reconnect, akun lintas tab dan pembersihan listener. Skenario manusia offline tetap butuh UI/recovery; pure engine tidak menganggap offline sebagai Ready.
7. Jangan mendaftarkan Capsa ranked atau menulis award dari skor sesi. Agregasi lintas sesi masih terbuka; receipt aksi engine tidak menggantikan contract 3.

## Pengujian

`node --test tests/capsa-engine.test.cjs`, atau `npm test` untuk seluruh suite. Tes mencakup aturan pengguna dan simulasi sesi deterministik; bukan bukti permainan browser, transaksi Firebase, privasi kartu atau perangkat fisik. Detail aturan ada di `CAPSA_RULES_DRAFT.md`.

## Implementasi lokal lanjutan

Kontrak di atas telah dihubungkan melalui gateway emulator: Auth lookup, waktu/shuffle server, REST ETag CAS, proyeksi tangan sendiri dan save freeze. RTDB rules produksi belum diubah dan bukan validator engine Capsa. Adapter lokal tidak boleh dipakai sebagai backend publik tanpa rancangan deployment/keamanan produksi. Lihat `CAPSA_LOCAL.md`.

## Tampilan putaran meja — 7 November 2026

`roundPlays` tetap menyimpan seluruh kartu keluar selama satu pembagian untuk Historis. `tableStart` menandai indeks awal putaran meja aktif: direset ke nol saat pembagian baru, maju ke panjang riwayat ketika semua lawan pass (setelah pilihan bomb bila diperlukan), dan ditetapkan saat pembuka baru bermain. Host dan gateway lokal menyertakannya pada proyeksi publik.

Meja utama hanya menampilkan irisan riwayat sejak `tableStart` selama `table` masih terisi; saat meja dibuka kembali kartu lama langsung dibersihkan. Snapshot lama tanpa penanda hanya menampilkan kombinasi terakhir, tanpa menebak batas putaran. Historis tidak ikut dihapus.


## Durasi giliran per ronde — 7 November 2026

`turnDuration(round)` memberi 45.000 ms pada ronde 1–2 dan 30.000 ms sesudahnya. Semua pembaruan deadline, pilihan bomb, host handoff/resume serta gateway lokal memakai fungsi yang sama. `TURN_MS` tetap 30.000 sebagai durasi dasar ronde lanjutan. Siap/Ready tetap tanpa batas waktu dan jeda pemenang tetap tujuh detik.
