# Phase 2 & 3 Completion Summary - Filtered Relance System

## ✅ Completed Components

### **Phase 1: Core Infrastructure** (Previously Completed)
- ✅ Campaign Model with filtering, scheduling, queuing
- ✅ Updated RelanceTarget Model with campaign linking
- ✅ Updated RelanceConfig Model with campaign controls
- ✅ Campaign Service with validation and lifecycle management

### **Phase 2: Enrollment Logic** (✅ **JUST COMPLETED**)
- ✅ Updated enrollment job to support both default and filtered campaigns
- ✅ Implemented `enrollDefaultTargets()` - Auto-enrollment from unpaid referrals
- ✅ Implemented `enrollFilteredTargets()` - Manual filter-based enrollment
- ✅ Added auto-start logic for scheduled campaigns
- ✅ Comprehensive filtering support:
  - Country filtering
  - Registration date range filtering
  - Gender filtering
  - Profession filtering
  - Age range filtering
  - Exclude existing targets option
- ✅ Campaign limits enforcement:
  - Max targets per campaign (default: 500)
  - Daily message limits per campaign
  - User daily message limits

### **Phase 3: Sending Logic** (✅ **JUST COMPLETED**)
- ✅ Updated sender job to handle multiple campaigns simultaneously
- ✅ Campaign-specific message templates support
- ✅ Campaign progress tracking (messages sent, delivered, failed)
- ✅ Auto-completion logic for campaigns
- ✅ Auto-resume default campaign when last filtered completes
- ✅ Daily message counter reset (midnight cron)
- ✅ 2-minute delay between messages (rate limiting)
- ✅ Campaign stats updates

---

## How It Works Now

### **Enrollment Flow**

1. **Server starts** → Runs enrollment job immediately, then hourly
2. **Check for scheduled campaigns** → Auto-start campaigns that should begin
3. **Process users**:
   - Get all users with active RELANCE subscriptions and connected WhatsApp
   - For each user:
     - **Default Campaign** (if not paused):
       - Enroll unpaid referrals > 10 minutes old
       - Create targets with `campaignId: null`
     - **Filtered Campaigns** (all active):
       - Apply filters to unpaid referrals
       - Enroll matching referrals
       - Create targets linked to campaign
       - Update campaign stats

### **Sender Flow**

1. **Server starts** → Runs sender job immediately, then every 6 hours
2. **Find all active targets** with `nextMessageDue <= now`
3. **For each target**:
   - Check if belongs to campaign or default
   - Check daily limits (config + campaign)
   - Get message template (campaign custom or default)
   - Personalize message with {{name}}, {{referrerName}}, {{day}}
   - Send via WhatsApp
   - Update target progress (day counter, next message time)
   - Update campaign stats
   - If day 7 complete → exit target, mark campaign target as completed
4. **Check campaign completion**:
   - If campaign has 0 active targets → mark as COMPLETED
   - If user has 0 active filtered campaigns → resume default campaign

### **Campaign Lifecycle**

```
DRAFT → SCHEDULED → ACTIVE → COMPLETED
                    ↓
                  PAUSED → ACTIVE
                    ↓
                CANCELLED
```

**State Transitions:**
- `DRAFT → SCHEDULED`: User schedules start date or queues behind another campaign
- `DRAFT/SCHEDULED → ACTIVE`: User manually starts or auto-start triggers
- `ACTIVE → PAUSED`: User pauses campaign
- `PAUSED → ACTIVE`: User resumes campaign
- `ACTIVE → COMPLETED`: All targets finish 7-day cycle
- `ANY → CANCELLED`: User cancels campaign

---

## Key Features Implemented

### **1. Filtering System**

Users can filter referrals by:
- **Countries**: Array of country codes (e.g., ["CM", "NG"])
- **Registration Date Range**: From/To dates
- **Gender**: male, female, other, all
- **Professions**: Array of professions
- **Age Range**: Min/Max age
- **Exclude Current Targets**: Don't include users already in active campaigns

### **2. Default Campaign Control**

