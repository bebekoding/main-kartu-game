# Leaderboard contract v3

Implemented 2026-10-27 for Truf, Remi, Cangkul and Tebak Kartu. This release uses
Firebase Realtime Database and explicit approval by every original human player,
as selected by the project owner. It does not require billing or Cloud Functions.

## What authorizes a score

1. Before dealing cards, the host registers a random, permanent match ID from
   the lobby. Rules freeze the game, room, canonical seats and registered Auth
   identities. Bots, duplicate identities and mismatched profiles cannot qualify.
   A late lobby join invalidates the frozen roster, requiring a new registration.
2. At the final phase, an original participant freezes the result and creates
   private pending notifications for every original participant in one update.
   Scores and deterministic rank points must agree with the room at that time.
   The result cannot subsequently be changed or deleted by a client.
3. Every original participant must manually approve the frozen result with their
   own authenticated account. No host, app administrator or spectator can approve
   on another participant's behalf. Decisions are permanent; a rejection vetoes
   the entire award. Waiting for an offline participant never implies approval.
4. Once all approve, any original participant can submit one atomic update that
   credits every player, clears pending notifications and creates a permanent
   receipt. Rules require exact increments, original identities and all rows in
   the same packet. Points are player count minus rank index, with a five-point
   bonus on every fifth recorded match for that player.

Remi needs at least ten completed rounds, unless a player actually reaches the
existing positive or negative 1,000-point limit. A reason label alone is
insufficient. Tebak needs at least ten completed rounds. Truf checks the completed
thirteenth trick and session result; Cangkul checks the complete elimination
order and final scores. Basic terminal-state checks support the approval flow;
they are not a server simulation of every legal card action.

## Recovery and scope

The receipt is independent of room ownership, room existence and the old
`leaderboardRecorded` flag. Reusing a room, resetting the old flag, resubmitting a
packet or switching hosts cannot reuse a receipt. Raw leaderboard counter writes
are denied, including writes by an app administrator.

The browser reads the receipt after a failed acknowledgement and retries from
fresh totals after conflicts. It never marks a match consumed before the atomic
write succeeds. Multiple coordinators can race safely. Participants retain their
pending review entry after leaving a room or signing in again. Results are frozen
before normal rematch and leave operations can discard the final room state.

Existing numeric leaderboard totals are preserved. This release does not
retroactively correct historical scores. Matches already underway without a v3
registration are unranked; refresh and start a new match to use the new flow.
An existing ranked match whose original human roster changes before its result
is frozen cannot qualify.

The trust boundary is unanimous human attestation. Room gameplay still runs in
clients. Coordinated dishonest approvals, multiple accounts controlled by one
person and compromised accounts are outside this guarantee. Full verification
of every move would require a trusted game engine and is not claimed here.

## Source and release checks

- `ranked-leaderboard.js`: shared identities, eligibility, rank calculation and
  atomic award packet.
- `ranked-client.js`: registration, recovery, private subscriptions and signed
  decisions. `ranked-ui.js`: manual result review and pending entries.
- `scripts/leaderboard-policy.cjs`: policy generator, installed last by
  `scripts/build-room-rules.cjs`; `database.rules.json` is its deployable output.
- Public runtime metadata `config/leaderboardContract` must be `3`. Update this
  child with an owner CLI operation, preserving all other configuration fields.
- Deploy database rules and Hosting together. Then read active rules back using
  the owner CLI and run `scripts/verify-ranking-release.py --rules <readback>`.
  This checks exact production assets on every game route, no-store headers,
  active rules and contract metadata. It reads no account secrets or cards.

Validation uses Node tests, the official local RTDB emulator, synthetic Auth
identities and browser interaction against that emulator. The client integration
suite executes the actual app start handlers; terminal states are prepared test
fixtures, not claims of a complete multiplayer game played through every round.
Coverage includes forged counters, missing votes, partial atomic packets, wrong
bonuses, duplicate submissions, lost acknowledgements, concurrent coordinators,
host departure, room deletion, rejection cleanup and changed-roster start races.
No live player account, room or score is modified by these tests.
