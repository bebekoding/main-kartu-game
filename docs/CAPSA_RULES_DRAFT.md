# Capsa: aturan V4.4 dan kontrak engine

Diperbarui 7 November 2026 sesuai revisi pengguna. Engine murni tersedia di `capsa-engine.js`, versi aturan `capsa-v4.4-kickoff-1`. Integrasi web memakai browser host yang dipercaya, sesuai keputusan pengguna 3 November 2026; lihat `CAPSA_HOST.md`. Adapter emulator tetap tersedia untuk pengujian.

## Istilah yang dipakai

- **Babak**: satu pembagian 13 kartu per pemain, selesai hanya setelah satu pemain mengeluarkan seluruh kartunya melalui aksi permainan yang sah.
- **Ronde**: satu putaran meja dalam babak. Setelah semua lawan PASS, pemain terakhir yang mengeluarkan kartu menang dan membuka ronde berikutnya. Semua PASS direset; tidak ada pembagian atau penilaian baru.
- **Sesi**: rangkaian babak sampai ada total ≤−300 atau 15 babak selesai.
- Kompatibilitas kode: `round` dan fase `round_end` tetap berarti babak; `trick` berarti ronde meja. UI memakai istilah pengguna di atas.

## Aturan yang disetujui

1. Nama **Capsa**, tepat empat pemain, mekanisme Banting. Satu pembagian memakai 52 kartu tanpa joker, 13 kartu per pemain.
2. Bentuk permainan: single, pair, atau kombinasi lima kartu. Triple tidak boleh dimainkan mandiri. Kombinasi lima kartu: straight, flush, full house, bomb, straight flush.
3. Balasan wajib sama jumlah kartu dan lebih kuat. **Bomb hanya melawan lima kartu**, tidak melawan single atau pair. Bomb adalah empat kartu rank sama + satu kartu bebas; rank empat kartu menjadi penentu kekuatannya.
4. **Setiap babak/pembagian** dibuka pemilik **3 wajik (3♦)** dengan single 3♦, pair yang memuatnya, atau kombinasi lima kartu sah yang memuatnya. Berlaku untuk babak pertama dan seluruh babak berikutnya; bukan otomatis pemenang sebelumnya.
5. Pada awal **setiap babak**, semua pemain wajib menekan **Ready** sebelum giliran pertama aktif. Kesiapan babak sebelumnya tidak berlaku lagi. **Ready tidak mempunyai batas waktu.**
6. Arah giliran bergantian setiap pembagian: babak pertama searah jarum jam, kedua berlawanan, lalu bergantian. Arah kursi tidak berubah saat meja dibuka ulang atau kekuatan dibalik oleh bomb.
7. Pemain boleh pass walaupun mempunyai balasan. PASS hanya berlaku dalam ronde meja aktif: pemain dilewati meskipun lawan menaikkan kartu. Setelah ketiga lawan PASS, pemain terakhir mengeluarkan kartu menang, membuka ronde baru dan semua pemain kembali boleh bermain. PASS tidak terbawa sepanjang babak.
8. Babak berakhir segera setelah satu tangan habis lewat aksi play yang sah. Semua penalti babak diterapkan bersama: **−10 × jumlah kartu tersisa**. Pemain yang menghabiskan kartu mendapat 0 pengurangan. Total tertinggi mendapat peringkat terbaik.
9. Hasil babak menunggu konfirmasi: manusia selain host menekan Ready; bot otomatis siap. Setelah semua siap, host menekan Lanjut babak berikutnya. Menutup popup tidak mengonfirmasi dan waktu yang lewat tidak memulai babak baru. Setelah pembagian baru, semua manusia tetap Ready untuk memulai giliran.
10. Sesi berakhir setelah penilaian babak bila ada total **≤−300** atau **15 babak** sudah selesai. Total akhir sama mendapat **peringkat bersama**; nomor kursi tidak menjadi pemecah seri.

## Kekuatan normal dan terbalik

- Rank normal, kuat ke lemah: `2 > A > K > Q > J > 10 > 9 > 8 > 7 > 6 > 5 > 4 > 3`.
- Rank terbalik, kuat ke lemah: `3 > 4 > 5 > 6 > 7 > 8 > 9 > 10 > J > Q > K > A > 2`.
- Suit normal: `♠ > ♥ > ♣ > ♦`; terbalik: `♦ > ♣ > ♥ > ♠`.
- Jenis lima kartu normal: `straight flush > bomb > full house > flush > straight`; terbalik: `straight > flush > full house > bomb > straight flush`.
- **Pilih ulang kartu penentu sesuai kekuatan aktif** untuk pair dan flush, bukan mengambil kartu tertinggi normal lalu sekadar membalik hasilnya. Contoh pair 7♠7♦ melawan 7♥7♣: normal pair pertama menang karena ♠; terbalik pair pertama juga menang karena ♦ sekarang terkuat.

