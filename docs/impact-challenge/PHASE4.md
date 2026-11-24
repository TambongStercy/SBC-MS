# SBC Impact Challenge v2 — Phase 4 (SBC Tombola)

Spec §13 (tombola, live draw, history) and the tombola parts of §15–§16. Builds on Phases 1–3.
Code: event-service `modules/impact/services/tombola.service.ts`, model `ImpactTombolaDraw`.

This is NOT the old monthly tombola of tombola-service (`/api/tombolas`), which is untouched.

## Rules (Rufus, 2026-11-23)

- **Tickets:** 1 counted paid vote = 1 ticket, from purchases that are paid, counted, not late and not
  refunded. Tickets are numbered from 1 in the order the votes were counted (then purchase id), so
  purchase n°1's 5 votes are tickets 1–5, and so on.
- **Weights:** a member's n-th ticket of the edition weighs `settings.ticketTiers`. Default: 1 for
  tickets 1–10, ½ for 11–50, ¼ from 51. Each extra ticket gains a big buyer less, and everyone keeps a
  chance. Example: 100 tickets weigh 42.5 against 1 for a single ticket, so the single ticket holds a
  2.3 % chance.
- **Prizes:** `settings.prizes` (default: cash, a computer, a phone), drawn in that order.
  - The admin can edit them until the draw; after it, 409 `RULES_LOCKED` on `settings.prizes`.
  - A member wins at most one prize per draw.
  - A member who won the same prize **category** within `settings.prizeCooldownDays` (365), in any
    edition of v2, is left out of that prize only.
- **When:** the tickets are final once the TOP 3 is set (paid votes closed, refunds frozen). The draw
  can run from then on, typically at the end of the live final.

## Fair and checkable draw (commit–reveal)

1. **« Fixer la graine »:** the server draws 32 random bytes (the seed) and publishes `sha256(seed)` at
   once. Do it **while the paid votes are still open**: the seed is then fixed before anyone knows the
   final tickets, and nobody could have chosen it to favour someone. `committedBeforeTicketsClosed`
   says whether that was the case, and it is public.
2. **« Lancer le tirage »** (admin code): the tickets are frozen, the exclusions computed, and the
   winners chosen from the seed. Everything is recorded at once and for good, and the seed is revealed.
3. **The method, per prize k (1, 2, …):**
   - remove the excluded holders;
   - W = Σ (to − from + 1) × weight over the remaining segments, with weights as integers
     (weight × 10 000);
   - x = the first 6 bytes of HMAC-SHA256(seed, "<drawId>|<k>|<attempt>"), attempt = 0, 1, … until
     x < ⌊2⁴⁸/W⌋ × W, so there is no modulo bias;
   - r = x mod W; walk the segments in ticket order: the segment where r falls holds the ticket
     from + ⌊r / weight⌋.
4. **« Afficher le gagnant suivant »:** the live screen reveals the winners one by one (`revealedCount`).
   That is presentation only, since the result is already recorded. Each winner is notified when
   revealed, not before, so no phone buzzes ahead of the reveal.
5. **Proof** (`/public/tombola/draws/:id/proof`):
   - the seed and its commitment;
   - the ticket segments with pseudonymous holders (`sha256(userId:drawId)`) and their hash;
   - the exclusions per prize;
   - the method and the winners.

   Anyone can recompute the winners from it; `check-impact-tombola.ts` does exactly that.

## API (gateway `/api/tickets/impact/*`)

### Public

- `GET /public/tombola` (cached 5 s) → `null` before the competition, or:
  - `editionId`, `editionName`, `prizes: [{ key, label, category }]`, `tiers`, `cooldownDays`,
    `totalTickets`, `participants`;
  - `draw: TombolaDraw | null`. In the public draw, `winners` holds only the revealed ones, with no
    member ids.
- `GET /public/tombola/history` (cached 60 s) →
  `[{ drawId, editionId, editionName, drawnAt, totalTickets, participants, winners: [{ order, prize, category, ticketNumber, displayName, status }] }]`.
- `GET /public/tombola/draws/:id/proof` → as above (before the draw: the commitment only).
- **`TombolaDraw`** = `{ _id, editionId, status: 'COMMITTED'|'DONE', seedCommitment, committedAt,
  committedBeforeTicketsClosed, seed (once DONE), drawnAt, prizes, totalTickets, participants,
  segmentsHash, revealedCount, winnersCount, winners: [{ order, prizeKey, prizeLabel, category,
  ticketNumber, displayName, status: 'PENDING'|'DELIVERED'|'FORFEITED'|'NOT_AWARDED' }] }`.
- `displayName` is the first name plus an initial (« Awa N. »).

### Member

`GET /me/tombola` → `null`, or
`{ editionId, tickets, ranges: [{ from, to }], sharePct, totalTickets, drawn, wins: [{ prizeLabel, ticketNumber, status }] }`.
`sharePct` is the member's share of the total weight, i.e. their chance for the first prize. `wins`
only lists revealed wins.

### Administration (module `impactChallenge`)

| Route | Body | Answer |
|---|---|---|
| `GET /admin/editions/:id/tombola` | — | `{ draw: TombolaDraw (admin: all winners with userId, holderHash, attempts, statusNote) \| null, tickets: { totalTickets, participants, totalWeight, weightScale, topHolders: [{ userId, name, tickets, sharePct }] }, prizes, tiers, cooldownDays, paidRoundClosed, canCommit, canDraw, blockers }` |
| `POST /admin/editions/:id/tombola/commit` | — | `TombolaDraw` (commitment). 409 `ALREADY_COMMITTED` |
| `POST /admin/editions/:id/tombola/draw` **(admin code)** | — | `TombolaDraw` with the seed. 409 `NOT_COMMITTED`, `TICKETS_NOT_FINAL`, `NO_TICKETS`, `ALREADY_DRAWN` |
| `POST /admin/editions/:id/tombola/reveal` | — | `TombolaDraw`. 409 `NOT_DRAWN`, `ALL_REVEALED` |
| `POST /admin/editions/:id/tombola/winners/:order/status` | `{ status: 'DELIVERED' \| 'FORFEITED' \| 'PENDING', note? }` (a reason ≥ 5 is required for FORFEITED) | `TombolaDraw` |
| `GET /admin/tombola/history` | — | the history, with `userId`, `statusNote` and `statusAt` |

**Blockers:** `NOT_COMMITTED`, `TICKETS_NOT_FINAL` (no TOP 3 yet), `NO_TICKETS`.

## Notifications

- **Winner** (push + e-mail, sent when revealed): `impact-tombola-won` opens `/impact-challenge/tombola`,
  in the push category `tombola`.
- **Vote buyers:** the « votes comptés » push now also says how many tickets they got.

## Checks

event-service `src/scripts/check-impact-tombola.ts`: 34 checks. They cover:
- ticket numbering and Rufus's weights at the tier boundaries;
- only counted votes giving tickets;
- chances following the weights over 4 000 seeds;
- reproducibility, and excluded holders never picked;
- the commitment (before / after the tickets closed) and the 365-day same-category rule;
- one prize per member, and prizes locked after the draw;
- the reveal (and its notification), statuses and history;
- a prize not awarded when holders run out;
- **an independent recomputation of the winners from the public proof alone.**
