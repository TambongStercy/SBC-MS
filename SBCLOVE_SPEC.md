# SBCLOVE — Specification & Implementation Plan

> Refined from `SBC_love doc.pdf` (CAHIER DES CHARGES – SBCLOVE).
> Status: **V1 design** — backend microservice `sbclove-service`.

## 1. Overview

SBCLOVE is a web-only community matchmaking module integrated into the SBC platform.
It enables serious connections between members in a secured, moderated and **time-boxed**
context: the module runs **one session per week, every Wednesday**.

- **Service:** `sbclove-service`
- **Port:** `3009` (preprod `6009`)
- **Database:** `sbc_sbclove_dev` (dev), `sbc_sbclove_prod` (prod) — per `sbc_{service}_{env}` convention
- **Gateway route:** `/api/sbclove`
- **Realtime:** none (no WebSocket, no live chat in V1) — CRUD + weekly logic only

## 2. Weekly availability window

- Module is active **only on Wednesday**, recommended **18:00–21:00**.
- Outside the window the module is **automatically closed**: profiles are not browsable and
  interactions are disabled.
- **Timezone:** `Africa/Douala` (UTC+1). All window math is done in this timezone.
- Configurable via env / `ModuleConfig`: `activeWeekday`, `openHour`, `closeHour`, `timezone`.
- **Refinement:** managing *your own* profile (create / edit / submit for validation) is allowed
  **anytime** so members can prepare. Browsing other profiles and sending interests are
  **window-gated**.

## 3. Access rules

- Accessible only to authenticated SBC members (JWT, via gateway).
- **Email must be verified** — gate profile creation on `User.isVerified === true`.
- Members **without** a SBCLOVE profile get **limited access**: they may see textual info but
  **not clear photos** (see §6).

## 4. Profile visibility

- Members without a SBCLOVE profile cannot see clear photos — photos are **blurred / overlaid**.
- Info visible without a profile: display name (pseudo), age bracket, city/country, intention,
  description.
- Full (clear) photos are served only to members **with an approved profile**, during the window.

## 5. Data model — reuse SBC user data

