# Capsa V4.4: rilis web dengan browser host

Keputusan pengguna, 3 November 2026: tetap memakai Firebase gratis; browser host dipercaya dan secara teknis dapat membaca seluruh kartu. Tidak menambahkan Cloud Functions, billing atau backend berbayar.

## Runtime

- Akun Firebase Auth online yang sudah ada tetap dipakai pada situs publik. Tidak menyalin akun/checkpoint emulator ke produksi.
- `capsa-host.js` menjalankan engine/bot di browser host. Transaksi RTDB pada `capsaMatches/{code}` menyimpan state, publikasi, permintaan dan hasil aksi bersama.
- Setiap manusia mengirim permintaan immutable di UID sendiri. Identitas diambil dari path dan roster canonical; payload UID/seat/deck/timeout tidak dipercaya. Satu permintaan tertunda per UID; host memproses antrean antar-UID bergantian.
- ID aksi dan revisi mencegah penerapan ganda. Ready independen boleh diterapkan dari revisi terbaru oleh host; kartu tidak otomatis dicoba ulang pada revisi baru. Hasil permintaan disimpan di path UID pemilik, sehingga retry/lost acknowledgement tidak memainkan kartu lagi.
- State lengkap serta roster privat hanya dibaca host aktif. Pemain lain membaca snapshot meja dan tangan UID sendiri. Penonton Capsa belum diaktifkan. Semua data kartu berada di luar `rooms`, yang masih publik pada baseline.
- Model ini melindungi kartu dari pemain non-host, bukan dari host. Host dapat memodifikasi client/hasil; tidak mengklaim verifikasi permainan oleh server tepercaya. Capsa tetap tanpa leaderboard.

## Lifecycle dan simpan

- Timer/bot berjalan saat browser host aktif. Perpindahan host mengikuti membership policy yang ada. Host lama kehilangan akses baca state lengkap setelah handoff.
- Pada handoff atau resume, generation baru membatalkan aksi tertunda dari generasi lama; timer giliran aktif dimulai lagi 30 detik. Kartu dan skor tetap.
- Rules menolak tulisan host maupun permintaan pemain selama `savedGame` ada. Persetujuan save/resume tetap semua manusia asli; readiness resume terpisah dari Ready setiap ronde.
- Free claim room all-bot mengikuti policy canonical yang sudah ada: kartu tetap di kursi yang sama dan UID/roster disesuaikan ke pengganti yang sah. Ini tidak tersedia untuk match tersimpan.
- `capsaCatalog` hanya indeks kode/timestamp tanpa kartu. Setelah room hilang, client terautentikasi boleh membersihkan state dan indeks; rules memeriksa ulang room agar race dengan room baru tidak menghapus state baru. Reuse kode tidak membuka kartu generasi lama.
- Tidak ada scheduler atau proses 24 jam di server. Saat semua client tutup, cleanup terjadi pada kunjungan berikutnya; timer dilanjutkan host aktif sesuai policy pemulihan.

## Lokal dan produksi

Situs publik otomatis memakai adapter browser host dan route `/capsa`, `/capsa/KODE`. Loopback biasa tetap memakai gateway demo untuk pengujian sebelumnya; `?host=1` memilih adapter host di emulator. Keduanya memakai engine yang sama. Rules lokal dihasilkan terpisah; rules produksi melalui `build-room-rules.cjs` + `capsa-policy.cjs`.

Generator memilih indentasi satu spasi ketika hasil dua spasi melewati batas 262.144 byte, tanpa menghapus validasi. Ukuran rilis: 255.840 byte. Dokumen, scripts, tests, logs, work, artifacts/checkpoint serta konfigurasi lokal dikecualikan dari Hosting.

## Verifikasi rilis 3 November 2026

- 173 tes unit/regresi lulus (satu induk suite gateway lokal dijalankan terpisah), render gate lulus.
- Adapter host aktual diuji pada namespace emulator tersendiri: start/roster, tangan sendiri, penolakan parent/private/hand lawan/outsider, empat Ready serentak, 3♦, replay, spoof UID, save freeze, resume, handoff, cleanup dan bot bermain.
- 136 tes rules Python dan 18 skenario integrasi client lama lulus.
- Hosting dan rules aktif sebelum deploy disimpan sebagai rute rollback; rules produksi sebelum rilis cocok dengan baseline workspace.

Status rilis aktual, URL, versi Hosting dan pemeriksaan pascadeploy dicatat pada laporan rilis chat. Tes emulator tidak menggantikan pemeriksaan aset/rules live.