- When filtered campaign starts → `defaultCampaignPaused = true`
- When last filtered campaign completes → `defaultCampaignPaused = false`
- User can enable `allowSimultaneousCampaigns` to run both together

### **3. Campaign Scheduling & Queuing**

- **Scheduled Start**: Set `scheduledStartDate`, auto-starts when time arrives
- **Queue Behind Campaign**: Set `runAfterCampaignId`, auto-starts when parent completes
- **Priority**: Lower number = higher priority

### **4. Rate Limiting (Safety)**

- User-level: `maxMessagesPerDay` (default: 50)
- Campaign-level: Can override per campaign
- Max targets per campaign: 500 (default, configurable)
- **2-minute delay** between each message (line 246 in sender job)

### **5. Progress Tracking**

Each campaign tracks:
- `targetsEnrolled`: How many enrolled
- `messagesSent`: Total messages sent
- `messagesDelivered`: Successfully delivered
- `messagesFailed`: Failed to send
- `targetsCompleted`: Finished 7-day cycle
- `targetsExited`: Exited early

### **6. Custom Messages**

Campaigns can override default messages:
```typescript
customMessages: [
  {
    dayNumber: 1,
    messageTemplate: {
      fr: "Bonjour {{name}}...",
      en: "Hello {{name}}..."
    },
    mediaUrls: [
      { url: "https://...", type: "image" }
    ]
  }
]
```

---

## Testing the System

### **Test Scenario 1: Create Filtered Campaign**

1. Restart notification service
2. Enrollment job will run immediately
3. Check logs for:
   ```
   [Relance Enrollment] [Default] User 65d2b... has X unpaid referrals
   ```

### **Test Scenario 2: Create Campaign via Code**

```typescript
import { campaignService } from './services/campaign.service';

// Create filtered campaign
const result = await campaignService.createCampaign(
  '65d2b0344a7e2b9efbf6205d', // userId
  'Cameroon Test Campaign',     // name
  {
    countries: ['CM'],
    gender: 'all',
    registrationDateFrom: new Date('2024-01-01'),
    excludeCurrentTargets: true
  },
  {
    scheduledStartDate: new Date(), // Start immediately
    maxMessagesPerDay: 20
  }
);

// Start campaign
if (result.success && result.campaign) {
  await campaignService.startCampaign(
    result.campaign._id.toString(),
    userId
  );
}
```

### **Test Scenario 3: Monitor Campaign Progress**

```typescript
// Get user's campaigns
const campaigns = await CampaignModel.find({ userId });

campaigns.forEach(campaign => {
  console.log(`Campaign: ${campaign.name}`);
  console.log(`Status: ${campaign.status}`);
  console.log(`Targets Enrolled: ${campaign.targetsEnrolled}`);
  console.log(`Messages Sent: ${campaign.messagesSent}`);
  console.log(`Messages Delivered: ${campaign.messagesDelivered}`);
  console.log(`Messages Failed: ${campaign.messagesFailed}`);
  console.log(`Targets Completed: ${campaign.targetsCompleted}`);
});
```

---

## What's Next (Phase 4)

To complete the filtered relance feature, you need:

### **1. Campaign API Endpoints** (6-8 hours)

Create REST API endpoints for campaign management:
- `POST /api/relance/campaigns` - Create campaign
- `GET /api/relance/campaigns` - List campaigns
- `GET /api/relance/campaigns/:id` - Get campaign details
- `POST /api/relance/campaigns/:id/start` - Start campaign
- `POST /api/relance/campaigns/:id/pause` - Pause campaign
- `POST /api/relance/campaigns/:id/resume` - Resume campaign
- `POST /api/relance/campaigns/:id/cancel` - Cancel campaign
- `POST /api/relance/campaigns/estimate` - Estimate target count
- `PATCH /api/relance/config` - Update config (allow simultaneous, limits)

### **2. Frontend UI** (10-12 hours)

