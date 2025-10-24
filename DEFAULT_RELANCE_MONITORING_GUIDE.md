# Default Relance (Auto-inscription) Monitoring & Control Guide

## Overview

The **Default Relance** (Auto-inscription automatique) is NOT a campaign - it's the automatic enrollment system that adds new unpaid referrals to the relance loop 1 hour after they register.

Unlike filtered campaigns which are stored as Campaign documents, the default relance works by:
1. Automatically detecting new unpaid referrals every hour
2. Creating RelanceTarget documents **without** a `campaignId`
3. Sending them WhatsApp messages for 7 days

This guide covers how to:
1. Monitor default relance progress
2. Control default relance behavior (pause/resume)
3. Understand automatic pausing when filtered campaigns are active

---

## 🎯 Key Differences: Default Relance vs Filtered Campaigns

| Feature | Default Relance | Filtered Campaigns |
|---------|----------------|-------------------|
| What is it? | Background enrollment system | Database Campaign documents |
| Database storage | **No** Campaign document | Yes, stored in `campaigns` collection |
| Target identification | `campaignId: null` or `undefined` | `campaignId: <campaign_id>` |
| Enrollment trigger | Automatic every hour | Manual start by user |
| Target selection | All unpaid referrals (1 hour old) | Filtered by criteria |
| Can be paused? | Yes (`defaultCampaignPaused`) | Yes (campaign status) |

---

## 📊 1. Monitor Default Relance Progress

### Get Default Relance Statistics

**Endpoint:** `GET /api/relance/campaigns/default/stats`

**Headers:**
```
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "isPaused": false,
    "totalEnrolled": 23,
    "activeTargets": 15,
    "completedRelance": 8,
    "totalMessagesSent": 67,
    "totalMessagesDelivered": 64,
    "deliveryPercentage": 95.52,
    "dayProgression": [
      { "day": 1, "count": 3 },
      { "day": 2, "count": 2 },
      { "day": 3, "count": 4 },
      { "day": 4, "count": 2 },
      { "day": 5, "count": 1 },
      { "day": 6, "count": 2 },
      { "day": 7, "count": 1 }
    ],
    "completedTargets": 8,
    "totalTargets": 23,
    "successRate": 95.52
  }
}
```

**Response Fields:**
| Field | Type | Description |
|-------|------|-------------|
| `isPaused` | boolean | Whether default relance is paused |
| `totalEnrolled` | number | Total referrals ever enrolled in default relance |
| `activeTargets` | number | Referrals currently in the 7-day loop (active) |
| `completedRelance` | number | Referrals who completed or exited the loop |
| `totalMessagesSent` | number | Total messages sent across all default targets |
| `totalMessagesDelivered` | number | Successfully delivered messages |
| `deliveryPercentage` | number | Delivery success rate (0-100%) |
| `dayProgression` | array | Day-by-day breakdown (Day 1-7) with count of active targets on each day |
| `completedTargets` | number | (Legacy) Same as `completedRelance` |
| `totalTargets` | number | (Legacy) Same as `totalEnrolled` |
| `successRate` | number | (Legacy) Same as `deliveryPercentage` |

### Get Enrolled Referrals (Default Targets)

**Endpoint:** `GET /api/relance/campaigns/default/targets`

**Query Parameters:**
- `page`: Page number (default: 1)
- `limit`: Items per page (default: 20)
- `status`: Filter by status (`active`, `completed`, `paused`)

**Example:**
```javascript
GET /api/relance/campaigns/default/targets?page=1&limit=10&status=active
```

**Response:**
```json
{
  "success": true,
  "data": {
    "targets": [
      {
        "_id": "target_id",
        "referralUserId": {
          "_id": "user_id",
          "name": "Jean Dupont",
          "email": "jean@example.com",
          "phoneNumber": "237670123456"
        },
        "referrerUserId": "referrer_id",
        "campaignId": null,
        "enteredLoopAt": "2025-01-20T10:00:00.000Z",
        "currentDay": 3,
        "nextMessageDue": "2025-01-23T11:00:00.000Z",
        "lastMessageSentAt": "2025-01-22T11:00:00.000Z",
        "messagesDelivered": [
          {
            "day": 1,
            "sentAt": "2025-01-20T11:00:00.000Z",
            "status": "delivered"
          },
          {
            "day": 2,
            "sentAt": "2025-01-21T11:00:00.000Z",
            "status": "delivered"
          },
          {
            "day": 3,
            "sentAt": "2025-01-22T11:00:00.000Z",
            "status": "delivered"
          }
        ],
        "status": "active",
        "language": "fr",
        "createdAt": "2025-01-20T09:00:00.000Z",
        "updatedAt": "2025-01-22T11:05:00.000Z"
      }
    ],
    "total": 15,
    "page": 1,
    "totalPages": 2
  }
}
```