Rilis berhasil pada https://main-kartu-game.web.app/capsa. Versi Hosting `6c7c1ded5dbd497f`; rules live sama dengan rilis (255.840 byte), billing tetap tidak aktif. Enam kelompok smoke test produksi lulus dengan fixture sendiri: route/cache/aset, Auth/privasi tangan, Ready/bermain, save/resume, host handoff dan cleanup. Browser live memverifikasi Ready, Pass, bot, akhir ronde dan penalti. Fixture sintetis dibersihkan.

## Riwayat kartu ronde

Pembaruan 3 November 2026: `roundPlays` menyimpan setiap play sah beserta UID, kursi, nama dan kombinasi kartu. Hanya kartu yang sudah dibuang yang dipublikasikan. Riwayat bertahan ketika semua lawan pass, save/resume dan handoff, lalu direset pada pembagian ronde berikutnya. UI desktop memakai panel samping dan UI ponsel memakai daftar horizontal. Snapshot lama tetap kompatibel; kartu sebelum pembaruan tidak direkonstruksi atau dikaitkan ke pemain secara spekulatif. Host perlu memuat ulang client untuk mulai mencatat.

180 tes unit/regresi lulus (satu suite gateway lokal dilewati pada perintah umum), render gate lulus. Browser 1280px dan 390px tidak memiliki overflow halaman; daftar riwayat dan tangan dapat digeser sendiri.

## Empat area kartu dan jeda pemenang

Pembaruan lanjutan 3 November 2026: seluruh kartu keluar ditampilkan per kursi dalam empat area, masing-masing maksimal 13 kartu dalam dua baris. Tidak ada scroll pada riwayat; desktop memakai empat kolom, ponsel dua kolom. Tangan sendiri juga membungkus ke baris berikutnya. Kombinasi terakhir ditandai emas.

Engine memberi `roundEndUntil = waktu menang + 7000`. Selama jeda, UI menampilkan `[Nama pemain] Win This Round` dan hitung mundur. Host otomatis membagikan ronde berikutnya setelah tujuh detik; manusia tetap wajib Ready. Akhir sesi menampilkan hasil akhir setelah jeda dan tidak otomatis membuat sesi baru. Engine menolak next-round terlalu dini, dan tombol main lagi juga menunggu jeda. Handoff mempertahankan batas waktu; resume game tersimpan memulai ulang jeda tujuh detik, sejalan dengan pemulihan timer giliran. Snapshot lama yang sudah berada pada akhir ronde diberi jeda saat dimuat host baru.

185 tes unit/regresi lulus, satu suite gateway lokal dilewati pada perintah umum, render gate lulus. UI emulator telah diuji dengan 49 kartu keluar (jumlah maksimum ketika tiga lawan menyisakan masing-masing satu kartu), termasuk tampilan kemenangan tujuh detik pada ponsel 390px dan desktop 1280px.

## Fokus meja dan Historis manual

Keputusan pengguna berikutnya, 3 November 2026: riwayat disembunyikan secara default dan dibuka melalui tombol Historis. Meja menampilkan kartu aktif besar di tengah, dengan status empat pemain terpisah. Dialog Historis dapat ditutup dengan Tutup/Escape, mengembalikan fokus ke tombol asal, menampilkan sisa waktu, dan tidak menghentikan giliran. Pergantian ronde dan awal pengumuman pemenang menutup dialog.

Waktu berpikir menjadi 30 detik untuk play/pass dan pilihan bomb; Ready tetap tanpa batas waktu dan jeda pemenang tetap 7 detik. Host meng-upgrade snapshot lama satu kali saat memuat client baru, mempertahankan kartu/skor/riwayat, memperbarui generation, dan memberi giliran aktif 30 detik. Resume dan handoff memakai 30 detik.

## Susunan meja mengikuti Remi

Pembaruan berikutnya 3 November 2026: pemain relatif terhadap pengguna ditempatkan di utara (+2 kursi), barat (+1), timur (+3), dan selatan (pengguna). Kartu tangan serta tombol aksi berada di selatan. Ponsel mempertahankan empat arah dengan panel samping ringkas.