### Pembanding per kombinasi

| Bentuk | Pembanding |
| --- | --- |
| Single | Rank aktif, lalu suit aktif. |
| Pair | Rank pair menurut urutan aktif; jika sama, suit terkuat di pair menurut urutan aktif. |
| Straight | Rank kartu ujung straight, lalu suit kartu ujung. Saat terbalik, ujung lebih rendah dan suit terbalik lebih kuat. Ujung tidak diganti menjadi kartu awal straight. |
| Flush | Suit aktif lebih dahulu. Sesama suit memakai rank kartu terkuat dalam flush menurut urutan aktif; saat terbalik, pilih ulang kartunya. |
| Full house | Rank tiga kartu sama menurut urutan aktif; pasangan tidak mengalahkan penentu triple. |
| Bomb | Rank empat kartu sama menurut urutan aktif; kartu kelima tidak mengalahkan penentu empat rank sama. |
| Straight flush | Lima kartu berurutan satu suit; pembanding sesama jenis memakai ujung lalu suit seperti straight. Kedudukan jenisnya mengikuti urutan lima kartu aktif. |

Daftar straight normal dari rendah ke tinggi: **A2345, 23456, 34567, 45678, 56789, 6789-10, 789-10-J, 89-10-J-Q, 9-10-J-Q-K, 10-J-Q-K-A**. `J-Q-K-A-2` dan wrap lain tidak sah. Saat terbalik urutan daftar tersebut dibalik. A2345 berujung **5**, bukan A atau 2; 23456 berujung **6**.

Contoh yang disetujui:
- A2345 dengan ujung 5♣ mengalahkan ujung 5♦ pada kekuatan normal; saat terbalik 5♦ menang. Suit pada notasi ini adalah suit kartu ujung. Lima kartu satu suit tetap diklasifikasikan straight flush.
- 8-9-10-J-Q mengalahkan 2-3-4-5-6 pada keadaan normal karena ujung Q lebih kuat daripada 6; saat terbalik hasilnya berbalik.
- Flush ♠ mengalahkan ♥, ♥ mengalahkan ♣, dan ♣ mengalahkan ♦ pada keadaan normal, tanpa mendahulukan rank lawan.
- Full house 8-8-8-3-3 mengalahkan 7-7-7-K-K pada keadaan normal karena triple 8 lebih kuat.

## Bomb dan pembalikan

- Ketika bomb menjadi permainan terakhir dan ketiga lawan pass, **pemilik bomb** mendapat pilihan membalik kekuatan atau mempertahankan keadaan aktif. Permainan menunggu pilihannya sebelum membuka meja baru.
- Membalik adalah **toggle**: normal menjadi terbalik, terbalik menjadi normal. Bomb berikutnya yang menang meja boleh membalik kembali. Mempertahankan tidak mengubah keadaan aktif.
- Bomb yang dikalahkan tidak memberi pemilik lama pilihan pembalikan.
- Jika bomb langsung menghabiskan tangan, ronde berakhir dan skor diterapkan; tidak ada pilihan pembalikan atau meja baru dalam ronde itu.
- Setiap pembagian baru mengembalikan kekuatan normal; pembalikan tidak mengubah arah giliran kursi.

## Ready dan timeout

- **45 detik per giliran pada babak 1–2, lalu 30 detik mulai babak 3**. Giliran pertama baru mempunyai deadline setelah semua pemain siap.
- Waktu habis saat membalas: otomatis **pass**.
- Waktu habis saat membuka meja: otomatis **single terendah yang legal menurut kekuatan aktif**. Pembuka pertama tetap wajib single 3♦.
- Waktu habis saat pilihan bomb: **pertahankan keadaan aktif**; jika sedang terbalik tetap terbalik, bukan otomatis normal. Pilihan ini memakai durasi babak yang sama: 45 detik pada babak 1–2, 30 detik sesudahnya.
- Aksi manual tepat saat deadline atau sesudahnya ditolak; resolver timeout menangani kelanjutannya. Penerapan timestamp dan transaksi di transport masih perlu diimplementasikan.

Detail teknis engine, bukan aturan baru: deck yang diberikan pemanggil dibagi bergiliran ke empat kursi sebelum Ready agar tangan tersedia untuk render. Manusia selalu mulai belum siap pada setiap ronde; bot siap otomatis. Engine tidak mengganti klik manusia offline. Transport perlu memeriksa koneksi/presence, menghubungkan pergantian host dan bot, serta membekukan timer saat save/resume. Engine sendiri tidak mempunyai layanan koneksi/penyimpanan; gateway lokal menangani adapter emulator.

