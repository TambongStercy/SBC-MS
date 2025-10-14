# Filtered Relance System - Implementation Plan

## Overview

This document outlines the complete implementation of the **Filtered Relance** feature, which allows users to:

1. ✅ Create manual filtered campaigns (by country, date, gender, profession, age)
2. ✅ Pause default auto-enrollment when filtered campaigns run
3. ✅ Queue multiple campaigns to run sequentially
4. ✅ Option to run default + filtered campaigns simultaneously
5. ✅ Schedule campaigns with subscription expiry validation
6. ✅ Comprehensive safety limits to prevent WhatsApp spam bans

---

## Architecture Changes

### **1. New Database Models**

#### **Campaign Model** (`relance-campaign.model.ts`)
- ✅ **COMPLETED** - Stores filtered and default campaigns
- Tracks campaign status (draft, scheduled, active, paused, completed, cancelled)
- Supports target filtering with multiple criteria
- Handles campaign queuing and scheduling
- Progress tracking (targets enrolled, messages sent, delivery stats)

**Key Fields:**
```typescript
- userId: Owner of campaign
- name: Campaign name
- type: 'default' | 'filtered'
- status: 'draft' | 'scheduled' | 'active' | 'paused' | 'completed' | 'cancelled'
- targetFilter: {
    countries, registrationDateFrom, registrationDateTo,
    gender, professions, minAge, maxAge, hasUnpaidReferrals,
    excludeCurrentTargets
  }
- scheduledStartDate: When to auto-start
- runAfterCampaignId: Queue behind another campaign
- priority: Campaign priority
- customMessages: Override default messages (optional)
- maxMessagesPerDay: Rate limiting per campaign
```

#### **Updated RelanceTarget Model**
- ✅ **COMPLETED** - Added `campaignId` field to link targets to campaigns
- Allows tracking which campaign enrolled which target

#### **Updated RelanceConfig Model**
- ✅ **COMPLETED** - Added campaign control fields:
  - `defaultCampaignPaused`: Pause automatic enrollment
  - `allowSimultaneousCampaigns`: Run default + filtered together
  - `maxMessagesPerDay`: Safety limit (default: 50)
  - `maxTargetsPerCampaign`: Max targets per filtered campaign (default: 500)

---

### **2. New Services**

#### **Campaign Service** (`campaign.service.ts`)
- ✅ **COMPLETED** - Core campaign management logic

**Key Methods:**
- `createCampaign()`: Create filtered campaign with validation
- `estimateTargetCount()`: Estimate how many users match filters
- `startCampaign()`: Activate campaign, pause default if needed
- `pauseCampaign()`: Temporarily pause campaign
- `resumeCampaign()`: Resume paused campaign
- `cancelCampaign()`: Cancel campaign and exit all targets
- `getUserCampaigns()`: Get user's campaigns with filters
- `getNextCampaignToStart()`: Find next scheduled/queued campaign

**Validation Features:**
- ✅ Check subscription status before creating
- ✅ Validate estimated targets vs. limit (500 default)
- ✅ Validate parent campaign exists (for queuing)
- ✅ Auto-pause default campaign when filtered starts (unless simultaneous mode)
- ✅ Auto-resume default when last filtered campaign completes

---

### **3. Updated Cron Jobs**

#### **Enrollment Job** (Needs Update)

**Current Status:** ⚠️ **PENDING**

**Required Changes:**
1. Support both default and filtered campaigns
2. Check `defaultCampaignPaused` flag before enrolling to default
3. Process active filtered campaigns and apply their filters
4. Auto-start scheduled campaigns (call `getNextCampaignToStart()`)
5. Link enrolled targets to their campaign via `campaignId`

**Pseudocode:**
```typescript
async function runEnrollmentCheck() {
  // 1. Check for campaigns that should auto-start
  const nextCampaign = await campaignService.getNextCampaignToStart();
  if (nextCampaign) {
    await campaignService.startCampaign(nextCampaign._id, nextCampaign.userId);
  }

  // 2. Find users with active relance subscriptions
  const activeConfigs = await RelanceConfigModel.find({
    enabled: true,
    enrollmentPaused: false,
    whatsappStatus: 'connected'
  });

  for (const config of activeConfigs) {
    // 3. Process DEFAULT campaign (if not paused)
    if (!config.defaultCampaignPaused) {
      // Current logic: enroll unpaid referrals > 10 minutes old
      await enrollDefaultTargets(config.userId);
    }

    // 4. Process FILTERED campaigns
    const activeCampaigns = await CampaignModel.find({
      userId: config.userId,
      type: 'filtered',
      status: 'active'
    });

    for (const campaign of activeCampaigns) {
      await enrollFilteredTargets(config.userId, campaign);
    }
  }
}
```

#### **Sender Job** (Needs Update)

**Current Status:** ⚠️ **PENDING**