Semua `roundPlays` tampil secara default pada meja tengah, berbaris menurut pemain dan dikelompokkan per kombinasi seperti meja Remi. Batas emas menandai kombinasi terakhir. Tiga lawan pass hanya membuka meja balasan baru; kombinasi yang sudah dimainkan tetap terlihat sampai ronde berganti. Seluruh kartu juga tetap terlihat selama pengumuman pemenang. Historis tetap tersedia sebagai tampilan tambahan. Timer giliran 30 detik dan jeda pemenang 7 detik dipertahankan.

190 tes unit/regresi lulus (satu suite gateway lokal dilewati pada perintah umum), render gate lulus. Browser desktop 1280px dan ponsel 390px memverifikasi posisi empat arah, tampilan semua kombinasi, 48 kartu terbuka tanpa scroll internal, serta kemenangan dengan 49 kartu terbuka.


## Revisi meja dan timer — 7 November 2026

Bagian ini menggantikan perilaku tampilan dan timer lama di atas. Setiap pemain menempati satu posisi utara/barat/timur/selatan dengan ikon profil, nama, sisa kartu dan poin. Kartu keluar pada putaran meja aktif ditempatkan di bawah ikon masing-masing, bukan dikumpulkan dalam baris terpisah di tengah. Pemain yang pass diberi tulisan PASS merah; menunggu giliran dan belum Ready tidak dianggap pass. Seluruh lawan pass membersihkan kartu meja; Historis tetap menyimpan seluruh pembagian.

Durasi per giliran dan pilihan bomb: **45 detik pada ronde 1 dan 2; 30 detik mulai ronde 3**. Engine mengekspor `turnDuration(round)` dan memakainya saat Ready, play, pass, bomb, dan pembagian. Host serta gateway lokal juga memakainya untuk upgrade snapshot, resume, handoff dan penjadwalan bot. Ready tetap tanpa timer; jeda kemenangan tetap tujuh detik.

Validasi: 191 tes lulus, satu suite lokal dilewati; render gate lulus. Fixture browser memeriksa empat ikon, kartu di bawah ikon, PASS merah, dan tidak ada overflow horizontal pada ukuran ponsel. Preview menggunakan data sintetis; bukan pengujian match produksi baru.


## PASS persisten dan popup hasil — 7 November 2026

PASS berlaku sampai pembagian berikutnya. Engine melewati kursi tersebut dalam kedua arah, tidak mereset PASS ketika ada raise atau meja baru, dan membiarkan pemain aktif terakhir membuka hingga habis. Pilihan bomb tetap berlaku. Ready pembagian berikutnya menghapus PASS. Ini menggantikan aturan masuk kembali pada giliran berikutnya.

Tombol Skor dan peringkat tersedia saat bermain. Dialog bergaya modal Truf memakai total terendah sebagai peringkat terbaik dan menjaga seri. Saat satu pemain habis kartu, dialog otomatis sekali per match/ronde menampilkan Ronde x berakhir, nama pemenang, penalti ronde dan total. Semua kartu keluar ronde tetap terlihat saat fase akhir. Label mode memakai Mode : normal atau Mode : Reverse. Dialog bisa ditutup/dibuka kembali dan dibersihkan saat keluar; tidak mengubah skor atau timer server. Jeda tujuh detik menuju Ready berikutnya tetap berlaku.

193 tes lulus, satu suite lokal dilewati; render gate lulus. Fixture browser memverifikasi popup, penutupan/pembukaan ulang dan lebar ponsel 390px tanpa overflow horizontal. Tidak memakai akun atau room produksi untuk pengujian.


## Pilihan game, ukuran panel dan lanjut babak manual — 7 November 2026

Kartu pilihan Capsa memakai struktur `.go-icon`, `.go-body`, judul, meta dan panah yang sama dengan game lain. Pada PC, empat panel pemain berlebar sama (maksimal 240px) dan tinggi mengikuti baris grid yang seragam; kartu tidak dipotong untuk memaksakan tinggi.

Setiap pembagian kini dimulai pemilik 3 wajik dan langkah pembuka wajib memuatnya. Snapshot lama yang belum memainkan kartu dikoreksi pembukanya oleh host/gateway tanpa mengacak ulang tangan. Arah bergantian dan timer 45/30 detik tetap.

Tidak ada lagi pembagian otomatis setelah jeda akhir babak. Manusia selain host mengirim `confirm_round` melalui popup hasil; bot otomatis siap. Host harus menekan tombol lanjut setelah semua manusia lain siap dan jeda minimal selesai. Guard ada di reducer dan adapter, bukan hanya tombol. Suara terikat UID/revisi/match, direset setiap pembagian, serta aman untuk Ready bersamaan. Host lama yang menjadi pemain biasa perlu konfirmasi seperti pemain lain. Penggantian manusia menjadi bot diselaraskan agar gate kesiapan tidak buntu.

