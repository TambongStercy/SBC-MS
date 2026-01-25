# Relance Feature - Frontend Implementation Guide

This document provides everything needed to implement the Relance (Re-engagement) feature in the user-facing frontend application.

---

## Table of Contents

1. [Overview](#1-overview)
2. [API Endpoints](#2-api-endpoints)
3. [TypeScript Interfaces](#3-typescript-interfaces)
4. [User Features to Implement](#4-user-features-to-implement)
5. [API Examples](#5-api-examples)
6. [UI/UX Recommendations](#6-uiux-recommendations)

---

## 1. Overview

### What is Relance?

Relance is an automated email follow-up system that helps users re-engage their unpaid referrals. When a user has referrals who haven't paid for a subscription, the system automatically sends them a 7-day email sequence to encourage them to subscribe.

### Key Concepts

| Term | Description |
|------|-------------|
| **Referrer** | The user who invited someone (parrain) |
| **Target/Referral** | The person who was invited but hasn't paid yet |
| **Campaign** | A configured set of follow-up emails for specific referrals |
| **Day 1-7** | The 7-day email sequence sent to each target |
| **Wave** | A batch of up to 60 targets processed together |

### How It Works

1. User activates relance for their unpaid referrals
2. System automatically enrolls unpaid referrals as "targets"
3. Each target receives 1 email per day for 7 days
4. If target pays, they automatically exit the loop
5. User can create custom campaigns with filters

---

## 2. API Endpoints

**Base URL:** `/api/relance`

**Authentication:** All endpoints require JWT token in Authorization header.

### 2.1 User Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/status` | Get user's relance configuration status |
| PUT | `/settings` | Update pause settings (enrollment/sending) |
| GET | `/targets` | Get user's active relance targets |
| PATCH | `/config` | Update relance configuration |

### 2.2 Campaign Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/campaigns` | Get all user's campaigns |
| POST | `/campaigns` | Create a new campaign |
| GET | `/campaigns/:id` | Get campaign details |
| GET | `/campaigns/:id/targets` | Get campaign targets |
| POST | `/campaigns/:id/start` | Start a draft campaign |
| POST | `/campaigns/:id/pause` | Pause an active campaign |
| POST | `/campaigns/:id/resume` | Resume a paused campaign |
| POST | `/campaigns/:id/cancel` | Cancel a campaign |
| DELETE | `/campaigns/:id` | Delete a draft campaign |
| POST | `/campaigns/preview` | Preview filter results before creating campaign |
| GET | `/campaigns/default/stats` | Get default relance statistics |
| GET | `/campaigns/default/targets` | Get default relance targets |

---

## 3. TypeScript Interfaces

```typescript
// ============ RELANCE CONFIG ============

interface RelanceConfig {
    _id: string;
    userId: string;
    enabled: boolean;                    // Master on/off switch
    enrollmentPaused: boolean;           // Pause new enrollments
    sendingPaused: boolean;              // Pause message sending
    messagesSentToday: number;           // Daily counter
    lastResetDate: string;               // When counter was last reset
    createdAt: string;
    updatedAt: string;
}

// ============ RELANCE TARGET ============

interface RelanceTarget {
    _id: string;
    referralUserId: string;              // The unpaid referral's user ID
    referrerUserId: string;              // The user who referred them
    campaignId?: string;                 // If part of a campaign
    waveId?: string;                     // Processing batch ID
    enteredLoopAt: string;               // When they entered the loop
    currentDay: number;                  // Current day in sequence (1-7)
    nextMessageDue: string;              // When next email should be sent
    lastMessageSentAt?: string;          // Last email timestamp
    messagesDelivered: MessageDelivery[];// History of sent messages
    exitedLoopAt?: string;               // When they left the loop
    exitReason?: ExitReason;             // Why they left
    status: TargetStatus;                // Current status
    language: 'fr' | 'en';               // User's language preference
    createdAt: string;
    updatedAt: string;

    // Populated fields (when using populate)
    referralUser?: {
        _id: string;
        name: string;
        email: string;
        phoneNumber: string;
        avatar?: string;
    };
}

interface MessageDelivery {
    dayNumber: number;
    sentAt: string;
    messageText: string;
    success: boolean;
    errorMessage?: string;
}

type TargetStatus = 'active' | 'completed' | 'paused' | 'failed';

type ExitReason =
    | 'paid'                    // Target subscribed
    | 'completed_7_days'        // Finished all 7 days
    | 'subscription_expired'    // Referrer's subscription expired
    | 'manual'                  // Manually removed
    | 'referrer_inactive';      // Referrer became inactive

// ============ CAMPAIGN ============

interface Campaign {
    _id: string;
    userId: string;
    name: string;
    type: 'default' | 'filtered';
    status: CampaignStatus;

    // Filter options (for 'filtered' type)
    targetFilter?: CampaignFilter;

    // Scheduling
    scheduledStartDate?: string;
    runAfterCampaignId?: string;         // Chain campaigns
    priority?: number;

    // Custom messages (optional override of default messages)
    customMessages?: CustomMessage[];

    // Limits
    maxMessagesPerDay?: number;
    messagesSentToday?: number;

    // Statistics
    estimatedTargetCount?: number;
    actualTargetCount?: number;
    targetsEnrolled: number;
    messagesSent: number;
    messagesDelivered: number;
    messagesFailed: number;
    targetsCompleted: number;
    targetsExited: number;

    // Timestamps
    startedAt?: string;
    actualEndDate?: string;
    cancellationReason?: string;
    createdAt: string;
    updatedAt: string;
}

type CampaignStatus =
    | 'draft'       // Not started yet
    | 'scheduled'   // Waiting for start date
    | 'active'      // Currently running
    | 'paused'      // Temporarily stopped
    | 'completed'   // All targets finished
    | 'cancelled';  // Manually cancelled

interface CampaignFilter {
    countries?: string[];                // e.g., ['CM', 'CI', 'SN']
    registrationDateFrom?: string;       // ISO date string
    registrationDateTo?: string;         // ISO date string
    gender?: 'male' | 'female' | 'other' | 'all';
    professions?: string[];
    minAge?: number;
    maxAge?: number;
    hasUnpaidReferrals?: boolean;
    excludeCurrentTargets?: boolean;     // Exclude already enrolled targets
}

interface CustomMessage {
    dayNumber: number;                   // 1-7
    messageTemplate: {
        fr: string;                      // French message
        en: string;                      // English message
    };
    mediaUrls?: MediaAttachment[];
}

interface MediaAttachment {
    url: string;
    type: 'image' | 'video' | 'pdf';
    filename?: string;
}

// ============ STATISTICS ============

interface RelanceStats {
    totalActiveTargets: number;
    totalCompletedTargets: number;
    totalMessagesSent: number;
    totalSuccessRate: number;            // Percentage (0-100)
    targetsEnrolledToday: number;
    messagesSentToday: number;
    exitReasons: {
        paid: number;
        completed_7_days: number;
        subscription_expired: number;
        manual: number;
    };
}

interface CampaignStats {
    totalCampaigns: number;
    activeCampaigns: number;
    completedCampaigns: number;
    totalTargetsEnrolled: number;
    totalMessagesSent: number;
    averageSuccessRate: number;
}

// ============ API RESPONSES ============

interface RelanceStatusResponse {
    success: boolean;
    data: {
        config: RelanceConfig | null;
        activeTargetsCount: number;
        hasActiveSubscription: boolean;
    };
}

interface TargetsResponse {
    success: boolean;
    data: {
        targets: RelanceTarget[];
        total: number;
        page: number;
        totalPages: number;
    };
}

interface CampaignsResponse {
    success: boolean;
    data: {
        campaigns: Campaign[];
        total: number;
        page: number;
        totalPages: number;
    };
}

interface PreviewResponse {
    success: boolean;
    data: {
        estimatedCount: number;
        sampleUsers: Array<{
            _id: string;
            name: string;
            email: string;
            country: string;
        }>;
    };
}
```

---

## 4. User Features to Implement

### 4.1 Relance Dashboard Page

**Purpose:** Main page for managing relance settings and viewing status.

**Components needed:**
- Enable/Disable toggle for relance
- Pause enrollment toggle
- Pause sending toggle
- Statistics cards (active targets, messages sent, success rate)
- Quick access to campaigns

**API calls:**
```typescript
// On page load
GET /api/relance/status
GET /api/relance/campaigns/default/stats

// Toggle settings
PUT /api/relance/settings
Body: { enabled?: boolean, enrollmentPaused?: boolean, sendingPaused?: boolean }
```

### 4.2 Active Targets List

**Purpose:** Show all referrals currently in the relance loop.

**Features:**
- List of targets with name, email, current day, status
- Filter by status (active, completed, failed)
- Show next message due date
- Progress indicator (Day X of 7)

**API calls:**
```typescript
// Get targets with pagination
GET /api/relance/targets?page=1&limit=20&status=active

// For default relance targets
GET /api/relance/campaigns/default/targets?page=1&limit=20
```

### 4.3 Campaign Management

**Purpose:** Create and manage targeted campaigns.

#### 4.3.1 Campaign List
- Show all campaigns with status badges
- Filter by status (draft, active, paused, completed)
- Quick actions (start, pause, resume, cancel)

#### 4.3.2 Create Campaign Flow

**Step 1: Basic Info**
```typescript
{
    name: "Ma campagne CM",
    type: "filtered"  // or "default"
}
```

**Step 2: Filter Selection (if filtered type)**
```typescript
// Preview filter results first
POST /api/relance/campaigns/preview
Body: {
    targetFilter: {
        countries: ["CM"],
        hasUnpaidReferrals: true,
        excludeCurrentTargets: true
    }
}

// Response shows estimated count and sample users
```

**Step 3: Custom Messages (Optional)**
- Allow overriding default Day 1-7 messages
- Support for media attachments

**Step 4: Scheduling (Optional)**
- Set start date
- Set daily message limit

**Step 5: Review & Create**
```typescript
POST /api/relance/campaigns
Body: {
    name: "Campagne Cameroun Janvier",
    type: "filtered",
    targetFilter: {
        countries: ["CM"],
        registrationDateFrom: "2025-01-01",
        registrationDateTo: "2025-01-31",
        hasUnpaidReferrals: true,
        excludeCurrentTargets: true
    },
    maxMessagesPerDay: 30,
    scheduledStartDate: "2026-02-01T08:00:00Z"
}
```

#### 4.3.3 Campaign Detail Page
- Campaign info and statistics
- List of targets with status
- Delivery history
- Actions (pause, resume, cancel)

**API calls:**
```typescript
GET /api/relance/campaigns/:id
GET /api/relance/campaigns/:id/targets?page=1&limit=20
POST /api/relance/campaigns/:id/start
POST /api/relance/campaigns/:id/pause
POST /api/relance/campaigns/:id/resume
POST /api/relance/campaigns/:id/cancel
Body: { reason?: "Campagne terminée manuellement" }
```

### 4.4 Settings Page

**Purpose:** Configure relance behavior.

**Features:**
- Daily message limit setting
- Enable/disable specific days
- View message templates (read-only, admin configures these)

**API call:**
```typescript
PATCH /api/relance/config
Body: {
    maxMessagesPerDay: 50,
    enabled: true
}
```

---

## 5. API Examples

### 5.1 Get Relance Status

```typescript
// Request
GET /api/relance/status
Authorization: Bearer <jwt_token>

// Response
{
    "success": true,
    "data": {
        "config": {
            "_id": "65d2b0344a7e2b9efbf6205d",
            "userId": "65d2b0344a7e2b9efbf6205d",
            "enabled": true,
            "enrollmentPaused": false,
            "sendingPaused": false,
            "messagesSentToday": 12,
            "lastResetDate": "2026-01-25T00:00:00.000Z"
        },
        "activeTargetsCount": 45,
        "hasActiveSubscription": true
    }
}
```

### 5.2 Update Settings

```typescript
// Request
PUT /api/relance/settings
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
    "enabled": true,
    "sendingPaused": true
}

// Response
{
    "success": true,
    "message": "Settings updated successfully",
    "data": {
        "enabled": true,
        "enrollmentPaused": false,
        "sendingPaused": true
    }
}
```

### 5.3 Get Active Targets

```typescript
// Request
GET /api/relance/targets?page=1&limit=10&status=active
Authorization: Bearer <jwt_token>

// Response
{
    "success": true,
    "data": {
        "targets": [
            {
                "_id": "target123",
                "referralUserId": "user456",
                "referrerUserId": "user789",
                "currentDay": 3,
                "nextMessageDue": "2026-01-26T09:00:00.000Z",
                "status": "active",
                "language": "fr",
                "enteredLoopAt": "2026-01-23T09:00:00.000Z",
                "messagesDelivered": [
                    { "dayNumber": 1, "sentAt": "2026-01-23T09:05:00.000Z", "success": true },
                    { "dayNumber": 2, "sentAt": "2026-01-24T09:03:00.000Z", "success": true }
                ],
                "referralUser": {
                    "_id": "user456",
                    "name": "Jean Dupont",
                    "email": "jean@example.com",
                    "phoneNumber": "237612345678"
                }
            }
        ],
        "total": 45,
        "page": 1,
        "totalPages": 5
    }
}
```

### 5.4 Preview Campaign Filter

```typescript
// Request
POST /api/relance/campaigns/preview
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
    "targetFilter": {
        "countries": ["CM", "CI"],
        "hasUnpaidReferrals": true,
        "excludeCurrentTargets": true,
        "registrationDateFrom": "2025-06-01"
    }
}

// Response
{
    "success": true,
    "data": {
        "estimatedCount": 127,
        "sampleUsers": [
            { "_id": "u1", "name": "Alice Kamga", "email": "alice@mail.com", "country": "CM" },
            { "_id": "u2", "name": "Paul Diallo", "email": "paul@mail.com", "country": "CI" },
            { "_id": "u3", "name": "Marie Fofana", "email": "marie@mail.com", "country": "CM" }
        ]
    }
}
```

### 5.5 Create Campaign

```typescript
// Request
POST /api/relance/campaigns
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
    "name": "Campagne Cameroun Q1 2026",
    "type": "filtered",
    "targetFilter": {
        "countries": ["CM"],
        "hasUnpaidReferrals": true,
        "excludeCurrentTargets": true
    },
    "maxMessagesPerDay": 30
}

// Response
{
    "success": true,
    "message": "Campaign created successfully",
    "data": {
        "_id": "campaign123",
        "name": "Campagne Cameroun Q1 2026",
        "type": "filtered",
        "status": "draft",
        "targetFilter": { ... },
        "estimatedTargetCount": 127,
        "actualTargetCount": 0,
        "targetsEnrolled": 0,
        "messagesSent": 0,
        "createdAt": "2026-01-25T10:00:00.000Z"
    }
}
```

### 5.6 Start Campaign

```typescript
// Request
POST /api/relance/campaigns/campaign123/start
Authorization: Bearer <jwt_token>

// Response
{
    "success": true,
    "message": "Campaign started successfully",
    "data": {
        "_id": "campaign123",
        "status": "active",
        "startedAt": "2026-01-25T10:05:00.000Z",
        "actualTargetCount": 127,
        "targetsEnrolled": 127
    }
}
```

---

## 6. UI/UX Recommendations

### 6.1 Dashboard Layout

```
┌─────────────────────────────────────────────────────────────┐
│  Relance - Suivi Automatique                    [Activé ✓] │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │    45    │  │   320    │  │   92%    │  │    12    │   │
│  │ Actifs   │  │ Envoyés  │  │ Succès   │  │Aujourd'hui│   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Contrôles                                           │   │
│  │   [ ] Pause inscription   [ ] Pause envoi          │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Campagnes Actives                    [+ Nouvelle]   │   │
│  │ ─────────────────────────────────────────────────── │   │
│  │ • Campagne Cameroun       🟢 Active    45 cibles   │   │
│  │ • Campagne Sénégal        ⏸️ Pause     23 cibles   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 6.2 Target Progress Indicator

```
Jean Dupont                      Jour 3/7
jean@example.com                 ●●●○○○○
Prochain: demain 09:00          [Actif]
```

### 6.3 Campaign Status Badges

| Status | Color | Label |
|--------|-------|-------|
| draft | Gray | Brouillon |
| scheduled | Blue | Programmé |
| active | Green | Actif |
| paused | Orange | En pause |
| completed | Purple | Terminé |
| cancelled | Red | Annulé |

### 6.4 Translations (FR)

```json
{
    "relance.title": "Relance Automatique",
    "relance.enabled": "Activé",
    "relance.disabled": "Désactivé",
    "relance.pauseEnrollment": "Pause inscription",
    "relance.pauseSending": "Pause envoi",
    "relance.activeTargets": "Cibles actives",
    "relance.messagesSent": "Messages envoyés",
    "relance.successRate": "Taux de succès",
    "relance.sentToday": "Envoyés aujourd'hui",

    "campaign.create": "Nouvelle campagne",
    "campaign.name": "Nom de la campagne",
    "campaign.type.default": "Par défaut",
    "campaign.type.filtered": "Avec filtres",
    "campaign.filter.countries": "Pays",
    "campaign.filter.dateRange": "Période d'inscription",
    "campaign.filter.gender": "Genre",
    "campaign.preview": "Aperçu",
    "campaign.estimatedTargets": "Cibles estimées",

    "campaign.status.draft": "Brouillon",
    "campaign.status.scheduled": "Programmé",
    "campaign.status.active": "Actif",
    "campaign.status.paused": "En pause",
    "campaign.status.completed": "Terminé",
    "campaign.status.cancelled": "Annulé",

    "campaign.action.start": "Démarrer",
    "campaign.action.pause": "Mettre en pause",
    "campaign.action.resume": "Reprendre",
    "campaign.action.cancel": "Annuler",
    "campaign.action.delete": "Supprimer",

    "target.status.active": "Actif",
    "target.status.completed": "Terminé",
    "target.status.paused": "En pause",
    "target.status.failed": "Échec",

    "target.exitReason.paid": "A payé",
    "target.exitReason.completed_7_days": "7 jours terminés",
    "target.exitReason.subscription_expired": "Abonnement expiré",
    "target.exitReason.manual": "Suppression manuelle"
}
```

### 6.5 Error Handling

```typescript
// Common error responses
{
    "success": false,
    "message": "Subscription required to use relance",
    "code": "SUBSCRIPTION_REQUIRED"
}

{
    "success": false,
    "message": "Campaign not found",
    "code": "NOT_FOUND"
}

{
    "success": false,
    "message": "Cannot start campaign in current status",
    "code": "INVALID_STATUS"
}
```

---

## Quick Start Checklist

- [ ] Implement relance status page with enable/disable toggle
- [ ] Create targets list with pagination and progress indicators
- [ ] Build campaign list page with status filters
- [ ] Implement campaign creation wizard (4-5 steps)
- [ ] Add campaign detail page with targets list
- [ ] Implement campaign actions (start, pause, resume, cancel)
- [ ] Add statistics dashboard widgets
- [ ] Handle error states and loading states
- [ ] Add French translations

---

*Document created: January 2026*
*API Version: 1.0*