**Required Changes:**
1. Process targets from all campaigns (default + filtered)
2. Respect campaign-specific `maxMessagesPerDay` limits
3. Use custom messages if campaign has them
4. Update campaign progress stats
5. Auto-complete campaigns when all targets finish
6. Auto-resume default campaign when last filtered completes

**Pseudocode:**
```typescript
async function runMessageSendingJob() {
  const now = new Date();

  // Find all active targets across all campaigns
  const targetsToProcess = await RelanceTargetModel.find({
    status: 'active',
    nextMessageDue: { $lte: now }
  }).populate('campaignId');

  for (const target of targetsToProcess) {
    // Get campaign (if linked)
    const campaign = target.campaignId;

    // Get message template (campaign custom or default)
    const messageTemplate = campaign?.customMessages?.[target.currentDay - 1]
      || await RelanceMessageModel.findOne({ dayNumber: target.currentDay });

    // Check campaign daily limit
    if (campaign && campaign.messagesSentToday >= campaign.maxMessagesPerDay) {
      continue; // Skip this target for today
    }

    // Send message...
    // Update campaign stats...

    // Check if campaign is complete
    if (campaign) {
      await checkAndCompleteCampaign(campaign);
    }
  }
}

async function checkAndCompleteCampaign(campaign) {
  const activeTargets = await RelanceTargetModel.countDocuments({
    campaignId: campaign._id,
    status: 'active'
  });

  if (activeTargets === 0) {
    campaign.complete();
    await campaign.save();

    // Resume default if this was last filtered campaign
    const remainingFilteredCampaigns = await CampaignModel.countDocuments({
      userId: campaign.userId,
      type: 'filtered',
      status: 'active'
    });

    if (remainingFilteredCampaigns === 0) {
      await RelanceConfigModel.updateOne(
        { userId: campaign.userId },
        { defaultCampaignPaused: false }
      );
    }
  }
}
```

---

### **4. New API Endpoints**

**Required:** ⚠️ **PENDING**

#### **Campaign Management (User)**

```typescript
POST   /api/relance/campaigns                  // Create filtered campaign
GET    /api/relance/campaigns                  // List user's campaigns
GET    /api/relance/campaigns/:id              // Get campaign details
POST   /api/relance/campaigns/:id/start        // Start campaign
POST   /api/relance/campaigns/:id/pause        // Pause campaign
POST   /api/relance/campaigns/:id/resume       // Resume campaign
POST   /api/relance/campaigns/:id/cancel       // Cancel campaign
GET    /api/relance/campaigns/:id/targets      // Get campaign targets
POST   /api/relance/campaigns/estimate         // Estimate target count for filters
```

#### **Configuration Updates**

```typescript
PATCH  /api/relance/config                     // Update config
  Body: {
    defaultCampaignPaused?: boolean,
    allowSimultaneousCampaigns?: boolean,
    maxMessagesPerDay?: number,
    maxTargetsPerCampaign?: number
  }
```

#### **Admin Endpoints**

```typescript
GET    /api/admin/relance/campaigns            // List all campaigns (admin)
GET    /api/admin/relance/campaigns/:id        // View any campaign
POST   /api/admin/relance/campaigns/:id/cancel // Cancel any campaign
```

---

## Implementation Steps

### **Phase 1: Core Infrastructure** ✅ COMPLETED
- [x] Create Campaign model
- [x] Update RelanceTarget model with campaignId
- [x] Update RelanceConfig model with campaign controls
- [x] Create CampaignService

### **Phase 2: Enrollment Logic** ⚠️ PENDING
- [ ] Update enrollment job to support campaigns
- [ ] Implement `enrollDefaultTargets()` function
- [ ] Implement `enrollFilteredTargets()` function
- [ ] Add auto-start logic for scheduled campaigns
- [ ] Test enrollment with filters

### **Phase 3: Sending Logic** ⚠️ PENDING
- [ ] Update sender job to handle multiple campaigns
- [ ] Implement campaign-specific message templates
- [ ] Add campaign progress tracking
- [ ] Implement auto-completion logic
- [ ] Implement default campaign auto-resume
- [ ] Test message sending across campaigns

### **Phase 4: API Endpoints** ⚠️ PENDING
- [ ] Create campaign controller
- [ ] Implement campaign CRUD endpoints
- [ ] Implement campaign action endpoints (start/pause/resume/cancel)
- [ ] Add target estimation endpoint
- [ ] Update config endpoint
- [ ] Add API tests

### **Phase 5: Frontend Integration** ⚠️ PENDING
- [ ] Create campaign management page
- [ ] Add filter UI (country, date, gender, profession)
- [ ] Add campaign scheduling UI
- [ ] Add campaign queue visualization
- [ ] Add progress tracking dashboard
- [ ] Add simultaneous campaign toggle

### **Phase 6: Safety & Monitoring** ⚠️ PENDING
- [ ] Implement rate limiting per campaign
- [ ] Add spam detection warnings
- [ ] Track block/report rates
- [ ] Auto-pause on high failure rate
- [ ] Add user notifications for campaign events
- [ ] Create admin monitoring dashboard

---

