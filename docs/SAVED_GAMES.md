# Saved games

Implemented 2026-11-02 for Truf, Remi, Cangkul and Tebak Kartu.

## Player workflow

1. Choose **Simpan game** in the game toolbar. Remi also exposes it in the
   pause panel. Finished matches and waiting-room lobbies cannot be saved.
2. One human against bots needs only that player's consent. With multiple
   humans, every currently seated human must agree, including disconnected
   humans. Bots do not vote. A request freezes play and expires after 60 seconds;
   a human can cancel it to continue playing immediately.
3. Once saved, choose **Kembali ke lobby**. The player remains a human in the
   same seat; the host, deck, hands, score, round and turn stay intact.
4. Choose **Game tersimpan** on the game-selection or lobby page, then **Buka
   game**. The same authenticated account is required. Opening does not start
   play. A direct room link and a refresh can also restore the waiting panel.
5. Choose **Lanjutkan game**. Every original human must be in this room and
   explicitly press **Siap lanjut**. The last complete set of confirmations
   releases the frozen game. A new attempt requires fresh confirmations.

A saved game expires after seven days without access by an original human.
Opening the room and its human heartbeat renew the deadline with a server
timestamp. Reading the saved-games list, a spectator, a bot and an unrelated
account cannot renew it. An already expired save cannot be revived by touching
its timestamp. Ordinary unsaved rooms retain the existing 30-second policy.

Cleanup continues to use the existing free service: an authenticated connected
app sweeps expired rooms. If all browsers are closed, physical removal happens
when an app next opens, rather than through a paid background scheduler.

## State and permissions

The complete existing room is the snapshot; no second copy of dealt cards or
score history is created. `savedGame` adds an immutable request ID, the exact
canonical human seat-to-UID roster, individual save votes, status, server times
and the current resume ID/readiness values. Status moves through `request`,
`saved`, and `resuming`. A successful resume removes only this control node.

`scripts/room-save-policy.cjs` is generated into `database.rules.json` by
`scripts/build-room-rules.cjs`. It blocks gameplay, seat replacement, host
takeover and ordinary host deletion while any save control node exists.
Authenticated original humans can update only their own presence and vote.
Every fixed seat is checked against canonical membership when a request is
created. A host cannot supply another player's vote. Resume checks all votes
and fresh, non-disconnected presence against current server data; old cleaner
snapshots cannot delete a save that another player has just opened.

Each connection registers server `onDisconnect` removal of its own readiness
before confirming. Starting another resume attempt replaces the nonce and
clears prior readiness. Two tabs coordinating the same account re-read the
authoritative state if another tab wins a transition, rather than reporting a
successfully saved game as failed.

The client stops timers/reminders and host drivers while frozen. Delayed bot
and resolver callbacks are bound to a save generation so work scheduled before
the save cannot fire after resume. Remi's local 45-second timer restarts when
play resumes. Existing Remi pause state is preserved; if saved during that
separate pause, the existing pause readiness also remains to be completed.
The single room listener is replaced on entry, and a direct room URL takes
precedence over automatic restoration from session storage.

Ranking match identity and pending approvals stay untouched. Save/resume does
not award points, create another ranked match or reset immutable receipts.
These checks freeze a client-driven game; they do not introduce a trusted
server gameplay engine or change the existing card-read policy.

## Verification

- `tests/room-saves.test.cjs`: actual UI controller, one and two humans, leave,
  list/open, consent, readiness, errors, text safety and weekly cleanup.
- `tests/room-save-security.py`: actual emulator rules, forged votes, roster
  tampering, freeze bypasses, six humans, reconnect, expiry and cleanup races.
- `tests/ranked-emulator.cjs`: actual app deal handlers and real database
  transport verify the entire room survives save/resume for all games,
  including solo/bots and 3/4/6-player arrangements; ranking remains single-use.
- Local browser checks with two synthetic accounts verify unanimous save,
  leaving, listing, reopening, waiting for the absent/unconfirmed human and
  eventual resume. A solo flow is checked at a 390 by 844 browser viewport.
  These do not use production players or claim physical-device verification.

Reference: Firebase's [database rules API](https://firebase.google.com/docs/reference/security/database)
documents scalar `RuleDataSnapshot.val()` behavior. Immutable rosters compare
each seat individually rather than comparing an object-valued snapshot.