Create admin pages:
- Campaign creation wizard with filter UI
- Campaign list page with status indicators
- Campaign details page with progress charts
- Campaign scheduling/queuing UI
- Settings page for simultaneous mode toggle

### **3. Safety Features** (6-8 hours)

Critical for production:
- Opt-in/opt-out mechanism
- "Reply STOP to unsubscribe" in messages
- Block rate monitoring
- Auto-pause on high failure rate
- WhatsApp ban risk warnings

---

## Current Limitations & Known Issues

### **1. Testing Values**

⚠️ **Currently set for testing:**
- Enrollment threshold: **10 minutes** (should be 1 hour in prod)
- First message: **Immediately** (should be 6 hours in prod)
- Next messages: **24 hours** (correct for prod)
- Delay between messages: **2 minutes** (good for testing, maybe increase to 5 min in prod)

**To change for production:**
1. `relance-enrollment.job.ts` line 39: Change `10 * 60 * 1000` to `60 * 60 * 1000`
2. `relance-enrollment.job.ts` lines 64, 215: Change `new Date(now)` to `new Date(now.getTime() + 6 * 60 * 60 * 1000)`
3. `relance-sender.job.ts` line 246: Optionally increase delay from 2 to 5 minutes

### **2. Missing Opt-In/Opt-Out**

⚠️ **HIGH PRIORITY:**
- No WhatsApp consent checkbox during registration
- No "STOP" reply listener
- Violates WhatsApp TOS (see earlier research)

### **3. Using Baileys (Unofficial Client)**

⚠️ **CRITICAL RISK:**
- Violates WhatsApp Terms of Service
- High ban risk
- Should migrate to official WhatsApp Business API for production

### **4. No Subscription Expiry Validation**

Currently doesn't prevent scheduling campaigns beyond subscription end date. Need to:
1. Get subscription end date from user service
2. Compare with estimated campaign end date
3. Reject if campaign would run past subscription

### **5. No User Interface**

All campaign management must be done via code/database. Need admin UI for:
- Creating campaigns
- Monitoring progress
- Pausing/resuming/cancelling

---

## Database Schema Summary

### **Collections**

1. **campaigns**
   - Stores all filtered and default campaigns
   - Links to users via `userId`
   - Tracks filters, scheduling, progress

2. **relancetargets**
   - Individual referrals in the loop
   - Links to campaigns via `campaignId` (null for default)
   - Tracks message delivery history

3. **relanceconfigs**
   - Per-user WhatsApp connection and settings
   - Controls default campaign pause state
   - Sets daily message limits

4. **relancemessages**
   - Default message templates (days 1-7)
   - Fallback when campaign has no custom messages

---

## Performance Considerations

### **Current Load**

For 1 user with 500 targets:
- Enrollment: ~500 DB inserts (once)
- Sending: ~500 messages over 7 days = ~71 messages/day
- At 2 min/message = ~2.5 hours to send 71 messages
- Well within limits

### **Scaling Concerns**

For 100 users with 500 targets each:
- 50,000 total targets
- ~7,143 messages/day across all users
- At 2 min/message = ~10 days to send all (not feasible)

**Solutions:**
1. Reduce delay to 30 seconds (risky for spam)
2. Run sender job more frequently (every hour instead of 6 hours)
3. Parallel processing (multiple WhatsApp clients per user)
4. Migrate to official API (no delays needed)

---

## Summary

✅ **Completed:**
- Full campaign infrastructure (models, service, jobs)
- Default + filtered campaign support
- Comprehensive filtering system
- Auto-start, auto-complete, auto-resume logic
- Progress tracking and stats
- Rate limiting and safety delays

⚠️ **Pending:**
- API endpoints (Phase 4)
- Frontend UI (Phase 5)
- Safety features: opt-in/opt-out, monitoring (Phase 6)

🚨 **Critical Before Production:**
- Add WhatsApp consent checkbox
- Implement STOP reply listener
- Add ban risk warnings
- Change testing values to production values
- Consider migrating to official WhatsApp Business API

**The core system is now fully functional and ready for API/UI development!**