## Skor dan leaderboard

- Sisa 0, 3, 10, 13 kartu memberi penalti 0, 30, 100, 130.
- Total lama 240 ditambah penalti 20 menjadi 260; sesi berakhir **setelah semua skor** diperbarui.
- Hasil seri dikelompokkan bersama; tidak membuat pemecah seri tersembunyi berdasarkan kursi. Engine mengembalikan kelompok skor tanpa memaksakan penomoran peringkat padat atau kompetisi.
- **Agregasi leaderboard lintas sesi belum diputuskan.** Game awal tidak ranked. Total penalti mentah lintas sesi berpotensi menguntungkan akun yang jarang bermain. Contract 3 tetap berlaku ketika ranking nanti diintegrasikan.
- Tanpa taruhan, dragon/menang otomatis dan penalti tanggung pemain satu kartu tidak ditambahkan oleh engine kickoff.

## Contoh penerimaan dan bukti tes

`tests/capsa-engine.test.cjs` berisi 26 tes engine: klasifikasi; sepuluh straight sah; pembanding normal/terbalik; pemilihan ulang kartu penentu; semua jenis pembuka 3♦; Ready setiap ronde; arah bergantian; pass sukarela/persisten dan skip kedua arah; batas bomb lima kartu; pilihan bomb oleh pemilik; bomb kedua; timeout; skor sekaligus dan batas −300 atau 15 babak; peringkat bersama; UID/kursi/revisi/kepemilikan kartu; replay aksi; serta konservasi 52 kartu.

Empat simulasi sesi penuh deterministik memakai aksi timeout untuk memilih single dan pass. Ini bukti transisi engine, bukan bukti permainan manusia melalui browser/Firebase. Skenario kombo/bomb memakai snapshot pertengahan ronde sintetis dengan konservasi kartu.

Engine memvalidasi UID berdasarkan roster yang diberikan. **Engine tidak memverifikasi Firebase Auth atau menggantikan rules server.** Timestamp, otorisasi manusia/bot/host, commit revision, privasi kartu, save/resume dan UI sudah ditangani adapter lokal sesuai `CAPSA_LOCAL.md`; penerapan produksi masih terpisah. Belum ada klaim Capsa tersedia pada situs online atau aman untuk permainan kompetitif.

## Rujukan dan status

Riset awal tersimpan pada draft terdahulu: [Pagat Big Two](https://www.pagat.com/climbing/bigtwo.html) dan [buku Big2](https://gamers-hq.de/media/pdf/c2/03/7c/Big2_rule_v2-EN.pdf). Keputusan pengguna di atas mengatasi variasi sumber; rujukan tidak digunakan untuk mengganti aturan yang telah disepakati.

Peta integrasi: `CAPSA_KICKOFF_PLAN-v4.4.md`. Kontrak API engine: `CAPSA_ENGINE.md`. Pengembangan berikutnya tetap lokal/emulator tanpa deploy atau migrasi produksi dari kickoff ini.

## Aturan sesi baru: tiga finis dan poin peringkat

Babak berakhir tepat ketika pemain ketiga menghabiskan kartu lewat permainan yang sah. Pemain yang sudah finis dilewati untuk giliran kartu. Ronde meja selesai ketika semua lawan yang masih memegang kartu sudah pass. Jika pemenang ronde sudah finis, kursi aktif berikutnya dalam arah permainan membuka. Pemilik bomb tetap dapat memilih mode setelah lawan aktif pass, kecuali bomb itu langsung mengakhiri babak.

Urutan finis memberi 6, 4, 3, dan 1 poin. Peringkat sesi diurutkan dari total tertinggi. Sesi berakhir ketika ada total mencapai 60 atau babak ke-15 selesai. Sesi baru memakai skema ini. Sesi lama yang sedang berjalan atau disimpan tetap dengan skema lama karena urutan finis kedua dan ketiga belum pernah dicatat.

Pada hasil, meja berhenti di permainan terakhir dan semua pemain room dapat melihat seluruh sisa kartu peringkat 4. Kartu itu tetap privat sebelum hasil. Skor dan peringkat bisa dibuka tanpa mengganggu tampilan meja secara otomatis. Semua pemain manusia, termasuk host, harus menekan Ready untuk lanjut. Bot otomatis siap. Sesudah jeda tujuh detik dan semua siap, host dapat melanjutkan. Pembagian berikutnya langsung dimulai dari pemegang 3♦.

Tombol Voice, Mic Aktif/Mati, dan Keluar Voice tersedia di meja Capsa. Kontrol memakai Voice room yang sama dengan lobby, jadi koneksi yang sudah aktif tetap tersedia saat berpindah ke meja.
