---
name: main-kartu-design
description: Design system & UI principles untuk Main Kartu (multiplayer card game). Forest palette dengan gold accent, dark theme lock, glassmorphism scenic, mobile-first compact, no em-dash. Adopt sebelum mengubah CSS/HTML user-facing.
---

# Main Kartu — Design System & Principles

> Web multiplayer card game (Truf / Cangkul / Remi / Tebak Kartu). Single-file HTML + Firebase Realtime Database. Dark theme dengan glassmorphism scenic backdrop untuk auth/lobby/admin views; deep green felt untuk game views.

Diadopsi dari **taste-skill** framework ([tasteskill.dev](https://www.tasteskill.dev)) dengan adaptasi ke konteks game card playful.

---

## 0. BRIEF READ

Setiap perubahan UI dimulai dengan one-liner design read:

> **"Reading this as: card game [feature] untuk [audience], dengan [vibe] language, menggunakan [pattern] dari design system."**

Audience: pemain casual Indonesia, mobile-first. Vibe: classy-tavern (kombinasi Forest palette + cartoon scenic backdrop). Tone: playful brand voice (emoji OK).

---

## 1. DIALS (defaults untuk project ini)

* `DESIGN_VARIANCE: 6` — moderately varied; auth/lobby pakai glassmorphism, game views pakai functional grid
* `MOTION_INTENSITY: 4` — restrained; pulse animations untuk attention (Tebak button, new card), no scroll-jacking
* `VISUAL_DENSITY: 5` — moderate; game views packed (kartu, log, jadi panel, hand), lobby/login spacious

---

## 2. COLOR (taste-skill: Color Consistency Lock)

**Palette: Forest** (premium-consumer compliant: tidak default beige+brass).

| Token | Value | Use |
|-------|-------|-----|
| `--felt-dark` | `#0a2f23` | Deep background (game view base) |
| `--felt` | `#11402f` | Mid felt |
| `--felt-light` | `#1a5a42` | Surface highlights |
| `--gold` | `#d4a84b` | Primary accent (CTAs, borders, brand) |
| `--gold-bright` | `#f0c668` | Hover/active states |
| `--cream` | `#f4ead5` | Body text on dark |
| `--ivory` | `#faf6ec` | Card faces |
| `--ink` | `#1a1612` | Text on gold buttons |
| `--red` | `#b3252b` | Danger/leave only |
| `--green` | `#6fcf97` | Success/spectator only |

**Aturan:**
- 1 accent (gold) di seluruh page. Spectator pakai green untuk semantik state, bukan dekorasi.
- Warna lain (red, green) cuma untuk SEMANTIC state — bukan dekorasi.
- Per-game accent (Tebak ungu, Cangkul hijau, Remi merah) dibatasi ke game-option cards & status badges.
- Dark mode locked. Tidak ada section yang flip ke light mode mid-page.

---

## 3. SHAPE (taste-skill: Shape Consistency Lock)

Pakai CSS variables ini, jangan invent ad-hoc:

```css
--radius-pill:   999px;  /* interactive: button, pill input */
--radius-card:    16px;  /* card-box, modal-card */
--radius-panel:   12px;  /* opp-box, jadi panel */
--radius-control:  8px;  /* badges, small btn */
--radius-tiny:     4px;  /* indicator chip */
```

Border: `1.5px` solid untuk emphasis (auth card, glass), `1px` untuk subdivision.

---

## 4. TYPOGRAPHY

**Font stack tokens** (CSS variables di `:root`):

```css
--font-display: 'Playfair Display', 'Newsreader', Georgia, serif;
--font-serif:   'Newsreader', 'Playfair Display', Georgia, serif;
--font-sans:    'Bricolage Grotesque', system-ui, -apple-system, sans-serif;
--font-mono:    'JetBrains Mono', ui-monospace, 'SF Mono', monospace;
```

**Aturan pakai:**

| Use | Token | Weight | Style |
|-----|-------|--------|-------|
| Brand logo "Main Kartu" | `--font-display` | 800 | italic |
| Game title (TRUF/REMI/dst) | `--font-display` | 800 | italic |
| Section heading (Pilih Permainan, Lobby) | `--font-display` | 700 | italic |
| Card-box h2 (Masuk via mobile, etc) | `--font-display` | 700 | italic |
| Auth title "Masuk" desktop | `--font-sans` | 700 | normal |
| Auth body | `--font-sans` | 400-500 | normal |
| Tagline / subtitle uppercase | `--font-sans` | 500 | normal |
| Topbar info / chat / data | `--font-mono` | 400-500 | normal |
| In-game status text | `--font-mono` | 400 | normal |

**Pilihan kenapa fonts ini:**
- **Playfair Display** (display): bolder strokes & magazine feel; pengganti Cormorant Garamond yang banyak dipakai LLM
- **Bricolage Grotesque** (sans): modern variable font dengan optical sizing; pengganti Inter (yang dianggap default AI)
- **Newsreader** (serif alternative): editorial serif dengan kontras lebih agresif
- **JetBrains Mono** (mono): tetap dipakai untuk data karena tech feel sesuai

**Aturan italic descender clearance** (taste-skill mandatory): untuk italic Playfair/Newsreader dengan huruf `g j p q y`:
- `line-height: ≥ 1.05` di display, `≥ 1.1` di body
- `padding-bottom: ≥ 3px` di wrapper agar tail 'g' tidak terpotong

**Letter-spacing**: hindari spread-out `0.3em` di display italic (klasik AI tell). Pakai `-0.015em` ke `-0.005em` untuk tight, Playfair butuh tracking ketat.

**Emoji policy:** allowed (game playful) tapi sparingly + with intent. Gunakan untuk semantic state (✅❌🎉🃏🔮), bukan random dekorasi.

---

## 5. SHAPE COMPONENTS

**Auth/Lobby/Admin (scenic glassmorphism v2 — "edge-lit glass"):**
- backdrop: scenic image (login-deco-1.jpg untuk auth, login-deco-2.jpg untuk lobby/admin) + radial gradient overlay + Ken Burns drift 46s (transform scale, reduced-motion gated)
- ambience: `.auth-ambient` ember dust 12 partikel emas naik (CSS only, nth-child variasi, hidden ≤700px & reduced-motion)
- card: noise SVG turbulence 0.045 + `linear-gradient(135deg, rgba(255,255,255,0.11) → rgba(212,168,75,0.05))`, edge-lit ring via `::before` mask-composite (gradient putih→gold), sheen sweep periodik via `::after` (11s, idle sebagian besar siklus), shadow berlapis (ambient + contact + gold under-glow), entrance `scenic-card-in` 0.55s
- 3D tilt: `--tilt-x/--tilt-y` CSS vars + `initScenicTilt()` JS (pointer:fine only, max ~2.2deg, logo parallax berlawanan); `.game-option` punya tilt lokal per-tile via inline transform
- input: pill (radius `--radius-pill`), scrim `bg: rgba(10,24,18,0.35)` + `inset 0 2px 6px` depth; focus = gold halo (bukan putih)
- CTA: beveled (gradient terang→gelap + inset highlight atas + inset shade bawah); `.btn.primary` gold beveled, `.auth-submit` ivory beveled
- logo: gold metalik via `background-clip: text` + `drop-shadow` (BUKAN text-shadow, bocor di fill transparan) + ornament hairline `::after` (◆ + garis emas)
- game-option: ikon dalam koin beveled 68px (radial highlight + inset bevel), watermark suit 120px `::after` per-game, glow hover per-game via `--go-glow`, stagger entrance 0.06-0.27s

**Game views (functional):**
- Topbar: solid felt with gold border
- Player slot: glass panel with gold border, radius `--radius-panel`
- Card faces: ivory bg with rank/suit, JPG/PNG art di tengah
- Card backs: `repeating-linear-gradient` gold over deep red + `✦` symbol

**Modals:**
- overlay: `bg: rgba(5,18,14,0.78)` + `backdrop-filter: blur(6px)`
- card: `linear-gradient(135deg, #1c4a37, #143628)` + gold border 2px

---

## 6. MOTION

- **Easing:** `cubic-bezier(0.34, 1.56, 0.64, 1)` untuk lift/bounce (subtle overshoot), `ease-in-out` untuk pulses
- **Duration:** 0.15s untuk hover, 0.2-0.3s untuk transition, 1-2s untuk attention pulse
- **Reduced motion:** belum implement `prefers-reduced-motion`. Future: gate semua infinite pulses.

Animation guidelines (taste-skill: Motion Motivated):
- Pulse glow di Tebak button = "this is YOUR turn"
- Gold outline di new card = "this card was just received"
- Hover lift -3px = tactile feedback
- Jangan tambah animasi kalau tidak komunikasi state/feedback/hierarchy

---

## 7. COPY (taste-skill: Em-dash ban + Copy self-audit)

**ZERO em-dash (`—`) di user-facing text.** Gunakan:
- `:` untuk explanation (`Giliran Anda: ambil 1 kartu`)
- `·` untuk separator atau empty value indicator
- `,` untuk continuation
- Hapus jika redundan

**Bahasa:** Indonesian conversational. Tidak gunakan English mid-sentence kecuali brand/game name (Truf, Bidding, Trump dapat tetap English).

**Tone:** Casual playful. Boleh canda (admin password hint, lupa password message).

**Banned:**
- Fake-precise numbers tanpa basis (`92%`, `4.1×`)
- AI-hallucinated phrases ("elegant nothing", forced metaphors)
- Tagline panjang di bawah CTA

---

## 8. LAYOUT (taste-skill: Layout Discipline)

**Hero (auth/lobby/game-select):**
- max 4 elemen di hero: logo + title + form/cards + tagline
- Tagline kosong di authView (dihapus untuk clean look)

**Mobile-first compact (game views):**
- viewport ≤ 700px → auto-mobile via `@media` (tidak bergantung body class)
- Tebak Kartu support 4-6 player dengan opp-box `min-width: 58px` (50px di ≤380px)
- Hand pakai `overflow-x: auto` sebagai safety net untuk 10+ kartu
- Big CTA button (`tebak-big-tebak-btn`) di kolom kiri, height match self-area

**Desktop:**
- Game views: log sidebar 280px + board flex-1
- Card sizes: 120×168 (Tebak), 78×110 (Remi)

---

## 9. STATE PATTERNS (taste-skill: Interactive UI States)

Setiap interactive component punya:
- **Default**
- **Hover** (lift / glow / border emphasis)
- **Active** (translateY +1px or scale)
- **Disabled** (gradient grey, opacity 0.4, cursor not-allowed)
- **Loading** (`setBtnLoading()` helper)
- **Empty** (helper text + dashed border atau placeholder card)
- **Error** (inline form atau toast)

**Spectator mode:** state khusus, hide interactive elements (`.spectator-mode` class) + show badge fixed top.

---

## 10. ADMIN

- Admin memakai akun Firebase Authentication khusus yang sudah ada. Jangan simpan password/hash admin di kode atau dokumentasi.
- Hak admin terikat UID di `config/adminUid`, provider password, email akun khusus, dan batas waktu `config/adminAuthAfter`.
- Konfigurasi UID dan batas waktu hanya diubah lewat akses pemilik project, bukan oleh browser. `adminSessions` lama tidak memberi izin.
- Admin panel: tab Room Aktif dan Pengguna, tombol Ganti Password, spectate, hapus room, manual cleanup.
- Mengganti password admin memakai Firebase Auth; tidak ada hash tambahan yang harus disamakan.

---

## 11. INFRASTRUCTURE

- **Realtime DB:** Firebase RTDB di `asia-southeast1`
- **Auto-cleanup room:** room tanpa human player atau dengan semua human stale > 5 menit auto-deleted (tiap 1 menit dari client logged-in)
- **Heartbeat:** `lastSeen` updated tiap beberapa detik; stale > 12s = away, > 42s = disconnected
- **Deploy:** `cd /Users/960075/Documents/truf-game && firebase deploy --only hosting`

---

## 12. ASSETS

- `login-deco-1.jpg` (206KB) — scenic backdrop untuk login auth screen
- `login-deco-2.jpg` (242KB) — scenic backdrop untuk lobby + admin
- Asli PNG 1.9MB & 2MB → JPG quality 75 width 1280 (saving 89%)
- BGM: lobby-mbg.mp3, 2.mp3 (game), 5.mp3 (tense), end-music.mp3
- SFX: 4.mp3 (kartu), ceki.mp3 (3× cosmetic), close-celebration.mp4, close-deck.gif + mp3

---

## 13. PRE-FLIGHT CHECKLIST (sebelum commit/deploy)

Cek sebelum claim "done":

- [ ] Em-dash sweep: zero `—` di string user-facing
- [ ] Color: 1 accent (gold) di view; warna lain semantic-only
- [ ] Shape: pakai `--radius-*` tokens, tidak invent ad-hoc
- [ ] Typography: italic dengan descender punya `line-height ≥ 1.1`
- [ ] Form contrast: input pass WCAG AA (scrim atau bg)
- [ ] CTA: text 1 line di desktop, no wrap
- [ ] Mobile compact: viewport ≤ 700px tetap usable (no overflow no scroll-trap)
- [ ] Modal: ada `.show` toggle yang clean (tidak nyangkut saat exit)
- [ ] Spectator-safe: jika fitur baru affect game view, pertimbangkan `isSpectator` flag
- [ ] Empty/loading state: ada placeholder UI
- [ ] Test 2 browser: 1 sebagai player, 1 sebagai spectator
- [ ] Console: tidak ada error baru
- [ ] Deploy: `firebase deploy --only hosting` sukses

---

## 14. CONTEXT FILES

Lainnya yang perlu dirujuk saat develop:
- `truf-multiplayer-v3.html` — single-file app
- `firebase.json` — hosting + database config
- `database.rules.json` — RTDB security rules (rooms listable di root, accounts public)
- `/Users/960075/.claude/projects/-Users-960075/memory/MEMORY.md` — agent memory index

Memory files:
- `project_main_kartu_overview.md`
- `project_main_kartu_deploy.md`
- `project_main_kartu_remi_rules.md`
- `project_main_kartu_constants.md`

---

> **Penting:** SKILL.md ini adalah kontrak design. Future agent harus baca ini sebelum ubah UI. Update SKILL.md kalau prinsip baru ditemukan dan dibatalkan.