SBCLOVE does **not** duplicate identity/demographic data. The SBC `User` (user-service) is the
single source of truth; the profile references it and is hydrated at read time (batch, like
tombola-service's `getUsersByIds`).

| SBCLOVE field    | Source                              | Notes |
|------------------|-------------------------------------|-------|
| prénom / pseudo  | `User.name` (+ optional override)   | `displayName` optional, defaults to `User.name` |
| sexe             | `User.sex` (`UserSex` enum)         | reused, not redefined |
| tranche d'âge    | derived from `User.birthDate`       | bucketed into `AgeBracket` enum at read time |
| ville / pays     | `User.city`, `User.country`         | reused |
| email vérifié    | `User.isVerified`                   | gate for profile creation |
| photos (1–3)     | **SBCLOVE-owned** (settings-service)| new |
| intention        | **SBCLOVE-owned** (`Intention` enum)| new |
| description      | **SBCLOVE-owned** (≤300 chars)      | new, content-restricted (§7) |

### Enums owned by SBCLOVE

```
Intention:
  relation_serieuse        // Relation sérieuse
  faire_connaissance       // Faire connaissance
  projet_mariage           // Projet de mariage
  elargir_cercle_social    // Élargir mon cercle social
  echange_valeurs_respect  // Échange basé sur les valeurs et le respect
  autre                    // Autre intention (+ otherIntentionText, ≤80 chars)

AgeBracket (derived from birthDate):
  18-25 | 26-35 | 36-45 | 46-55 | 56+

ProfileStatus:
  pending | approved | rejected | suspended
```

## 6. Photos & protection

- 1–3 real photos, uploaded via **settings-service** (existing Drive integration).
- Server stores both the original and a **blurred derivative** (served to non-profile members).
- Frontend responsibilities (deterrent only, not enforceable server-side):
  watermark "SBCLOVE", disable right-click / direct download, basic anti-capture.

## 7. Restrictions (forbidden content in profile text)

Forbidden in `displayName` + `description`: phone numbers, WhatsApp references, social media
handles, external links, raw emails. Enforced via server-side regex validation on
create/update — request is rejected with a field-level error.

## 8. Validation

- Every created/edited profile → `status = pending`.
- Auto-validation rules + **manual admin validation recommended**.
- Only `approved` (and not `suspended`) profiles are visible.

## 9. Interactions

- Single action: **"Manifester un intérêt"** (express interest).
- **Max 5 interests per user per week** (reset each Wednesday session).
- No free chat in V1.

## 10. Match

- A **Match** is created when interest is **reciprocal** (A→B and B→A).
- Both users receive an **email notification** (via notification-service).

## 11. Match email content (§10 of source)

```
Subject: SBCLOVE – Un intérêt réciproque a été détecté

Bonjour [Prénom],

Une personne avec qui vous avez manifesté un intérêt a également montré un intérêt
pour votre profil sur SBCLOVE.

Pour des raisons de sécurité et de respect de la vie privée, SBC ne partage pas
automatiquement les coordonnées personnelles.

Connectez-vous à votre espace SBC pour consulter ce match et choisir la suite que
vous souhaitez donner.

L'équipe SBC
```

## 12. "Mes matchs" space

Each match shows: photo, display name, city, intention.
Available actions per match (double opt-in):
- "Je souhaite être contacté(e)" → `wants_contact`
- "Je ne souhaite pas aller plus loin" → `declined`

## 13. Contact request (double opt-in)

- Clicking "Je souhaite être contacté(e)" notifies the other user by email.
- Contact unlocks **only after both sides** choose `wants_contact` (double validation).
- **V2 (deferred):** SBC-relayed messaging without revealing personal email.

## 14. Moderation & security

- Report a profile, block a profile, report history.
- **Auto-suspension after N=3 distinct reports** (`autoSuspendThreshold`, configurable).
- Admin interface (endpoints): validate profiles, manage reports, enable/disable the module
  (global kill-switch).

## 15. Technical constraints

- Web only, no WebSocket, no realtime messaging in V1.
- Simple CRUD + weekly logic, following the standard SBC microservice structure.

## 16. Objective

Strengthen SBC community engagement through a secured, serious and controlled weekly rendez-vous.

---

## Data Model (Mongoose, `sbc_sbclove_dev`)

| Model | Key fields |
|-------|-----------|
| **LoveProfile** | `userId`(unique), `displayName?`, `intention`, `otherIntentionText?`, `description`, `photos[]`{fileId, blurredFileId}, `status`, `moderation`{validatedBy, validatedAt, rejectionReason, reportCount} |
| **Interest** | `fromUserId`, `toUserId`, `sessionDate`(Wednesday date), `createdAt` — unique `{fromUserId,toUserId}`, count by `{fromUserId,sessionDate}` |
| **Match** | `userA`, `userB`, `contactChoice`{[userId]: pending\|wants_contact\|declined}, `contactUnlocked`, `createdAt` |
| **Report** | `reporterId`, `reportedUserId`, `reason`, `status`, `createdAt` |
| **Block** | `blockerId`, `blockedUserId` |
| **ModuleConfig** (singleton) | `enabled`, `activeWeekday`, `openHour`, `closeHour`, `timezone`, `maxInterestsPerWeek`, `autoSuspendThreshold` |

## API Surface (mounted under `/api/sbclove`)

| Method | Path | Auth | Window-gated |
|--------|------|------|--------------|
| POST | `/profiles` | user | no |
| GET | `/profiles/me` | user | no |
| PUT | `/profiles/me` | user | no |
| POST | `/profiles/me/photos` | user | no |
| GET | `/profiles` | user | **yes** |
| GET | `/profiles/:id` | user | **yes** |
| POST | `/profiles/:id/interest` | user | **yes** (quota) |
| GET | `/interests/me` | user | no |
| GET | `/matches/me` | user | no |
| POST | `/matches/:id/contact-choice` | user | no |
| POST | `/profiles/:id/report` | user | no |
| POST | `/profiles/:id/block` | user | no |
| GET | `/admin/profiles` | admin | no |
| PATCH | `/admin/profiles/:id/validate` | admin | no |
| GET | `/admin/reports` | admin | no |
| PATCH | `/admin/reports/:id` | admin | no |
| PATCH | `/admin/module` | admin | no |

## Integration (service clients)

- **user-service** — verify member, email verification, batch hydrate (name/sex/birthDate/city/country/avatar).
- **notification-service** — match + contact emails (`/internal/create`).
- **settings-service** — photo upload, blurred-variant storage, module-level settings.

## Phased rollout

1. **Scaffold** — service skeleton + gateway/compose wiring, `/api/health` green.
2. **Profiles** — model/repo/service, create/edit/photos, content validation, admin validation.
3. **Window & browse** — `ModuleConfig`, `enforceModuleWindow`, browse with photo blurring.
4. **Interactions & matches** — interest + 5/week quota, reciprocal match, match email, "Mes matchs".
5. **Contact double opt-in + moderation** — contact-choice, report/block, auto-suspension, admin reports.
6. **Frontend (`ui/`)** — SBCLOVE section, photo overlay/watermark, "Mes matchs", admin panels.
7. **V2** — SBC-relayed messaging without email reveal.
