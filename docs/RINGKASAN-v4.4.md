# Main Kartu — handoff persiapan V4.4

Tanggal: 2 November 2026. Baseline kode: `46df17f` pada `main`.
Status: persiapan V4.4, bukan pengumuman rilis game kelima.

## Keputusan produk

- Empat game yang sudah tersedia: Truf (4), Cangkul (3–6), Remi (4), Tebak Kartu (4–6).
- Game kelima bernama **Capsa, tepat 4 pemain**, dengan mekanisme varian Banting. Aturan harus diteliti di internet dan diverifikasi pengguna sebelum implementasi. Lihat [draft Capsa](CAPSA_RULES_DRAFT.md).
- Revisi Capsa pengguna: tanpa triple mandiri; bomb = empat rank sama + satu bebas. Setelah bomb tak dilawan, pemilik boleh membalik kekuatan sampai akhir ronde. Semua lawan pass membuka meja baru, bukan mengakhiri ronde. Sisa kartu ×10; poin terendah terbaik; sesi berhenti pada skor >=250. Detail draft internet yang bertentangan dicabut. Lihat draft untuk detail lanjutan yang masih terbuka.
- Arah giliran Capsa bergantian per ronde/pembagian: pertama searah jarum jam, berikutnya berlawanan, lalu searah, dan seterusnya. Terpisah dari pembalikan kekuatan bomb. Timer Capsa **15 detik per giliran pemain**; nama tampilan **Capsa**.
- Tetap menggunakan layanan Firebase saat ini; hasil leaderboard disahkan melalui persetujuan semua pemain manusia, bukan simulasi seluruh permainan di server.
- Nama profil hanya nama tampilan; akun login lama tetap digunakan.

## Project dan cara melanjutkan

- Repo: https://github.com/bebekoding/main-kartu-game
- Live: https://main-kartu-game.web.app
- Firebase: `truf-e3256`; Hosting `main-kartu-game`; RTDB region `asia-southeast1`.
- Vanilla JavaScript, Firebase SDK 10.12.0, tanpa build frontend. HTML utama `truf-multiplayer-v3.html` sekitar 20.232 baris pada baseline ini.
- URL per game dan room: `/remi`, `/remi/KODE` dan padanannya untuk tiga game lain. Pertahankan `<base href="/">` untuk aset deep link.
- Modul terpisah sudah menangani membership, lifecycle room, simpan game, leaderboard, profil, jumlah online dan celebration Remi. Tambahan Capsa sebaiknya memakai modul engine terpisah.
- Rules dihasilkan oleh `scripts/build-room-rules.cjs` beserta policy modul terkait. Perubahan rules harus melalui generator dan pengujian; jangan hanya mengedit hasil akhirnya.
- Dokumen, pengujian, skrip internal dan direktori tersembunyi dikecualikan dari Hosting.

## Perubahan penting sejak handoff V4.3.3

| Area | Hasil / kontrak yang harus dijaga |
| --- | --- |
| Auth dan admin | Password menggunakan Firebase Auth; identitas tetap UID. Admin terikat UID terverifikasi, provider password, email khusus dan batas waktu autentikasi. Jalur hash admin lama tidak memberi kewenangan. |
| Host dan membership | Akun biasa tidak boleh menyusup ke match aktif. Klaim host terbuka hanya jika tidak ada manusia non-bot, termasuk manusia offline. Pemain terdaftar boleh mengajukan perpindahan yang disetujui host lama. Keluar normal memindahkan host ke manusia online yang tersisa. |
| Keamanan render | Sanitasi HTML dinamis dan validasi schema kartu/rank/suit/joker. Nama profil tidak memberi hak akses. |
| Leaderboard | Contract 3: roster manusia asli dan matchId tetap, hasil selesai, suara masing-masing manusia, persetujuan bulat, award atomik sekali saja dengan receipt permanen. Penolakan membatalkan award seluruh pemain. |
| Room kosong | Room biasa tanpa manusia aktif kedaluwarsa setelah 30 detik. Bot dan penonton tidak memperpanjang umur room. Reconnect harus diperiksa sebelum penghapusan. |
| Penonton Remi | Tombol Keluar Tonton dapat digunakan di atas overlay jeda/hasil/celebration; membersihkan listener, timer, voice, media dan URL. |
| Simpan game | Seluruh empat game mendukung simpan; satu manusia cukup persetujuannya sendiri, multiplayer harus semua manusia setuju. Request membekukan permainan dan kedaluwarsa dalam 60 detik. |
| Lanjutkan game | Kursi dan snapshot tetap; semua manusia asli harus hadir dan menekan Siap lanjut pada percobaan resume yang sama. Tidak ada konversi kursi/host otomatis saat tersimpan. |
| Retensi simpan | Tujuh hari sejak akses manusia asli; membaca daftar saja, bot dan penonton tidak memperpanjang. Save yang sudah kedaluwarsa tidak boleh dihidupkan kembali. |
| Profil | Nama 4–16 karakter ASCII keyboard tanpa spasi; huruf, angka, simbol boleh dikombinasikan. Nama tidak wajib unik. Login tidak berubah. Pilihan 16 emblem anime bawaan; tanpa upload bebas. |
| Jumlah online | Halaman utama dan lobby menampilkan UID unik online lintas tab. Heartbeat 5 detik, kedaluwarsa 30 detik; bot tidak dihitung. Berbeda dari presence manusia di room. |

