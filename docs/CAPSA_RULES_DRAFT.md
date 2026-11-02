# Capsa Banting — draft verifikasi V4.4

Ditinjau 2 November 2026. **Capsa Banting, 4 pemain**. Enam penyesuaian pengguna di bawah menggantikan usulan awal yang bertentangan. Detail yang masih ambigu ditandai terbuka. Belum diimplementasikan.

## Penyesuaian pengguna — dasar implementasi berikutnya

1. **Triple dihapus.** Tiga kartu rank sama tidak boleh dimainkan sebagai langkah tersendiri. Full house tetap termasuk kombinasi lima kartu yang disebut pengguna.
2. **Bomb:** empat kartu rank sama + satu kartu bebas, misalnya 7 sekop/hati/wajik/keriting + K hati. Setelah bomb tidak dilawan dan memenangkan meja, pemainnya boleh memilih membalik kekuatan kartu dan jenis kombo atau mempertahankannya. Pembalikan berlaku hingga ronde (satu pembagian kartu) berakhir; pembagian berikutnya kembali normal. Pilihan tidak boleh diputuskan oleh pemain lain.
3. **Pass tidak mengakhiri ronde.** Setelah semua lawan pass, pemain terakhir yang mengeluarkan kartu membuka meja baru dan permainan tetap berjalan. Ronde hanya berakhir saat satu pemain kehabisan kartu. Sesi adalah rangkaian ronde sampai batas 250 tercapai.
4. **Skor sisa kartu ×10.** Pembacaan kerja: jumlah kartu tersisa dikali 10, bukan jumlah rank kartu. Tidak memakai pengganda sisa kartu versi rujukan internet. Konfirmasikan bila pengguna bermaksud nilai rank.
5. **Poin lebih rendah → peringkat lebih tinggi**, termasuk leaderboard Capsa. Jangan memakai konvensi “poin terbesar terbaik” game lain.
6. **Sesi berakhir saat ada pemain mencapai 250.** Implementasi harus memakai `>= 250`, karena skor bertambah kelipatan 10 dan dapat melampaui 250. Evaluasi setelah skor akhir pembagian kartu diterapkan ke semua pemain secara atomik. Bukan lagi sesi tetap 10 ronde.

### Urutan normal dan terbalik

- Normal, kuat → lemah: `2 > A > K > Q > J > 10 > 9 > 8 > 7 > 6 > 5 > 4 > 3`.
- Terbalik sesuai contoh pengguna: `3 > 4 > 5 > 6 > 7 > 8 > 9 > 10 > J > Q > K > A > 2`.
- Jenis kombo normal, kuat → lemah: straight flush > bomb > full house > flush > straight.
- Jenis kombo terbalik, kuat → lemah: straight > flush > full house > bomb > straight flush.
- Menunggu pilihan pemilik bomb sebelum membuka meja baru. Jika bomb langsung menghabiskan tangan, ronde sudah selesai sehingga tidak ada giliran baru dalam ronde itu.
- Bila bomb lain menang ketika urutan sudah terbalik, arti pilihan “memutar” (toggle kembali atau tetap terbalik) masih perlu ditentukan; jangan mengasumsikan durasinya melewati akhir ronde.
- Pembalikan urutan suit dan ranking antar-straight belum ditentukan. Tidak menyimpulkan giliran kursi ikut berbalik: contoh pengguna membahas kekuatan kartu dan kombo.

### Contoh skor yang menggantikan draft lama

- Sisa 0, 3, 10 dan 13 kartu: tambahan skor masing-masing **0, 30, 100, 130**.
- Pemenang tidak menerima bonus positif hasil penjumlahan penalti lawan; usulan zero-sum lama dicabut.
- Total lama 240 dengan sisa 2 kartu menjadi 260: sesi berakhir. Peringkat diurutkan dari total terendah setelah seluruh skor diperbarui.
- Skor sama: kebijakan seri belum disepakati; jangan menjadikan nomor kursi pemecah seri tersembunyi.