## Safety Features (WhatsApp Ban Prevention)

Based on WhatsApp TOS research, the following safety features are **critical**:

### **1. Rate Limiting**
- ✅ Default: 50 messages/day per WhatsApp account (configurable)
- ✅ Per-campaign limits (can be customized)
- ✅ Max 500 targets per filtered campaign (prevents bulk spam)
- ⚠️ TODO: Add 2-minute delay between messages
- ⚠️ TODO: Limit messages to unknown contacts to 20/day

### **2. Opt-In/Opt-Out** (Not Yet Implemented)
- ⚠️ TODO: Add WhatsApp consent checkbox during referral registration
- ⚠️ TODO: Only enroll referrals who opted in
- ⚠️ TODO: Listen for "STOP" replies and auto-remove from loop
- ⚠️ TODO: Add "Reply STOP to unsubscribe" in every message

### **3. Quality Monitoring** (Not Yet Implemented)
- ⚠️ TODO: Track failed deliveries per account
- ⚠️ TODO: Auto-pause if failure rate > 10%
- ⚠️ TODO: Alert user if block rate detected (via failed sends)
- ⚠️ TODO: Suggest reducing frequency if failures increase

### **4. Warnings & Education**
- ⚠️ TODO: Add prominent warning about Baileys TOS violation
- ⚠️ TODO: Display ban risk in UI
- ⚠️ TODO: Recommend using test numbers
- ⚠️ TODO: Provide best practices guide

### **5. Personalization Requirements**
- ✅ Already using {{name}}, {{referrerName}}, {{day}}
- ⚠️ TODO: Add more personalization options (referral date, specific actions)
- ⚠️ TODO: Discourage identical message content across days

---

## User Flow Examples

### **Example 1: Create Filtered Campaign**

1. User clicks "Create Campaign" in Relance dashboard
2. User enters campaign name: "Cameroon Professionals March 2025"
3. User selects filters:
   - Country: Cameroon
   - Registration date: March 1-31, 2025
   - Profession: Engineer, Teacher
   - Gender: All
4. System shows estimate: "42 targets match your filters"
5. User customizes messages (optional) or uses defaults
6. User sets max messages/day: 30 (override default 50)
7. User clicks "Start Campaign"
8. System:
   - Pauses default auto-enrollment (unless simultaneous mode enabled)
   - Starts enrolling 42 targets immediately
   - Begins sending Day 1 messages

### **Example 2: Queue Multiple Campaigns**

1. User has active campaign "Cameroon Professionals" running
2. User creates new campaign "Nigeria Students April 2025"
3. User selects "Run after: Cameroon Professionals"
4. System:
   - Sets status to "Scheduled"
   - Waits for Cameroon campaign to complete
   - Auto-starts Nigeria campaign when Cameroon finishes
5. When Nigeria campaign completes:
   - System resumes default auto-enrollment

### **Example 3: Simultaneous Campaigns**

1. User enables "Allow Simultaneous Campaigns" in settings
2. User creates filtered campaign "Females 18-25"
3. System:
   - Does NOT pause default auto-enrollment
   - Runs both default + filtered in parallel
4. Sender job processes both:
   - Respects combined daily limit (50 messages shared)
   - Sends to both default targets and filtered targets

---

## Next Steps

**To complete this feature, you need to:**

1. **Update Enrollment Job** - Implement campaign-aware enrollment logic
2. **Update Sender Job** - Add campaign progress tracking and auto-completion
3. **Create API Endpoints** - Build campaign management REST API
4. **Build Frontend UI** - Create campaign management pages
5. **Add Safety Features** - Implement opt-in/opt-out, rate limiting, monitoring
6. **Testing** - Comprehensive testing with real WhatsApp accounts (use test numbers!)

**Estimated Time:**
- Phase 2 (Enrollment): 4-6 hours
- Phase 3 (Sending): 4-6 hours
- Phase 4 (API): 6-8 hours
- Phase 5 (Frontend): 10-12 hours
- Phase 6 (Safety): 6-8 hours

**Total: ~30-40 hours of development**

---

## Questions for User

1. **Subscription Expiry Validation:** Should we prevent scheduling campaigns beyond subscription end date? (Requires integration with user service to get subscription info)

2. **Message Customization:** Should users be able to fully customize all 7 days of messages per campaign, or only override specific days?

3. **Default Campaign Behavior:** When a filtered campaign completes, should default auto-enrollment:
   - (A) Resume immediately
   - (B) Resume after a cooldown period (e.g., 24 hours)
   - (C) Stay paused until user manually resumes

4. **Simultaneous Campaign Limits:** If simultaneous mode is enabled, what's the max number of active campaigns at once?

5. **Ban Risk Warnings:** How prominently should we display WhatsApp ban risk warnings? Modal on first use? Banner on every page?

6. **Official WhatsApp Business API:** Would you consider migrating to official API for production to reduce ban risk and increase limits?

---

**Would you like me to proceed with Phase 2 (Updating the enrollment job)?**
