# Main Kartu 4.4 — handoff tampilan

Workspace aktif adalah Main Kartu 4.4. Lima game sudah tersedia di Hosting Main Kartu. Fokus kickoff 4.4 berikutnya adalah merapikan tampilan masing-masing game melalui audit dan preview bertahap.

## Titik mulai

- Produksi: https://main-kartu-game.web.app. Rute game: `/truf`, `/cangkul`, `/remi`, `/tebak`, `/capsa`. Rute room menambahkan `/KODE`.
- Repo: https://github.com/bebekoding/main-kartu-game. Commit terakhir yang terlihat di checkout dan referensi lokal `origin/main` adalah `57baa10`. Checkout memuat perubahan dan file baru yang belum masuk commit, termasuk bagian Capsa dan aset JJK yang sudah tayang. Buat checkpoint Git dari file yang ditinjau sebelum mulai mengubah tampilan.
- Firebase `truf-e3256`, Hosting `main-kartu-game`. Empat game lama masih banyak berada di `truf-multiplayer-v3.html`. Capsa punya engine, host, UI, dan CSS terpisah. Rules RTDB dibuat dengan `node scripts/build-room-rules.cjs`.
- Pada rilis ikon JJK, 216 tes Node dan 12 tes profil di Firebase emulator lulus. Hosting dan rules profil telah dibaca balik sesudah rilis. Angka ini merupakan bukti rilis tersebut, bukan audit baru semua game.

## Capsa saat ini

- Empat kursi dengan bot otomatis. Pembuka setiap babak memegang 3♦. Arah bergantian setiap babak. Timer 45 detik pada babak 1–2, lalu 30 detik.
- Satu babak berisi beberapa ronde. Pass berlaku sampai meja dibuka lagi. Bomb adalah empat rank sama dan satu kartu bebas, dengan pilihan mode Reverse jika bomb menang ronde. Kombo lima kartu ditampilkan dalam susunan sesuai jenisnya.
- Babak berakhir setelah tiga pemain menghabiskan kartu. Poin posisi 1–4 adalah 6, 4, 3, dan 1. Sesi berakhir pada 60 poin atau setelah 15 babak. Sesi lama memakai versi skor yang tersimpan.
- Kartu terakhir tetap disorot. Sisa kartu peringkat keempat muncul di panel pemiliknya. Scoreboard babak muncul otomatis dan bisa diminimalkan. Semua manusia termasuk host harus Ready sebelum host melanjutkan. Scoreboard akhir mengucapkan selamat kepada juara dan memberi pilihan keluar atau memulai sesi baru dengan kode yang sama.
- Historis mengelompokkan kartu per ronde. Bot menggunakan daftar nama Remi. Voice tersedia di meja. Kontrol mic dan signaling telah diuji secara lokal; audio antarpemain di perangkat nyata belum tercatat sebagai verifikasi.

## Perubahan penting sejak handoff V4.3.3

| Area | Hasil / kontrak yang harus dijaga |
| --- | --- |
| Auth dan admin | Password menggunakan Firebase Auth; identitas tetap UID. Admin terikat UID terverifikasi, provider password, email khusus dan batas waktu autentikasi. Jalur hash admin lama tidak memberi kewenangan. |
| Host dan membership | Akun biasa tidak boleh menyusup ke match aktif. Klaim host terbuka hanya jika tidak ada manusia non-bot, termasuk manusia offline. Pemain terdaftar boleh mengajukan perpindahan yang disetujui host lama. Keluar normal memindahkan host ke manusia online yang tersisa. |
| Keamanan render | Sanitasi HTML dinamis dan validasi schema kartu/rank/suit/joker. Nama profil tidak memberi hak akses. |
| Leaderboard | Contract 3: roster manusia asli dan matchId tetap, hasil selesai, suara masing-masing manusia, persetujuan bulat, award atomik sekali saja dengan receipt permanen. Penolakan membatalkan award seluruh pemain. |
| Room kosong | Room biasa tanpa manusia aktif kedaluwarsa setelah 30 detik. Bot dan penonton tidak memperpanjang umur room. Reconnect harus diperiksa sebelum penghapusan. |
| Penonton Remi | Tombol Keluar Tonton dapat digunakan di atas overlay jeda/hasil/celebration; membersihkan listener, timer, voice, media dan URL. |
| Simpan game | Keempat game awal dan Capsa mendukung simpan; satu manusia cukup persetujuannya sendiri, multiplayer harus semua manusia setuju. Request membekukan permainan dan kedaluwarsa dalam 60 detik. |
| Lanjutkan game | Kursi dan snapshot tetap; semua manusia asli harus hadir dan menekan Siap lanjut pada percobaan resume yang sama. Tidak ada konversi kursi/host otomatis saat tersimpan. |
| Retensi simpan | Tujuh hari sejak akses manusia asli; membaca daftar saja, bot dan penonton tidak memperpanjang. Save yang sudah kedaluwarsa tidak boleh dihidupkan kembali. |
| Profil | Nama 4–16 karakter ASCII keyboard tanpa spasi; huruf, angka, simbol boleh dikombinasikan. Nama tidak wajib unik. Login tidak berubah. Pilihan 30 emblem bawaan, termasuk 14 ikon JJK; tanpa upload bebas. |
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

## Kickoff audit tampilan per game

Ini daftar area yang perlu dilihat, bukan daftar cacat yang sudah dipastikan.

| Game | Fokus audit |
| --- | --- |
| Truf | Hierarki bidding dan trump, keterbacaan giliran serta kartu meja, dan alur hasil sesi. |
| Cangkul | Perbedaan visual antara kartu sendiri, cangkulan, dan kartu meja; kejelasan aksi ambil atau skip. |
| Remi | Kepadatan tangan, buangan, kombo dan aksi tutup. Periksa papan skor serta celebration agar informasi penutupan mudah terbaca. |
| Tebak Kartu | Pemilihan target dan kartu, penanda giliran, serta umpan balik setelah tebakan. |
| Capsa | Jarak dan susunan toolbar, keterbacaan kursi dan kombo, serta konsistensi Historis dan Scoreboard. |

Ambil screenshot baseline desktop dan HP untuk lobby, giliran aktif, dan hasil setiap game. Audit tiap game berdasarkan hierarki informasi, konsistensi tombol, keterbacaan kartu, serta elemen dekoratif yang mengganggu. Mulai dari satu game, buat preview untuk ditinjau, lalu pakai pola yang disetujui untuk game berikutnya. Uji tindakan utama, popup, dan kondisi layar sempit sebelum menerbitkan perubahan.

## Temuan keamanan untuk diverifikasi ulang

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

Capsa memisahkan kartu privat dari ringkasan publik, tetapi host browser mengelola state penuh. Audit arsitektur dan keamanan berjalan terpisah dari pekerjaan tampilan.
