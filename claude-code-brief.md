# Project Brief: TRUF Card Game — Multiplayer Migration

Hi Claude Code. I'm continuing a project that was started in claude.ai web chat. Here's the full context so you can pick up where we left off.

## Project Summary

I'm building a web-based 4-player trick-taking card game called **TRUF** (Indonesian card game similar to Spades/Bridge). Single-player vs 3 bots version is **complete and working**. Now migrating to **multiplayer** using Firebase Realtime Database, with bot fallback for empty seats.

**Final hosting target:** Firebase Hosting (was originally considering Netlify but decided on Firebase).

## My Setup

- **OS:** macOS
- **Editor:** Sublime Text
- **Terminal experience:** Beginner. I prefer you run commands for me and explain what each one does.
- **Firebase:** Project created (project ID likely `truf-e3256` based on prior config), Realtime Database enabled in `asia-southeast1` region, Security Rules already set for `rooms/$roomCode` pattern.
- **Firebase Hosting:** NOT yet set up. Need to install Firebase CLI and initialize.

## Game Rules (Indonesian terms)

4 players, 52 cards (no joker), 13 cards each.

**Suit terms:** Sekop (♠ Spade), Love (♥ Heart - unchanged), Keriting (♣ Club), Wajik (♦ Diamond)
**Suit hierarchy for tie-break:** ♠ > ♥ > ♣ > ♦

**Bidding (komitmen):**
- Each player bids ONCE in clockwise order using cards from their hand
- Bid value: A=1, 2-10=face value, **J=Q=K=0** (all face cards = 0 points)
- Can bid with 1 card OR 2 cards (if 2 cards, total must be ≥ 6)
- If 2 cards same suit → that suit becomes trump
- If 2 cards different suit → game plays NO TRUMP (NT)
- Highest bid wins, ties broken by suit hierarchy
- Each player's bid value becomes their commitment for the round

**Bidding flow:**
1. Each player picks 1-2 cards as bid (still face-down on table)
2. After all 4 players bid, all bid cards revealed simultaneously
3. All 4 players must press "Confirm" button before play starts
4. Winner of bid sees their card returned to hand, plays first

**Play phase:**
- Bid winner leads first trick
- Follow suit if possible; if not, free to trump or discard
- **Trump cards played face-down** (hidden) — only revealed when trick is complete
- Highest trump > highest of lead suit > others
- Winner of trick leads next, clockwise order otherwise
- 13 tricks per session

**Scoring (per session):**
- Total commitment > 13 → "main atas" (over)
- Total commitment < 13 → "main bawah" (under)
- Total = 13 → bid winner chooses naik (raise) or turun (lower) X points; all commitments shift by ±X (min 0)
- Match commitment: +commitment points (or +5 if commitment was 0)
- Miss in "main atas": over by N tricks = -N; under by N = -2N
- Miss in "main bawah": under by N = -N; over by N = -2N
- Scores accumulate across sessions until tournament ends

**Clockwise order:** South (you) → West → North → East → back to South

## Files in This Project

I'll attach files (or paste them) when you ask. Key files:

1. **`truf-game.html`** — Single-player complete version with 3 AI bots. Working perfectly. This contains the full game logic that we need to PORT to multiplayer.

2. **`truf-multiplayer.html`** (v1, milestone 1 — DONE) — Lobby with room create/join, presence detection via Firebase `onDisconnect`. Tested and working.

3. **`truf-multiplayer-v2.html`** (milestone 2a — DONE but not deployed) — Adds: host clicks "Mulai" → bots fill empty seats → 52 cards dealt → each client renders own hand face-up, others face-down. **Has issue:** Chrome on Mac blocks Firebase when loading via `file://` URL (security policy). Needs proper hosting to test.

## Firebase Config (paste from current files)

I have my Firebase config object embedded in the HTML files. You'll find it under the comment `// === PASTE FIREBASE CONFIG DI SINI ===`. The project ID is `truf-e3256` (or similar).

## Milestones Plan

- ✅ **Milestone 1:** Lobby + room create/join + presence
- ✅ **Milestone 2a:** Start game + deal cards + render hands per perspective
- ⏳ **Milestone 2b (NEXT):** Bidding turn sync — each player bids in clockwise order, cards face-down on table, then reveal phase + 4 confirmations
- ⏳ **Milestone 2c:** Tie decision (total=13) modal sync
- ⏳ **Milestone 2d:** Trump display + bidding result popup
- ⏳ **Milestone 3:** Play phase — play cards in order, trump hidden, trick resolution, scoring
- ⏳ **Milestone 4:** Bot AI logic (port from single-player), bot fallback when player disconnects 30s, presence detection
- ⏳ **Milestone 5:** Polish, deploy to Firebase Hosting

## Immediate Goals (Pick Up Where We Left Off)

1. **Set up Firebase Hosting** — install Firebase CLI on my Mac, init project, deploy current `truf-multiplayer-v2.html` so I can test it via `https://...` URL (instead of `file://` which Chrome blocks).

2. **Test milestone 2a** end-to-end. I should be able to: open URL, create room, see 1 human + 3 bots seats fill, click "Mulai", see my 13 cards face-up and 3 opponents with 13 face-down cards each.

3. **Begin milestone 2b** — bidding turn sync. This is the biggest milestone. Strategy: each player has a "bid action" that writes to Firebase, host (or each client) listens and updates UI. Reveal phase happens after 4th bid. Bots auto-bid for empty seats (just identity for now, no AI yet).

## Important Design Decisions Already Made

- **Anonymous play** — players just enter a nickname per tab, no Google sign-in
- **Private rooms via 4-char code** (no public lobby or matchmaking)
- **Bots fill empty seats automatically** when host clicks start
- **Bot logic runs in HOST client browser** (Firebase doesn't run server code in free tier)
- **Disconnect handling:** if player disconnects 30s, slot becomes bot
- **Single-file HTML** (no build system, no React) — keep it simple
- **Architecture:** All game state is in Firebase. Each client subscribes via `onValue` and renders accordingly. Actions = Firebase transactions.

## Code Style Preferences

- Vanilla JavaScript, no frameworks
- Single HTML file with embedded `<style>` and `<script>`
- Firebase modular SDK v10.12.0 via CDN ESM imports
- Indonesian for user-facing UI text, English for code comments
- Aesthetic: green felt casino table, gold accents, Cormorant Garamond serif + JetBrains Mono

## How I'd Like You to Work

- **Don't make assumptions about game rules** — if anything is ambiguous, ASK me first (I learned the hard way that ambiguous rules = costly bugs).
- **Run commands for me** with brief explanation of what each does (I'm new to terminal).
- **Test after each significant change** by opening the URL in browser and asking me to verify.
- **Push back if I suggest something risky** — multiplayer has lots of edge cases I might not see.
- **Be honest about complexity** — don't promise quick fixes when they aren't.

## First Things to Do

1. Ask me to share the current files (`truf-multiplayer-v2.html` mainly — that's the active one).
2. Help me install Firebase CLI on my Mac.
3. Initialize Firebase Hosting for the project, deploy v2, give me the URL to test.
4. After I confirm milestone 2a works on the live URL, begin milestone 2b.

That's the brief. Let me know what you need from me to get started.