### Implikasi leaderboard

Pengguna menetapkan orientasi peringkat Capsa berdasarkan poin terendah. Skema agregasi lintas sesi (total, rata-rata, atau hasil sesi) belum ditentukan: total penalti mentah dapat menguntungkan akun dengan sedikit pertandingan. Pisahkan skor sesi dari award lintas sesi dan minta keputusan produk sebelum mengaktifkan ranking Capsa. Contract 3 tetap mensyaratkan persetujuan manusia dan award sekali saja.

## Ringkasan rujukan

Rujukan awal, hanya berlaku sejauh tidak diganti penyesuaian pengguna: 13 kartu per pemain dari 52 kartu tanpa joker; suit naik wajik–keriting–hati–sekop; balasan sama jumlah kartu. [Pagat, aturan Big Two](https://www.pagat.com/climbing/bigtwo.html).

Rujukan buku mengizinkan pass sukarela serta bermain kembali pada giliran berikutnya. Pengguna sudah mengonfirmasi buka meja baru setelah semua lawan pass, sambil melanjutkan ronde. [Buku aturan Big2, hlm. 3–8](https://gamers-hq.de/media/pdf/c2/03/7c/Big2_rule_v2-EN.pdf).

## Pilihan penting untuk diverifikasi

| Topik | Temuan dan usulan |
| --- | --- |
| Arah / pembuka | Usulan awal: searah jarum jam, pertama wajib memuat 3 wajik, selanjutnya pemenang sebelumnya membuka. Belum disahkan; sesi tetap 10 ronde sudah diganti batas 250. |
| Straight | Pagat: A2345 paling rendah, kemudian 23456; 10JQKA tertinggi. Buku Big2 justru menempatkan A2345 tertinggi. Usulan: pilih urutan Pagat. |
| Flush | Pagat mengutamakan suit; buku Big2 mengutamakan rank. Usulan: suit dahulu, lalu rank kartu tertinggi. |
| Penalti | Diganti pengguna: sisa kartu ×10, tanpa ambang pengganda dari sumber. |

Perbedaan ini memang variasi sumber, bukan aturan tunggal yang sudah pasti. [Pagat, variasi dan skor](https://www.pagat.com/climbing/bigtwo.html), [buku Big2](https://gamers-hq.de/media/pdf/c2/03/7c/Big2_rule_v2-EN.pdf).

## Keputusan produk yang diusulkan, bukan aturan baku

- Tanpa taruhan uang; skor game terpisah dari award leaderboard.
- Tidak ada dragon/menang otomatis atau penalti tanggung pemain satu kartu pada usulan awal. Bomb kini mengikuti penyesuaian pengguna di atas; kemampuan melawan jumlah kartu berbeda belum disahkan.
- Timer usulan 45 detik. Timeout saat merespons menjadi pass; saat wajib membuka, engine memilih langkah legal terendah. Ini perlu persetujuan pengguna.
- Batas sesi 250 dan arah skor terendah sudah ditetapkan pengguna. Kebijakan seri masih terbuka.
- Match awal belum ranked sampai kebijakan hasil seri, persetujuan manusia dan eligibility selesai ditentukan.

## Contoh penerimaan draft

Contoh berikut mengikuti pilihan draft, bukan jaminan bahwa semua komunitas memainkan aturan yang sama.

- Contoh skor terbaru ada pada bagian penyesuaian pengguna; contoh lama +62 tidak berlaku.

## Sebelum implementasi

Definisi bomb, pemicu/durasi pembalikan dan buka meja setelah pass sudah dikonfirmasi pengguna. Sisa detail: bomb kedua saat terbalik, pembuka, suit/straight saat terbalik, timer, seri dan agregasi leaderboard. Skor ×10 dan batas 250 menggantikan usulan skor/panjang sesi sebelumnya. Lengkapi state machine dan tes setelah keputusan ini jelas; jangan menerapkan detail ambigu ke produksi.