### Remi

- Timer 45 detik; race tutupan diperketat melalui snapshot closeMethod, guard bot dan proteksi resolver.
- Pengambilan buangan mempertimbangkan subset kombo dengan joker: dasar murni sendiri sudah turun; J hati + joker di tangan dapat mengambil J wajik + J sekop, memakai J hati/J wajik/joker lalu menutup J sekop.
- Joker boleh memperpanjang 2–3–4 wajik menjadi +20 bila ada dasar murni lain yang independen; kombo itu tidak boleh menjadi dasar bagi jokernya sendiri. 2–3–5 wajik + joker juga dapat menjadi +20 dengan dasar independen.
- Hasil ronde menampilkan satu nilai net TANGAN; kolom positif terpisah yang membingungkan dihapus.
- Celebration lebih besar, judul siapa menutup siapa memakai teks hasil yang sama. Teks dan media memiliki lifecycle bersama.
- BGM berhenti sepanjang lagu tutupan; baru boleh lanjut setelah audio selesai. Autoplay yang ditolak browser menyediakan tombol putar. Keluar menghentikan seluruh media.
- Penonton termasuk dalam alur celebration. Pengujian browser tidak menggantikan cek speaker/autoplay pada perangkat nyata.

## Batasan yang jangan dihilangkan dari handoff

1. Penghapusan fisik room masih digerakkan aplikasi terautentikasi yang terhubung. Ketika semua browser tutup, cleanup berlangsung pada kunjungan berikutnya, bukan jaminan scheduler server tepat detik ke-30/hari ketujuh.
2. Leaderboard menjamin persetujuan dan award sekali; belum membuktikan setiap langkah permainan sah di server dan belum mencegah kolusi banyak akun.
3. Profil adalah dekorasi berdasarkan UID; jangan menulis ulang roster, receipt leaderboard atau snapshot game tersimpan demi mengganti nama.
4. Persetujuan save mencakup manusia offline. Resume memakai readiness baru per percobaan; callback bot lama tidak boleh hidup kembali melewati save epoch.
5. Remi yang disimpan ketika jeda tetap membutuhkan penyelesaian mekanisme jeda sesudah resume; timer lokal mulai lagi.

## PR berikutnya — temuan sumber, bukan klaim reproduksi produksi baru

Pemeriksaan kode pada 2 November menunjukkan item berikut masih perlu ditangani. Audit lama `AUDIT-2026-10-26.md` tidak boleh dipakai sebagai daftar status terkini karena banyak perbaikannya sudah masuk setelah tanggal tersebut.

