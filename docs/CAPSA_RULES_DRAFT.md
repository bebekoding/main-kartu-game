# Capsa Banting — draft verifikasi V4.4

Ditinjau 2 November 2026. Pengguna sudah menetapkan **Capsa Banting, 4 pemain**. Aturan berikut belum disetujui dan belum diimplementasikan.

## Ringkasan rujukan

Empat pemain mendapat 13 kartu dari 52 kartu tanpa joker. Rank naik 3–4–5–6–7–8–9–10–J–Q–K–A–2; suit naik wajik–keriting–hati–sekop. Mainkan single, pair, triple, atau lima kartu: straight < flush < full house < four of a kind + satu kartu < straight flush. Balasan harus sama jumlah kartunya. [Pagat, aturan Big Two](https://www.pagat.com/climbing/bigtwo.html).

Pass diperbolehkan meskipun bisa melawan; boleh bermain lagi pada giliran berikut. Tiga pass beruntun membuka putaran meja baru, dipimpin pemain terakhir. Ronde berhenti begitu satu tangan habis. [Buku aturan Big2, hlm. 3–8](https://gamers-hq.de/media/pdf/c2/03/7c/Big2_rule_v2-EN.pdf).

## Pilihan penting untuk diverifikasi

| Topik | Temuan dan usulan |
| --- | --- |
| Arah / pembuka | Pagat mencatat variasi Indonesia searah jarum jam, sesi 10 ronde: ronde pertama wajib memuat 3 wajik, selanjutnya pemenang sebelumnya membuka. Usulan: gunakan ini. |
| Straight | Pagat: A2345 paling rendah, kemudian 23456; 10JQKA tertinggi. Buku Big2 justru menempatkan A2345 tertinggi. Usulan: pilih urutan Pagat. |
| Flush | Pagat mengutamakan suit; buku Big2 mengutamakan rank. Usulan: suit dahulu, lalu rank kartu tertinggi. |
| Penalti | Pagat: sisa 1–9 ×1, 10–12 ×2, 13 ×3. Buku Big2 memulai ×2 pada 9 kartu. Usulan: ambang Pagat. |

Perbedaan ini memang variasi sumber, bukan aturan tunggal yang sudah pasti. [Pagat, variasi dan skor](https://www.pagat.com/climbing/bigtwo.html), [buku Big2](https://gamers-hq.de/media/pdf/c2/03/7c/Big2_rule_v2-EN.pdf).

## Keputusan produk yang diusulkan, bukan aturan baku

- Tanpa taruhan uang; skor game terpisah dari award leaderboard.
- Pemenang memperoleh jumlah penalti ketiga lawan agar total perubahan skor ronde nol.
- Tidak ada bomb lintas jumlah kartu, dragon/menang otomatis atau penalti tanggung pemain satu kartu pada versi awal.
- Timer usulan 45 detik. Timeout saat merespons menjadi pass; saat wajib membuka, engine memilih langkah legal terendah. Ini perlu persetujuan pengguna.
- Seusai 10 ronde, skor akumulasi menentukan peringkat. Skor sama tetap seri; jangan memakai nomor kursi sebagai pemecah seri leaderboard.
- Match awal belum ranked sampai kebijakan hasil seri, persetujuan manusia dan eligibility selesai ditentukan.

## Contoh penerimaan draft

Contoh berikut mengikuti pilihan draft, bukan jaminan bahwa semua komunitas memainkan aturan yang sama.

- Sisa lawan 3, 10 dan 13 kartu menghasilkan penalti 3, 20, 39; usulan skor pemenang +62.

## Sebelum implementasi

Pengguna perlu memverifikasi pembuka ronde selanjutnya, arah giliran, ranking straight/flush, ambang penalti, bonus/tanggung, panjang sesi dan timer. Setelah itu lengkapi spesifikasi tie-break seluruh kombo, state machine dan skenario seri. Jangan menambahkan fitur Capsa ke produksi hanya berdasarkan draft ini.