Kartu keluar dan skor dipertahankan sampai host melanjutkan. Tutup/Escape hanya menyembunyikan popup; tombol Skor dan peringkat dapat membukanya kembali. Saat babak baru dimulai, popup babak lama ditutup dan manusia kembali Ready sebelum giliran aktif.

Verifikasi: 198 tes lulus, satu suite lokal dilewati pada perintah umum; suite host Firebase emulator dijalankan terpisah dan lulus. Browser fixture desktop memverifikasi empat panel 240px dengan tinggi identik; lima opsi game berukuran identik; lebar ponsel 390px tanpa overflow horizontal. Konfirmasi bersama, penolakan non-host, batas waktu tanpa auto-next, dan pemegang 3 wajik pembagian berikutnya diuji melalui transaksi emulator. Data produksi tidak digunakan untuk fixture.


## Pemisahan babak dan ronde — 7 November 2026

Revisi ini menggantikan penafsiran PASS sepanjang pembagian di atas. Babak = satu pembagian kartu; ronde = putaran meja di dalam babak. PASS bertahan terhadap raise dalam ronde yang sama, tetapi dihapus ketika semua lawan sudah PASS. Pemain terakhir yang mengeluarkan kartu menang ronde dan membuka ronde berikutnya. Ronde berakhir tidak mengubah tangan, discard, skor, riwayat penalti, atau pembagian dan tidak membuka popup hasil babak.

Engine menyimpan nomor ronde meja di `trick` dan pemenang terakhir di `lastTrickWinner`; `round` tetap nomor babak untuk kompatibilitas. UI menampilkan Babak dan Ronde terpisah serta memakai istilah Babak pada hasil dan tabel skor. Babak hanya selesai melalui play sah yang menghabiskan kartu pemain; snapshot terminal dengan kartu pemenang masih tersisa ditolak dan UI tidak mengumumkan hasil publik yang tidak konsisten. Kartu pemain lain boleh masih tersisa.

Host/gateway memperbaiki snapshot lama dengan PASS yang tertinggal pada meja kosong tanpa mengubah kartu atau skor. Urutan pembuka awal babak tetap pemegang 3 wajik, sedangkan pembuka ronde meja berikutnya adalah pemenang ronde sebelumnya. Konfirmasi akhir babak dan host lanjut tetap berlaku. Durasi dan arah yang sudah berlaku per pembagian/babak tidak diubah oleh revisi ini.

Verifikasi: 203 tes lulus, satu suite dilewati pada perintah umum; suite host Firebase emulator dijalankan terpisah dan lulus. Regresi mencakup raise setelah PASS, reset ronde kedua arah, pemenang sebagai pembuka, skor/kartu tetap setelah tiga PASS, koreksi snapshot lama, UI tanpa popup saat ronde selesai, dan aksi kartu terakhir sah sebelum hasil babak.


## Skor negatif dan meja desktop — 7 November 2026

Penalti per babak adalah −10 poin per kartu tersisa. Pemenang babak mendapat pengurangan nol. Peringkat diurutkan dari total tertinggi, dengan seri pada total yang sama. Sesi selesai setelah penilaian jika ada total ≤−300 atau babak ke-15 selesai.

Snapshot lama dikonversi sekali saat host memuat versi baru. Total serta riwayat pengurangan menjadi negatif dan kartu tetap. Hasil akhir lama di batas 250 diperiksa lagi berdasarkan batas baru, sehingga sesi bisa kembali ke konfirmasi babak jika belum mencapai syarat baru. Pemain yang membuka versi baru saat host masih memakai versi lama melihat skor dengan tanda baru dan petunjuk refresh host.

Desktop memakai panel 2×2 yang memenuhi lebar meja, dengan kartu terbuka menyesuaikan ruang tiap panel. Tangan dan tombol aksi memiliki area di bawah dalam tinggi viewport. Ponsel memakai susunan empat arah. Verifikasi browser pada 1280×720, 1366×768 dan 1920×1080 menunjukkan tombol terlihat tanpa scroll halaman. Fixture 1280×720 mencakup 13 kartu tangan dan hasil dengan 49 kartu terbuka. 209 tes lulus, satu dilewati, dan skenario Firebase emulator termasuk konversi skor lama lulus.
