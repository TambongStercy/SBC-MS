# Campaign API Testing Guide

## Overview

This guide shows how to test the new **Filtered Relance Campaign** API endpoints.

---

## Base URL

```
http://localhost:3002/api/relance
```

---

## Authentication

All campaign endpoints require authentication. Include JWT token in header:

```
Authorization: Bearer <your-jwt-token>
```

---

## API Endpoints

### 1. **Preview Filter Results** (with Sample Users)

Get a preview of how many users match your filters, plus 5 sample users.

**Endpoint:** `POST /api/relance/campaigns/preview`

**Request Body:**
```json
{
  "userId": "65d2b0344a7e2b9efbf6205d",
  "targetFilter": {
    "countries": ["CM", "NG"],
    "gender": "all",
    "registrationDateFrom": "2024-01-01",
    "registrationDateTo": "2025-12-31",
    "professions": ["Engineer", "Teacher"],
    "minAge": 18,
    "maxAge": 45,
    "excludeCurrentTargets": true
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "totalCount": 42,
    "sampleUsers": [
      {
        "_id": "675e56b891e9691b6fe52ad9",
        "name": "John Doe",
        "email": "john@example.com",
        "phoneNumber": "+237612345678",
        "country": "CM",
        "gender": "male",
        "profession": "Engineer",
        "age": 28,
        "createdAt": "2024-12-15T10:30:00Z"
      },
      {
        "_id": "6752218a5f31f4b2fa75311e",
        "name": "Jane Smith",
        "email": "jane@example.com",
        "phoneNumber": "+237698765432",
        "country": "CM",
        "gender": "female",
        "profession": "Teacher",
        "age": 32,
        "createdAt": "2024-11-20T08:15:00Z"
      }
      // ... 3 more sample users
    ],
    "message": "42 users match the selected filters"
  }
}
```

---

### 2. **Create Campaign**

Create a new filtered campaign.

**Endpoint:** `POST /api/relance/campaigns`

**Request Body:**
```json
{
  "userId": "65d2b0344a7e2b9efbf6205d",
  "name": "Cameroon Professionals March 2025",
  "targetFilter": {
    "countries": ["CM"],
    "gender": "all",
    "registrationDateFrom": "2024-03-01",
    "registrationDateTo": "2025-03-31",
    "professions": ["Engineer", "Teacher", "Doctor"],
    "minAge": 20,
    "maxAge": 50,
    "excludeCurrentTargets": true
  },
  "scheduledStartDate": null,
  "runAfterCampaignId": null,
  "maxMessagesPerDay": 30,
  "customMessages": [
    {
      "dayNumber": 1,
      "messageTemplate": {
        "fr": "Bonjour {{name}}, nous avons remarqué que vous n'avez pas encore souscrit...",
        "en": "Hello {{name}}, we noticed you haven't subscribed yet..."
      },
      "mediaUrls": [
        {
          "url": "https://example.com/image.jpg",
          "type": "image"
        }
      ]
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "message": "Campaign created successfully",
  "data": {
    "_id": "68e12345abcd1234ef567890",
    "userId": "65d2b0344a7e2b9efbf6205d",
    "name": "Cameroon Professionals March 2025",
    "type": "filtered",
    "status": "draft",
    "targetFilter": { ... },
    "estimatedTargetCount": 42,
    "estimatedEndDate": "2025-04-15T00:00:00Z",
    "createdAt": "2025-01-04T12:00:00Z"
  }
}
```

---

### 3. **Start Campaign**

Activate a campaign to begin enrollment.

**Endpoint:** `POST /api/relance/campaigns/:id/start`

**Request Body:**
```json
{
  "userId": "65d2b0344a7e2b9efbf6205d"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Campaign started successfully"
}
```

**Note:** Starting a filtered campaign will automatically pause the default auto-enrollment campaign (unless `allowSimultaneousCampaigns` is enabled).

---

### 4. **Get All Campaigns**

List all campaigns for a user.

**Endpoint:** `GET /api/relance/campaigns?userId=65d2b0344a7e2b9efbf6205d`

