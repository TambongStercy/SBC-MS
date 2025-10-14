# Campaign API - Quick Start Guide

## 🚀 Ready to Use!

The filtered relance campaign system is **fully functional**. Here's how to get started:

---

## Step 1: Preview Your Filters

See who matches your criteria + get 5 sample users:

```bash
curl -X POST http://localhost:3002/api/relance/campaigns/preview \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "YOUR_USER_ID",
    "targetFilter": {
      "countries": ["CM"],
      "gender": "all"
    }
  }'
```

**Response:** Shows total count + 5 sample users with names, emails, phones

---

## Step 2: Create Campaign

```bash
curl -X POST http://localhost:3002/api/relance/campaigns \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "YOUR_USER_ID",
    "name": "My First Campaign",
    "targetFilter": {
      "countries": ["CM"],
      "gender": "all"
    },
    "maxMessagesPerDay": 30
  }'
```

**Response:** Returns `campaign._id`

---

## Step 3: Start Campaign

```bash
curl -X POST http://localhost:3002/api/relance/campaigns/CAMPAIGN_ID/start \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "YOUR_USER_ID"
  }'
```

**What Happens:**
1. Campaign status → `active`
2. Default campaign pauses (unless simultaneous mode enabled)
3. Enrollment job starts adding matching users
4. Sender job starts sending messages

---

## Step 4: Monitor Progress

```bash
curl -X GET http://localhost:3002/api/relance/campaigns/CAMPAIGN_ID \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Response shows:**
- `targetsEnrolled`: How many enrolled
- `messagesSent`: Total messages sent
- `messagesDelivered`: Successfully delivered
- `messagesFailed`: Failed deliveries
- `targetsCompleted`: Finished 7-day cycle

---

## Filter Options

```json
{
  "targetFilter": {
    "countries": ["CM", "NG"],              // Country codes
    "gender": "all",                        // "male", "female", "other", "all"
    "professions": ["Engineer", "Teacher"], // List of professions
    "minAge": 18,                           // Minimum age
    "maxAge": 45,                           // Maximum age
    "registrationDateFrom": "2024-01-01",   // Start date
    "registrationDateTo": "2025-12-31",     // End date
    "excludeCurrentTargets": true           // Skip users already in campaigns
  }
}
```

---

## Available Actions

```bash
# List all campaigns
GET /api/relance/campaigns?userId=YOUR_USER_ID

# Get campaign details
GET /api/relance/campaigns/CAMPAIGN_ID

# Pause campaign
POST /api/relance/campaigns/CAMPAIGN_ID/pause

# Resume campaign
POST /api/relance/campaigns/CAMPAIGN_ID/resume

# Cancel campaign
POST /api/relance/campaigns/CAMPAIGN_ID/cancel

# Update config (enable simultaneous campaigns, change limits)
PATCH /api/relance/config
```

---

## Enable Simultaneous Campaigns

Run default + filtered together:

```bash
curl -X PATCH http://localhost:3002/api/relance/config \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "YOUR_USER_ID",
    "allowSimultaneousCampaigns": true,
    "maxMessagesPerDay": 75,
    "maxTargetsPerCampaign": 300
  }'
```

---

## 📚 Full Documentation

- **API Guide:** `CAMPAIGN_API_TESTING_GUIDE.md`
- **Architecture:** `FILTERED_RELANCE_IMPLEMENTATION_PLAN.md`
- **Implementation:** `PHASE_2_3_COMPLETION_SUMMARY.md`
- **This Phase:** `PHASE_4_API_COMPLETION_SUMMARY.md`

---

## ⚠️ Important Notes

1. **All endpoints require JWT authentication**
2. **Preview before creating** - see sample users first!
3. **Monitor progress** - check delivery rates
4. **Default campaign auto-pauses** when filtered starts (unless simultaneous mode)
5. **System runs on startup** - enrollment & sender jobs activate immediately

---

## Need Help?

Check server logs:
```bash
# Watch notification service logs
docker-compose logs -f notification-service
```

Look for:
- `[Relance Enrollment]` - Enrollment job activity
- `[Relance Sender]` - Message sending activity
- `[Campaign:...]` - Campaign-specific logs
