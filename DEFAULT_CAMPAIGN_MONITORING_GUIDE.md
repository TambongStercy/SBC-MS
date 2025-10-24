# Default Campaign (Auto-inscription) Monitoring & Control Guide

## Overview

The **Default Campaign** (Campagne par défaut / Auto-inscription) automatically enrolls new unpaid referrals 1 hour after they register. This guide covers how to:
1. Monitor default campaign progress
2. Control default campaign behavior
3. Understand automatic pausing when filtered campaigns are active

---

## 🎯 Key Features

### Automatic Campaign Management
- ✅ **Auto-pause when filtered campaign starts** (unless `allowSimultaneousCampaigns` is enabled)
- ✅ **Auto-resume when all filtered campaigns complete**
- ✅ **Manual pause/resume control**
- ✅ **Progress monitoring**

---

## 📊 1. Monitor Default Campaign Progress

### Get All Campaigns (Including Default)

**Endpoint:** `GET /api/relance/campaigns`

**Query Parameters:**
- `type`: Filter by campaign type (`default` or `filtered`)
- `status`: Filter by status (`active`, `completed`, `paused`, etc.)
- `page`: Page number (default: 1)
- `limit`: Items per page (default: 20)

**Request Example:**
```javascript
// Get only the default campaign
GET /api/relance/campaigns?type=default

// Get default campaign with status filter
GET /api/relance/campaigns?type=default&status=active
```

**Response:**
```json
{
  "success": true,
  "data": {
    "campaigns": [
      {
        "_id": "campaign_id",
        "userId": "user_id",
        "name": "Campagne par défaut",
        "type": "default",
        "status": "active",
        "targetsEnrolled": 42,
        "messagesSent": 156,
        "messagesDelivered": 148,
        "messagesFailed": 8,
        "targetsCompleted": 12,
        "targetsExited": 3,
        "actualStartDate": "2025-01-15T10:00:00.000Z",
        "createdAt": "2025-01-15T09:00:00.000Z",
        "updatedAt": "2025-01-20T14:30:00.000Z"
      }
    ],
    "total": 1,
    "page": 1,
    "totalPages": 1
  }
}
```

### Get Campaign Details

**Endpoint:** `GET /api/relance/campaigns/:campaignId`

**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "campaign_id",
    "userId": "user_id",
    "name": "Campagne par défaut",
    "type": "default",
    "status": "active",
    "targetsEnrolled": 42,
    "messagesSent": 156,
    "messagesDelivered": 148,
    "messagesFailed": 8,
    "targetsCompleted": 12,
    "targetsExited": 3,
    "actualStartDate": "2025-01-15T10:00:00.000Z",
    "createdAt": "2025-01-15T09:00:00.000Z"
  }
}
```

### Get Campaign Targets (Enrolled Referrals)

**Endpoint:** `GET /api/relance/campaigns/:campaignId/targets`

**Query Parameters:**
- `page`: Page number
- `limit`: Items per page

**Response:**
```json
{
  "success": true,
  "data": {
    "targets": [
      {
        "_id": "target_id",
        "referralUserId": "referral_user_id",
        "referrerUserId": "referrer_user_id",
        "campaignId": "campaign_id",
        "currentDay": 3,
        "status": "active",
        "messagesDelivered": [
          {
            "day": 1,
            "sentAt": "2025-01-15T11:00:00.000Z",
            "delivered": true
          },
          {
            "day": 2,
            "sentAt": "2025-01-16T11:00:00.000Z",
            "delivered": true
          },
          {
            "day": 3,
            "sentAt": "2025-01-17T11:00:00.000Z",
            "delivered": true
          }
        ],
        "enrolledAt": "2025-01-15T10:00:00.000Z",
        "nextMessageDate": "2025-01-18T11:00:00.000Z"
      }
    ],
    "total": 42,
    "page": 1,
    "totalPages": 3
  }
}
```

---

## ⚙️ 2. Control Default Campaign

### Check Current Config Status

**Endpoint:** `GET /api/relance/status`

**Response:**
```json
{
  "success": true,
  "data": {
    "whatsappStatus": "connected",
    "enabled": true,
    "enrollmentPaused": false,
    "sendingPaused": false,
    "defaultCampaignPaused": false,
    "allowSimultaneousCampaigns": false,
    "messagesSentToday": 23,
    "maxMessagesPerDay": 50,
    "maxTargetsPerCampaign": 500,
    "lastConnectionCheck": "2025-01-20T14:25:00.000Z"
  }
}
```

### Update Campaign Control Settings

**Endpoint:** `PATCH /api/relance/config`

**Request Body:**
```json
{
  "defaultCampaignPaused": true,
  "allowSimultaneousCampaigns": false,
  "maxMessagesPerDay": 50,
  "maxTargetsPerCampaign": 500
}
```

**Response:**
```json
{
  "success": true,
  "message": "Configuration updated successfully",
  "data": {
    "defaultCampaignPaused": true,
    "allowSimultaneousCampaigns": false,
    "maxMessagesPerDay": 50,
    "maxTargetsPerCampaign": 500
  }
}
```

### Configuration Fields

| Field | Type | Description |
|-------|------|-------------|
| `defaultCampaignPaused` | boolean | **Manually pause/resume default campaign**<br>- `true`: Paused (no new enrollments)<br>- `false`: Active |
| `allowSimultaneousCampaigns` | boolean | **Control auto-pause behavior**<br>- `false`: Default campaign auto-pauses when filtered campaign starts (default)<br>- `true`: Both can run simultaneously |
| `maxMessagesPerDay` | number | Daily message limit (1-100, default: 50) |
| `maxTargetsPerCampaign` | number | Max targets per filtered campaign (default: 500) |

---

## 🔄 3. Automatic Pause/Resume Behavior

### When Does Default Campaign Auto-Pause?

The default campaign **automatically pauses** when:
1. User creates a filtered campaign AND
2. `allowSimultaneousCampaigns` is `false` (default)

**Backend Logic:**
```typescript
// When filtered campaign starts (campaign.service.ts:223-228)
if (config && !config.allowSimultaneousCampaigns) {
    config.defaultCampaignPaused = true;
    await config.save();
    log.info(`Paused default campaign due to filtered campaign start`);
}
```

### When Does It Auto-Resume?

The default campaign **automatically resumes** when:
1. All filtered campaigns are completed/cancelled AND
2. `defaultCampaignPaused` was `true`

**Backend Logic:**
```typescript
// When last filtered campaign completes (campaign.service.ts:337-343)
if (activeFilteredCampaigns === 0) {
    if (config && config.defaultCampaignPaused) {
        config.defaultCampaignPaused = false;
        await config.save();
        log.info(`Resumed default campaign after filtered campaigns ended`);
    }
}
```

---

## 📱 Frontend Implementation Examples

### Example 1: Display Default Campaign Dashboard

```javascript
// Fetch default campaign
const fetchDefaultCampaign = async () => {
  const response = await fetch('/api/relance/campaigns?type=default', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  const { data } = await response.json();
  const defaultCampaign = data.campaigns[0]; // Should only be one

  return {
    isActive: defaultCampaign?.status === 'active',
    totalEnrolled: defaultCampaign?.targetsEnrolled || 0,
    messagesSent: defaultCampaign?.messagesSent || 0,
    successRate: defaultCampaign?.messagesDelivered / defaultCampaign?.messagesSent * 100 || 0
  };
};
```

### Example 2: Check if Default Campaign is Paused

```javascript
// Check config status
const checkDefaultCampaignStatus = async () => {
  const response = await fetch('/api/relance/status', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  const { data } = await response.json();

  return {
    isPaused: data.defaultCampaignPaused,
    isAutoPaused: data.defaultCampaignPaused && !data.allowSimultaneousCampaigns,
    canRunWithFiltered: data.allowSimultaneousCampaigns
  };
};
```

### Example 3: Manually Pause/Resume Default Campaign

```javascript
// Pause default campaign
const pauseDefaultCampaign = async () => {
  await fetch('/api/relance/config', {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      defaultCampaignPaused: true
    })
  });
};