| Prioritas | Masalah | Arah pekerjaan |
| --- | --- | --- |
| Tinggi | `rooms/.read` masih `true`, sehingga data kartu tersembunyi/deck dalam subtree dapat dibaca langsung. | Pisahkan ringkasan publik dan data privat. Tentukan model kepercayaan host; menyembunyikan kartu dari host yang menjalankan bot/resolver membutuhkan perubahan arsitektur. |
| Tinggi | Rules chat/signals/voice belum konsisten mengikat provider, keanggotaan room dan identitas pengirim. | Uji penyalahgunaan dan batasi tulis sesuai UID/member tanpa memutus signaling sah. |
| Tinggi | `submitPlay` Truf membentuk currentTrick dari snapshot pemanggil lalu update tanpa revisi giliran atomik. | Transaksi/revisi aksi serta pengujian aksi bersamaan dan retry. |
| Sedang | `handleRemiLayDown` belum memeriksa seluruh prasyarat phase/draw/shuffle pada batas handler. | Validasi state otoritatif, bukan hanya tombol UI. |
| Sedang | `handleCangkulSkip` belum memeriksa ulang deck kosong dan kewajiban mengikuti suit. | Tolak skip ilegal di handler dan rules yang sesuai. |
| Sedang | `handleTebakGuess` belum memvalidasi lengkap target sendiri/target aktif/rank permintaan. | Validasi target dan kartu milik pemain, lalu uji input tidak sah. |
| Sedang | Pemetaan username login ke email sintetis berpotensi tabrakan hasil normalisasi. | Audit identitas dan migrasi aman; display name baru tidak menyelesaikan masalah ini. |
| Audit ulang | Pergantian akun lintas tab, pemulihan password, callback resolver bersamaan dan optimasi kombo Remi global. | Reproduksi dahulu; jangan menyatakan seluruhnya bug terkonfirmasi atau sudah selesai. |

Selesaikan pemisahan data kartu dan validasi aksi sebelum menganggap Capsa aman untuk permainan kompetitif.

## Persiapan teknis Capsa

1. Kunci aturan dan contoh pembanding bersama pengguna; simpan versi aturan pada match.
2. Buat engine murni untuk klasifikasi kombo, perbandingan, legal move, pass, akhir ronde dan skor; uji terpisah dari Firebase/UI.
3. Gunakan validasi aksi dengan revision/idempotency, UID/kursi/giliran dan konservasi 52 kartu. Jangan menyalin pola update snapshot lama.
4. Integrasikan auth, host, room lifecycle, bot, profile, online, save/resume dan exit yang sudah ada.
5. Tambahkan game registry, kapasitas, `/capsa` dan `/capsa/KODE`, Hosting rewrites, game-select, render/start/end, sound, cleanup dan aturan fase save.
6. Tambahkan policy spesifik; jangan membuka wildcard akses untuk menghemat implementasi. Rules baseline sekitar 253.831 byte, dekat batas 262.144 byte: ukur lagi sebelum menambah ekspresi.
7. Mulai pengujian tanpa award leaderboard. Integrasi ranking menunggu definisi akhir sesi yang disetujui dan pengujian contract 3.
8. Uji 4 manusia, manusia+bot, refresh/back, disconnect/host handoff, save/resume, duplicate click, dua tab, mobile serta privasi kartu lewat akses database langsung.

## Bukti verifikasi baseline

Verifikasi rilis terakhir mencatat 125 tes Node, 136 tes rules Python dan 18 skenario integrasi client/emulator; pemeriksaan render dan kecocokan rules/aset produksi lulus pada pekerjaan baseline. Ini catatan verifikasi sebelumnya, bukan audit produksi baru pada pembuatan dokumen ini.

Untuk kode baru: `npm test`, `npm run check:render`, suite rules dengan emulator, pemeriksaan generator dan ukuran rules, lalu verifikasi deployment/rules aktif. Tes lokal saja tidak membuktikan produksi sudah terbarui.

## Dokumen rujukan

- [Host](HOST_POLICY.md), [admin](ADMIN_SECURITY.md), [render](RENDER_SECURITY.md).
- [Leaderboard](LEADERBOARD_SECURITY.md), [lifecycle room](ROOM_LIFECYCLE.md), [save/resume](SAVED_GAMES.md).
- [Profil](PLAYER_PROFILES.md), [avatar](PROFILE_AVATARS.md), [online](ONLINE_PLAYERS.md).
- [Aturan Remi](REMI_RULES.md), [joker](REMI_JOKER.md), [celebration](REMI_CELEBRATION.md).

Dokumen ini tidak mengubah game, rules produksi atau data pemain. Capsa belum diimplementasikan dan V4.4 belum dirilis.