---

## ⚙️ 2. Control Default Relance

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
    "lastConnectionCheck": "2025-01-20T14:25:00.000Z"
  }
}
```

### Pause/Resume Default Relance

**Endpoint:** `PATCH /api/relance/config`

**Pause Default Relance:**
```json
{
  "defaultCampaignPaused": true
}
```

**Resume Default Relance:**
```json
{
  "defaultCampaignPaused": false
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

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `defaultCampaignPaused` | boolean | `false` | **Manually pause/resume default relance**<br>- `true`: No new enrollments<br>- `false`: Auto-enroll new referrals |
| `allowSimultaneousCampaigns` | boolean | `false` | **Control auto-pause behavior**<br>- `false`: Default auto-pauses when filtered campaign starts<br>- `true`: Both can run together |
| `enrollmentPaused` | boolean | `false` | Pause ALL enrollments (default + filtered) |
| `sendingPaused` | boolean | `false` | Pause ALL message sending |
| `enabled` | boolean | `true` | Master switch - disables everything |

---

## 🔄 3. Automatic Pause/Resume Behavior

### When Does Default Relance Auto-Pause?

The default relance **automatically pauses** when:
1. User creates and starts a filtered campaign AND
2. `allowSimultaneousCampaigns` is `false` (default setting)

**What happens:**
```
User starts filtered campaign
    ↓
System checks: allowSimultaneousCampaigns == false
    ↓
defaultCampaignPaused = true
    ↓
No new referrals enrolled in default relance
    ↓
Existing default targets continue receiving messages
```

**Backend Logic** ([campaign.service.ts:223-228](notification-service/src/services/campaign.service.ts#L223-L228)):
```typescript
if (config && !config.allowSimultaneousCampaigns) {
    config.defaultCampaignPaused = true;
    await config.save();
    log.info(`Paused default campaign due to filtered campaign start`);
}
```

### When Does It Auto-Resume?

The default relance **automatically resumes** when:
1. All filtered campaigns complete or are cancelled AND
2. `defaultCampaignPaused` was `true` (auto-paused)

**What happens:**
```
Last filtered campaign completes
    ↓
System checks: Are there any active filtered campaigns?
    ↓
If NO active campaigns found
    ↓
defaultCampaignPaused = false
    ↓
Default relance resumes enrolling new referrals
```

**Backend Logic** ([campaign.service.ts:337-343](notification-service/src/services/campaign.service.ts#L337-L343)):
```typescript
if (activeFilteredCampaigns === 0) {
    if (config && config.defaultCampaignPaused) {
        config.defaultCampaignPaused = false;
        await config.save();
        log.info(`Resumed default relance after filtered campaigns ended`);
    }
}
```

---

## 📱 Frontend Implementation Examples

### Example 1: Display Default Relance Dashboard

```javascript
const DefaultRelanceDashboard = () => {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    const fetchStats = async () => {
      const response = await fetch('/api/relance/campaigns/default/stats', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      const { data } = await response.json();
      setStats(data);
    };

    fetchStats();
    // Refresh every 30 seconds
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, []);

  if (!stats) return <Loading />;

  return (
    <div className="dashboard">
      <h2>Relance par défaut (Auto-inscription)</h2>

      <div className="status">
        {stats.isPaused ? (
          <span className="badge paused">⏸ En pause</span>
        ) : (
          <span className="badge active">● Actif</span>
        )}
      </div>

      <div className="stats">
        <div className="stat-card">
          <h3>Prospects actifs</h3>
          <p className="number">{stats.activeTargets}</p>
        </div>
        <div className="stat-card">
          <h3>Messages envoyés</h3>
          <p className="number">{stats.totalMessagesSent}</p>
        </div>
        <div className="stat-card">
          <h3>Taux de succès</h3>
          <p className="number">{stats.successRate.toFixed(1)}%</p>
        </div>
      </div>
    </div>
  );
};
```

### Example 2: Pause/Resume Control

```javascript
const PauseControl = () => {
  const [isPaused, setIsPaused] = useState(false);
  const [loading, setLoading] = useState(false);

  const togglePause = async () => {
    setLoading(true);

    try {
      await fetch('/api/relance/config', {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          defaultCampaignPaused: !isPaused
        })
      });

      setIsPaused(!isPaused);
    } catch (error) {
      console.error('Failed to toggle pause:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button onClick={togglePause} disabled={loading}>
      {isPaused ? '▶ Reprendre' : '⏸ Mettre en pause'}
    </button>
  );
};
```

### Example 3: Auto-Pause Indicator

```javascript
const AutoPauseWarning = ({ config }) => {
  const isAutoPaused = config.defaultCampaignPaused && !config.allowSimultaneousCampaigns;

  if (!isAutoPaused) return null;

  return (
    <div className="alert info">
      <h4>ℹ️ Relance par défaut en pause automatique</h4>
      <p>
        La relance par défaut est automatiquement en pause car vous avez
        des campagnes filtrées actives.
      </p>
      <p>
        Elle reprendra automatiquement lorsque toutes les campagnes filtrées
        seront terminées.
      </p>
      <label>
        <input
          type="checkbox"
          checked={config.allowSimultaneousCampaigns}
          onChange={(e) => updateConfig({
            allowSimultaneousCampaigns: e.target.checked
          })}
        />
        Autoriser les campagnes simultanées
      </label>
    </div>
  );
};
```

### Example 4: Enrolled Targets List

```javascript
const DefaultTargetsList = () => {
  const [targets, setTargets] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    const fetchTargets = async () => {
      const response = await fetch(
        `/api/relance/campaigns/default/targets?page=${page}&limit=10&status=active`,
        {
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );

      const { data } = await response.json();
      setTargets(data.targets);
      setTotalPages(data.totalPages);
    };

    fetchTargets();
  }, [page]);

  return (
    <div>
      <h3>Prospects en cours (Relance par défaut)</h3>
      <table>
        <thead>
          <tr>
            <th>Nom</th>
            <th>Téléphone</th>
            <th>Jour actuel</th>
            <th>Messages livrés</th>
            <th>Prochain message</th>
          </tr>
        </thead>
        <tbody>
          {targets.map(target => (
            <tr key={target._id}>
              <td>{target.referralUserId?.name}</td>
              <td>{target.referralUserId?.phoneNumber}</td>
              <td>Jour {target.currentDay}/7</td>
              <td>
                {target.messagesDelivered.filter(m => m.status === 'delivered').length}
                /{target.messagesDelivered.length}
              </td>
              <td>{new Date(target.nextMessageDue).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <Pagination page={page} totalPages={totalPages} onChange={setPage} />
    </div>
  );
};
```

---

## 🎨 UI/UX Recommendations

### Default Relance Status Display

**When Active:**
```
┌─────────────────────────────────────────────┐
│ 📊 Relance par défaut (Auto-inscription)   │
├─────────────────────────────────────────────┤
│ Status: ● Actif                             │
│                                             │
│ Prospects actifs: 15                        │
│ Messages envoyés: 67                        │
│ Taux de succès: 95.5%                       │
│                                             │
│ [⏸ Mettre en pause]                        │
│ ☐ Autoriser campagnes simultanées          │
└─────────────────────────────────────────────┘
```

**When Auto-Paused:**
```
┌─────────────────────────────────────────────┐
│ 📊 Relance par défaut (Auto-inscription)   │
├─────────────────────────────────────────────┤
│ Status: ⏸ En pause (Automatique)           │
│                                             │
│ ℹ️ En pause car vous avez des campagnes    │
│    filtrées actives.                        │
│                                             │
│ Reprendra automatiquement quand toutes      │
│ les campagnes filtrées seront terminées.   │
│                                             │
│ Prospects actifs: 8 (continueront à        │
│ recevoir leurs messages)                    │
│                                             │
│ [▶ Forcer la reprise]                      │
│ ☑️ Autoriser campagnes simultanées         │
└─────────────────────────────────────────────┘
```

**When Manually Paused:**
```
┌─────────────────────────────────────────────┐
│ 📊 Relance par défaut (Auto-inscription)   │
├─────────────────────────────────────────────┤
│ Status: ⏸ En pause (Manuel)                │
│                                             │
│ ⚠️ Vous avez mis la relance en pause.      │
│    Aucun nouveau prospect ne sera ajouté.  │
│                                             │
│ [▶ Reprendre la relance]                   │
└─────────────────────────────────────────────┘
```

---

## 🔍 API Summary

| Feature | Endpoint | Method | Purpose |
|---------|----------|--------|---------|
| Get stats | `/api/relance/campaigns/default/stats` | GET | Monitor default relance progress |
| Get targets | `/api/relance/campaigns/default/targets` | GET | See enrolled referrals |
| Check config | `/api/relance/status` | GET | Current pause state |
| Pause/resume | `/api/relance/config` | PATCH | Manual control |
| Enable simultaneous | `/api/relance/config` | PATCH | Allow both to run |

---

## ✅ Frontend Checklist

- [ ] Display default relance statistics
- [ ] Show active/paused status with badge
- [ ] Distinguish auto-pause vs manual pause
- [ ] Provide manual pause/resume button
- [ ] Add "Allow simultaneous campaigns" toggle
- [ ] Show warning when pausing manually
- [ ] Display enrolled targets list with pagination
- [ ] Show message delivery progress (Day X/7)
- [ ] Display success rate
- [ ] Refresh stats every 30-60 seconds
- [ ] Explain auto-pause behavior to user

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)