// Resume default campaign
const resumeDefaultCampaign = async () => {
  await fetch('/api/relance/config', {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      defaultCampaignPaused: false
    })
  });
};
```

### Example 4: Allow Simultaneous Campaigns

```javascript
// Enable running both campaigns at same time
const enableSimultaneousCampaigns = async (enabled) => {
  await fetch('/api/relance/config', {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      allowSimultaneousCampaigns: enabled
    })
  });
};
```

---

## 🎨 UI/UX Recommendations

### Default Campaign Status Display

```
┌─────────────────────────────────────────────┐
│ 📊 Campagne par défaut (Auto-inscription)  │
├─────────────────────────────────────────────┤
│ Status: ● Active                            │
│ Enrolled: 42 prospects                      │
│ Messages sent: 156                          │
│ Success rate: 94.9%                         │
│                                             │
│ [⏸ Pause Campaign]                         │
│                                             │
│ ☑️ Allow simultaneous campaigns            │
└─────────────────────────────────────────────┘
```

### When Auto-Paused by Filtered Campaign

```
┌─────────────────────────────────────────────┐
│ 📊 Campagne par défaut (Auto-inscription)  │
├─────────────────────────────────────────────┤
│ Status: ⏸ Paused (Auto)                    │
│                                             │
│ ℹ️ This campaign is automatically paused   │
│    because you have active filtered         │
│    campaigns running.                       │
│                                             │
│ It will resume automatically when all       │
│ filtered campaigns complete.                │
│                                             │
│ [▶ Resume Manually]                        │
│ ☑️ Allow simultaneous campaigns            │
└─────────────────────────────────────────────┘
```

---

## 🔍 Summary

| Feature | Endpoint | Method | Purpose |
|---------|----------|--------|---------|
| Get default campaign | `/api/relance/campaigns?type=default` | GET | Monitor progress |
| Get campaign details | `/api/relance/campaigns/:id` | GET | Detailed stats |
| Get enrolled targets | `/api/relance/campaigns/:id/targets` | GET | See who's enrolled |
| Check config status | `/api/relance/status` | GET | Current pause state |
| Pause/resume default | `/api/relance/config` | PATCH | Manual control |
| Enable simultaneous | `/api/relance/config` | PATCH | Allow both to run |

---

## ✅ Checklist for Frontend Implementation

- [ ] Display default campaign statistics
- [ ] Show pause/active status
- [ ] Indicate auto-pause vs manual pause
- [ ] Provide manual pause/resume button
- [ ] Add toggle for "Allow simultaneous campaigns"
- [ ] Show warning when pausing manually
- [ ] Display enrolled targets list
- [ ] Show message delivery success rate
- [ ] Refresh stats periodically (every 30-60s)

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)