**Query Parameters:**
- `status` (optional): Filter by status (`draft`, `scheduled`, `active`, `paused`, `completed`, `cancelled`)
- `type` (optional): Filter by type (`default`, `filtered`)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "68e12345abcd1234ef567890",
      "name": "Cameroon Professionals March 2025",
      "type": "filtered",
      "status": "active",
      "targetsEnrolled": 15,
      "messagesSent": 45,
      "messagesDelivered": 42,
      "messagesFailed": 3,
      "targetsCompleted": 2,
      "targetsExited": 1,
      "createdAt": "2025-01-04T12:00:00Z",
      "actualStartDate": "2025-01-04T12:05:00Z"
    }
  ]
}
```

---

### 5. **Get Campaign Details**

Get detailed information about a specific campaign.

**Endpoint:** `GET /api/relance/campaigns/:id`

**Response:**
```json
{
  "success": true,
  "data": {
    "campaign": {
      "_id": "68e12345abcd1234ef567890",
      "userId": "65d2b0344a7e2b9efbf6205d",
      "name": "Cameroon Professionals March 2025",
      "type": "filtered",
      "status": "active",
      "targetFilter": {
        "countries": ["CM"],
        "gender": "all",
        "professions": ["Engineer", "Teacher", "Doctor"],
        "minAge": 20,
        "maxAge": 50
      },
      "estimatedTargetCount": 42,
      "actualTargetCount": 15,
      "targetsEnrolled": 15,
      "messagesSent": 45,
      "messagesDelivered": 42,
      "messagesFailed": 3,
      "targetsCompleted": 2,
      "targetsExited": 1,
      "maxMessagesPerDay": 30,
      "createdAt": "2025-01-04T12:00:00Z",
      "actualStartDate": "2025-01-04T12:05:00Z"
    },
    "targets": [
      {
        "_id": "68e12346xyz987",
        "referralUserId": "675e56b891e9691b6fe52ad9",
        "referrerUserId": "65d2b0344a7e2b9efbf6205d",
        "campaignId": "68e12345abcd1234ef567890",
        "currentDay": 3,
        "status": "active",
        "messagesDelivered": [
          { "day": 1, "sentAt": "2025-01-04T18:00:00Z", "status": "delivered" },
          { "day": 2, "sentAt": "2025-01-05T18:00:00Z", "status": "delivered" },
          { "day": 3, "sentAt": "2025-01-06T18:00:00Z", "status": "delivered" }
        ],
        "createdAt": "2025-01-04T12:05:10Z"
      }
      // ... more targets (up to 100)
    ]
  }
}
```

---

### 6. **Get Campaign Targets** (Paginated)

Get targets for a specific campaign with pagination.

**Endpoint:** `GET /api/relance/campaigns/:id/targets?page=1&limit=50`

**Query Parameters:**
- `page` (default: 1): Page number
- `limit` (default: 50): Items per page
- `status` (optional): Filter by status (`active`, `completed`, `paused`)

**Response:**
```json
{
  "success": true,
  "data": {
    "targets": [ ... ],
    "pagination": {
      "page": 1,
      "limit": 50,
      "total": 150,
      "pages": 3
    }
  }
}
```

---

### 7. **Pause Campaign**

Temporarily pause a running campaign.

**Endpoint:** `POST /api/relance/campaigns/:id/pause`

**Request Body:**
```json
{
  "userId": "65d2b0344a7e2b9efbf6205d"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Campaign paused successfully"
}
```

---

### 8. **Resume Campaign**

Resume a paused campaign.

**Endpoint:** `POST /api/relance/campaigns/:id/resume`

**Request Body:**
```json
{
  "userId": "65d2b0344a7e2b9efbf6205d"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Campaign resumed successfully"
}
```

---

### 9. **Cancel Campaign**

Cancel a campaign and exit all its targets.

**Endpoint:** `POST /api/relance/campaigns/:id/cancel`

**Request Body:**
```json
{
  "userId": "65d2b0344a7e2b9efbf6205d",
  "reason": "User requested cancellation"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Campaign cancelled successfully"
}
```

**Note:** Cancelling the last active filtered campaign will automatically resume the default auto-enrollment campaign.

---

### 10. **Update Relance Config**

Update campaign settings and limits.

**Endpoint:** `PATCH /api/relance/config`

**Request Body:**
```json
{
  "userId": "65d2b0344a7e2b9efbf6205d",
  "defaultCampaignPaused": false,
  "allowSimultaneousCampaigns": true,
  "maxMessagesPerDay": 75,
  "maxTargetsPerCampaign": 300
}
```

**Response:**
```json
{
  "success": true,
  "message": "Configuration updated successfully",
  "data": {
    "_id": "68e00000config123",
    "userId": "65d2b0344a7e2b9efbf6205d",
    "enabled": true,
    "enrollmentPaused": false,
    "sendingPaused": false,
    "defaultCampaignPaused": false,
    "allowSimultaneousCampaigns": true,
    "whatsappStatus": "connected",
    "messagesSentToday": 12,
    "maxMessagesPerDay": 75,
    "maxTargetsPerCampaign": 300,
    "lastResetDate": "2025-01-04T00:00:00Z"
  }
}
```

**Field Validations:**
- `maxMessagesPerDay`: Min 1, Max 100
- `maxTargetsPerCampaign`: Min 10, Max 1000

---

## Complete Testing Flow

### Scenario: Create and Run a Filtered Campaign

```bash
# Step 1: Preview filter results
POST /api/relance/campaigns/preview
{
  "userId": "65d2b0344a7e2b9efbf6205d",
  "targetFilter": {
    "countries": ["CM"],
    "gender": "all"
  }
}

# Response shows: 42 users match, with 5 sample users displayed

# Step 2: Create campaign
POST /api/relance/campaigns
{
  "userId": "65d2b0344a7e2b9efbf6205d",
  "name": "Cameroon Test Campaign",
  "targetFilter": {
    "countries": ["CM"],
    "gender": "all"
  },
  "maxMessagesPerDay": 30
}

# Response returns campaign ID: "68e12345abcd1234ef567890"

# Step 3: Start campaign
POST /api/relance/campaigns/68e12345abcd1234ef567890/start
{
  "userId": "65d2b0344a7e2b9efbf6205d"
}

# Campaign starts, default auto-enrollment pauses

# Step 4: Monitor progress
GET /api/relance/campaigns/68e12345abcd1234ef567890

# Shows:
# - targetsEnrolled: 15
# - messagesSent: 45
# - messagesDelivered: 42
# - messagesFailed: 3

# Step 5: Check targets
GET /api/relance/campaigns/68e12345abcd1234ef567890/targets?page=1&limit=10

# Shows first 10 targets with delivery history

# Step 6: Pause campaign (if needed)
POST /api/relance/campaigns/68e12345abcd1234ef567890/pause
{
  "userId": "65d2b0344a7e2b9efbf6205d"
}

# Step 7: Resume campaign
POST /api/relance/campaigns/68e12345abcd1234ef567890/resume
{
  "userId": "65d2b0344a7e2b9efbf6205d"
}

# Step 8: View all campaigns
GET /api/relance/campaigns?userId=65d2b0344a7e2b9efbf6205d&status=active

# Step 9: Enable simultaneous campaigns
PATCH /api/relance/config
{
  "userId": "65d2b0344a7e2b9efbf6205d",
  "allowSimultaneousCampaigns": true
}

# Now default + filtered can run together
```

---

## Testing with curl

### Preview Filters
```bash
curl -X POST http://localhost:3002/api/relance/campaigns/preview \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "userId": "65d2b0344a7e2b9efbf6205d",
    "targetFilter": {
      "countries": ["CM"],
      "gender": "all"
    }
  }'
```

### Create Campaign
```bash
curl -X POST http://localhost:3002/api/relance/campaigns \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "userId": "65d2b0344a7e2b9efbf6205d",
    "name": "Test Campaign",
    "targetFilter": {
      "countries": ["CM"]
    }
  }'
```

### Start Campaign
```bash
curl -X POST http://localhost:3002/api/relance/campaigns/CAMPAIGN_ID/start \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "userId": "65d2b0344a7e2b9efbf6205d"
  }'
```

### Get Campaigns
```bash
curl -X GET "http://localhost:3002/api/relance/campaigns?userId=65d2b0344a7e2b9efbf6205d" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

## Filter Options Reference

### Available Filters

| Filter | Type | Description | Example |
|--------|------|-------------|---------|
| `countries` | `string[]` | Array of country codes | `["CM", "NG", "CI"]` |
| `registrationDateFrom` | `string` (ISO date) | Start date for registration range | `"2024-01-01"` |
| `registrationDateTo` | `string` (ISO date) | End date for registration range | `"2025-12-31"` |
| `gender` | `string` | Gender filter | `"male"`, `"female"`, `"other"`, `"all"` |
| `professions` | `string[]` | Array of professions | `["Engineer", "Teacher"]` |
| `minAge` | `number` | Minimum age | `18` |
| `maxAge` | `number` | Maximum age | `45` |
| `excludeCurrentTargets` | `boolean` | Exclude users already in campaigns | `true` |

---

## Error Responses

### Invalid Filter
```json
{
  "success": false,
  "message": "Filter matches 0 targets, exceeds limit of 500"
}
```

### Campaign Not Found
```json
{
  "success": false,
  "message": "Campaign not found"
}
```

### Invalid Status Transition
```json
{
  "success": false,
  "message": "Cannot start campaign with status: completed"
}
```

### No Subscription
```json
{
  "success": false,
  "message": "User does not have active RELANCE subscription"
}
```

---

## Next Steps

After testing the API:

1. **Build Frontend UI** - Create campaign management interface
2. **Add Safety Features** - Opt-in/opt-out, monitoring
3. **Production Values** - Change testing timeframes to production values
4. **Consider WhatsApp Business API** - Migrate from Baileys for production

---

## Support

For issues or questions, check:
- `FILTERED_RELANCE_IMPLEMENTATION_PLAN.md` - Complete architecture
- `PHASE_2_3_COMPLETION_SUMMARY.md` - Implementation details
- Server logs in notification service
