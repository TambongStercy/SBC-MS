# Relance Campaign API - User Frontend Integration Guide

## Overview

This guide is for **frontend developers** building the user-facing relance campaign interface. It covers all API endpoints, request/response formats, and integration patterns for the normal user frontend (not admin).

**Base URL:** `http://localhost:3002/api/relance` (Development)

**Authentication:** All endpoints require JWT token in header:
```
Authorization: Bearer <user-jwt-token>
```

---

## User Flow Overview

```
1. User connects WhatsApp (scan QR code) 
   ↓
2. User creates filtered campaign (select filters, preview results)
   ↓
3. User starts campaign
   ↓
4. System sends messages automatically
   ↓
5. User monitors progress
   ↓
6. User can pause/resume/cancel campaigns
```

---

## API Endpoints for User Frontend

### 1. **WhatsApp Connection**

#### 1.1. Connect WhatsApp (Generate QR Code)

**Endpoint:** `POST /api/relance/connect`

**Headers:**
```
Authorization: Bearer <user-jwt-token>
Content-Type: application/json
```

**Request Body:** None required (userId extracted from JWT token)

**Response (New Connection - QR Generated):**
```json
{
  "success": true,
  "data": {
    "qr": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
  }
}
```

**Response (Already Connected):**
```json
{
  "success": true,
  "message": "WhatsApp already connected",
  "data": {
    "alreadyConnected": true,
    "whatsappStatus": "connected"
  }
}
```

**Frontend Implementation:**
```javascript
async function connectWhatsApp() {
  const response = await fetch('http://localhost:3002/api/relance/connect', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${userToken}`,
      'Content-Type': 'application/json'
    }
  });

  const data = await response.json();

  if (data.success) {
    // Check if already connected
    if (data.data.alreadyConnected) {
      alert('WhatsApp is already connected!');
      // Redirect to campaigns page or show connected UI
      showConnectedUI();
      return;
    }

    // Display QR code image for new connection
    document.getElementById('qr-code').src = data.data.qr;
    // Show message: "Scan this QR code with WhatsApp"
    showQRCodeModal();
  }
}
```

**UI Notes:**
- Display QR code in a modal/dialog
- Show instructions: "Open WhatsApp → Linked Devices → Link a Device"
- Add loading state while QR is generating
- QR code expires after ~60 seconds (user can request new one)

---

#### 1.2. Check WhatsApp Connection Status

**Endpoint:** `GET /api/relance/status`

**Headers:**
```
Authorization: Bearer <user-jwt-token>
```

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
    "messagesSentToday": 12,
    "maxMessagesPerDay": 50,
    "maxTargetsPerCampaign": 500,
    "lastQrScanDate": "2025-01-04T10:30:00Z",
    "connectionFailureCount": 0,
    "lastConnectionFailure": null
  }
}
```

**New Fields (Session Retry):**
- `connectionFailureCount`: Number of consecutive connection failures (0-3)
- `lastConnectionFailure`: Timestamp of last failure (null if no recent failures)

**Frontend Implementation:**
```javascript
async function checkWhatsAppStatus() {
  const response = await fetch('http://localhost:3002/api/relance/status', {
    headers: {
      'Authorization': `Bearer ${userToken}`
    }
  });

  const data = await response.json();

  if (data.success) {
    const status = data.data.whatsappStatus;
    const failureCount = data.data.connectionFailureCount;

    // Update UI based on status
    if (status === 'connected') {
      // Show green checkmark, enable campaign creation
      showConnectedUI();
    } else if (status === 'disconnected') {
      // Show "Connect WhatsApp" button
      showDisconnectedUI(failureCount);
    }
  }
}

function showDisconnectedUI(failureCount = 0) {
  // Show retry info if there were previous failures
  if (failureCount > 0 && failureCount < 3) {
    // Session preserved, can reconnect without QR
    showReconnectMessage(failureCount);
  } else if (failureCount >= 3) {
    // Session deleted after 3 failures, need new QR
    showNewQRRequired();
  } else {
    // Normal disconnected state
    showNormalDisconnect();
  }
}

function showReconnectMessage(failureCount) {
  const message = `
    ⚠️ Connection lost (${failureCount}/3 attempts)
    Your session is preserved. Click Connect to try again.
    No QR code scan needed!
  `;
  displayMessage(message, 'warning');
}
```

**Status Values:**
- `"connected"` - WhatsApp is connected and ready
- `"disconnected"` - Not connected, need to scan QR
- `"expired"` - Connection expired, need to reconnect

**UI States:**
```
Connected (failureCount = 0):
  ✅ WhatsApp Connected
  [Disconnect] button
  Enable campaign features

Disconnected - No Previous Failures (failureCount = 0):
  ⚠️ WhatsApp Not Connected
  [Connect WhatsApp] button
  Disable campaign features

Disconnected - Retry Available (failureCount = 1-2):
  ⚠️ Connection Lost (X/3 attempts)
  💡 Your session is preserved!
  [Reconnect (No QR needed)] button
  [Reset Session] button (optional)
  Disable campaign features

Disconnected - Session Expired (failureCount >= 3):
  ❌ Session Expired (3 failed attempts)
  New QR code scan required
  [Connect WhatsApp] button
  Disable campaign features
```

---

#### 1.3. Disconnect WhatsApp

**Endpoint:** `DELETE /api/relance/disconnect`

**Headers:**
```
Authorization: Bearer <user-jwt-token>
Content-Type: application/json
```

**Request Body (Optional):**
```json
{
  "force": true  // Optional: set to true to completely reset session
}
```

**Response:**
```json
{
  "success": true,
  "message": "WhatsApp disconnected successfully"
  // OR if force=true:
  // "message": "WhatsApp session completely reset"
}
```

**🔄 Session Retry Mechanism:**

The system uses a **3-retry mechanism** to preserve your WhatsApp session:

- **Normal Disconnect** (default): Keeps session files for automatic reconnection
  - Your session is preserved for up to 3 consecutive connection failures
  - You can reconnect automatically without scanning QR code again
  - Recommended for temporary disconnections

- **Force Disconnect** (`force: true`): Completely deletes session files
  - Removes all saved session data immediately
  - You must scan a new QR code to reconnect
  - Use when switching phones or persistent connection issues

**When to use Force Disconnect:**
- ✅ Switching to a different WhatsApp account
- ✅ Switching to a different phone
- ✅ Connection fails 3 times and you want to start fresh
- ✅ You want a completely fresh start

**Frontend Implementation:**

**Normal Disconnect (recommended):**
```javascript
async function disconnectWhatsApp() {
  if (!confirm('Disconnect WhatsApp? You can reconnect automatically later.')) {
    return;
  }

  const response = await fetch('http://localhost:3002/api/relance/disconnect', {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${userToken}`,
      'Content-Type': 'application/json'
    }
    // No body = normal disconnect, session preserved
  });

  const data = await response.json();

  if (data.success) {
    // Update UI to show disconnected state
    showDisconnectedUI();
    // Show info: "You can reconnect without scanning QR again"
  }
}
```

**Force Disconnect (complete reset):**
```javascript
async function resetWhatsAppSession() {
  if (!confirm('Completely reset WhatsApp session? You will need to scan a new QR code.')) {
    return;
  }

  const response = await fetch('http://localhost:3002/api/relance/disconnect', {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${userToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ force: true })  // Force complete reset
  });

  const data = await response.json();

  if (data.success) {
    alert('Session reset. Please connect again with a new QR code.');
    showDisconnectedUI();
  }
}
```

**UI Recommendations:**

Show two separate buttons for clarity:

```html
<!-- Normal disconnect -->
<button onclick="disconnectWhatsApp()" class="btn-secondary">
  Disconnect (Temporary)
</button>

<!-- Force reset -->
<button onclick="resetWhatsAppSession()" class="btn-danger">
  Reset Session (Complete)
</button>
```

**Help Text:**
```
💡 Normal Disconnect: Temporarily disconnect. You can reconnect
   automatically without scanning QR code again (session preserved
   for up to 3 connection failures).

⚠️  Reset Session: Completely delete saved session. You will need
   to scan a new QR code to reconnect. Use this if you're switching
   phones or having persistent connection issues.
```

**Connection Failure Handling:**

The system automatically tracks connection failures:
- 1st failure → Session preserved, can reconnect
- 2nd failure → Session preserved, can reconnect
- 3rd failure → Session automatically deleted, must rescan QR

This prevents you from having to rescan QR for temporary network issues!

---

### 2. **Campaign Management**

#### 2.1. Preview Filter Results (with Sample Users)

**Endpoint:** `POST /api/relance/campaigns/preview`

**Headers:**
```
Authorization: Bearer <user-jwt-token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "targetFilter": {
    "countries": ["CM", "NG"],
    "gender": "all",
    "professions": ["Engineer", "Teacher"],
    "minAge": 18,
    "maxAge": 45,
    "registrationDateFrom": "2024-01-01",
    "registrationDateTo": "2025-12-31",
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
      // ... 3 more users (5 total)
    ],
    "message": "42 users match the selected filters"
  }
}
```

**Frontend Implementation:**
```javascript
async function previewFilters(filters) {
  const response = await fetch('http://localhost:3002/api/relance/campaigns/preview', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${userToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ targetFilter: filters })
  });

  const data = await response.json();

  if (data.success) {
    const { totalCount, sampleUsers, message } = data.data;

    // Update UI
    document.getElementById('total-count').textContent = totalCount;
    document.getElementById('preview-message').textContent = message;

    // Display sample users
    displaySampleUsers(sampleUsers);
  }
}

function displaySampleUsers(users) {
  const container = document.getElementById('sample-users-list');
  container.innerHTML = '';

  users.forEach(user => {
    const userCard = `
      <div class="user-card">
        <h4>${user.name}</h4>
        <p>Email: ${user.email}</p>
        <p>Phone: ${user.phoneNumber}</p>
        <p>Country: ${user.country}, Age: ${user.age}</p>
        <p>Profession: ${user.profession}</p>
      </div>
    `;
    container.innerHTML += userCard;
  });
}
```

**UI Design:**
```
┌─────────────────────────────────────┐
│ Filter Preview                      │
├─────────────────────────────────────┤
│ ✓ 42 users match the selected      │
│   filters                           │
│                                     │
│ Sample Users (5 shown):             │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ 👤 John Doe                     │ │
│ │ 📧 john@example.com             │ │
│ │ 📱 +237612345678                │ │
│ │ 🌍 Cameroon, 28 years old       │ │
│ │ 💼 Engineer                     │ │
│ └─────────────────────────────────┘ │
│                                     │
│ [Create Campaign]                   │
└─────────────────────────────────────┘
```

---

#### 2.2. Create Campaign

**Endpoint:** `POST /api/relance/campaigns`

**Headers:**
```
Authorization: Bearer <user-jwt-token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "name": "Cameroon Professionals Campaign",
  "targetFilter": {
    "countries": ["CM"],
    "gender": "all",
    "professions": ["Engineer", "Teacher"],
    "minAge": 20,
    "maxAge": 50,
    "excludeCurrentTargets": true
  },
  "maxMessagesPerDay": 30,
  "scheduledStartDate": null
}
```

**Optional Fields:**
- `scheduledStartDate`: ISO date string to auto-start later (e.g., `"2025-01-10T10:00:00Z"`)
- `runAfterCampaignId`: Campaign ID to run after (queuing)
- `customMessages`: Custom message templates (advanced feature)

**Response:**
```json
{
  "success": true,
  "message": "Campaign created successfully",
  "data": {
    "_id": "68e12345abcd1234ef567890",
    "name": "Cameroon Professionals Campaign",
    "type": "filtered",
    "status": "draft",
    "targetFilter": { ... },
    "estimatedTargetCount": 42,
    "estimatedEndDate": "2025-01-15T00:00:00Z",
    "maxMessagesPerDay": 30,
    "createdAt": "2025-01-04T12:00:00Z"
  }
}
```

**Frontend Implementation:**
```javascript
async function createCampaign(campaignData) {
  const response = await fetch('http://localhost:3002/api/relance/campaigns', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${userToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(campaignData)
  });

  const data = await response.json();

  if (data.success) {
    const campaign = data.data;

    // Show success message
    alert(`Campaign "${campaign.name}" created successfully!`);

    // Ask if user wants to start immediately
    if (confirm('Start campaign now?')) {
      await startCampaign(campaign._id);
    } else {
      // Navigate to campaigns list
      window.location.href = '/campaigns';
    }
  } else {
    // Show error
    alert('Error: ' + data.message);
  }
}
```

---

#### 2.3. List User's Campaigns

**Endpoint:** `GET /api/relance/campaigns?status=active&type=filtered`

**Headers:**
```
Authorization: Bearer <user-jwt-token>
```

**Query Parameters (Optional):**
- `status`: Filter by status (`draft`, `scheduled`, `active`, `paused`, `completed`, `cancelled`)
- `type`: Filter by type (`filtered` - don't show default campaign)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "68e12345abcd1234ef567890",
      "name": "Cameroon Professionals Campaign",
      "type": "filtered",
      "status": "active",
      "targetFilter": {
        "countries": ["CM"],
        "gender": "all"
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
    }
  ]
}
```

**Frontend Implementation:**
```javascript
async function getCampaigns(filters = {}) {
  const queryParams = new URLSearchParams(filters).toString();
  const url = `http://localhost:3002/api/relance/campaigns?${queryParams}`;

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${userToken}`
    }
  });

  const data = await response.json();

  if (data.success) {
    displayCampaigns(data.data);
  }
}

function displayCampaigns(campaigns) {
  const container = document.getElementById('campaigns-list');
  container.innerHTML = '';

  campaigns.forEach(campaign => {
    const deliveryRate = campaign.messagesSent > 0
      ? ((campaign.messagesDelivered / campaign.messagesSent) * 100).toFixed(1)
      : 0;

    const campaignCard = `
      <div class="campaign-card">
        <div class="campaign-header">
          <h3>${campaign.name}</h3>
          <span class="status-badge ${campaign.status}">${campaign.status}</span>
        </div>
        <div class="campaign-stats">
          <div class="stat">
            <span class="label">Targets Enrolled</span>
            <span class="value">${campaign.targetsEnrolled}</span>
          </div>
          <div class="stat">
            <span class="label">Messages Sent</span>
            <span class="value">${campaign.messagesSent}</span>
          </div>
          <div class="stat">
            <span class="label">Delivery Rate</span>
            <span class="value">${deliveryRate}%</span>
          </div>
          <div class="stat">
            <span class="label">Completed</span>
            <span class="value">${campaign.targetsCompleted}</span>
          </div>
        </div>
        <div class="campaign-actions">
          ${getCampaignActions(campaign)}
        </div>
      </div>
    `;
    container.innerHTML += campaignCard;
  });
}

function getCampaignActions(campaign) {
  if (campaign.status === 'draft') {
    return `<button onclick="startCampaign('${campaign._id}')">Start Campaign</button>`;
  } else if (campaign.status === 'active') {
    return `
      <button onclick="pauseCampaign('${campaign._id}')">Pause</button>
      <button onclick="cancelCampaign('${campaign._id}')">Cancel</button>
    `;
  } else if (campaign.status === 'paused') {
    return `
      <button onclick="resumeCampaign('${campaign._id}')">Resume</button>
      <button onclick="cancelCampaign('${campaign._id}')">Cancel</button>
    `;
  }
  return '';
}
```

**UI Design:**
```
┌─────────────────────────────────────────────┐
│ My Campaigns                                │
├─────────────────────────────────────────────┤
│                                             │
│ ┌─────────────────────────────────────────┐ │
│ │ Cameroon Professionals  [🟢 Active]     │ │
│ │                                         │ │
│ │ Targets: 15    Messages: 45            │ │
│ │ Delivery: 93.3%   Completed: 2         │ │
│ │                                         │ │
│ │ [Pause] [Cancel] [View Details]        │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ [+ Create New Campaign]                     │
└─────────────────────────────────────────────┘
```

---

#### 2.4. Get Campaign Details

**Endpoint:** `GET /api/relance/campaigns/:campaignId`

**Headers:**
```
Authorization: Bearer <user-jwt-token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "campaign": {
      "_id": "68e12345abcd1234ef567890",
      "name": "Cameroon Professionals Campaign",
      "status": "active",
      "targetsEnrolled": 15,
      "messagesSent": 45,
      "messagesDelivered": 42,
      "messagesFailed": 3,
      "targetsCompleted": 2
    },
    "targets": [
      {
        "_id": "68e12346xyz987",
        "referralUserId": "675e56b891e9691b6fe52ad9",
        "currentDay": 3,
        "status": "active",
        "messagesDelivered": [
          { "day": 1, "sentAt": "2025-01-04T18:00:00Z", "status": "delivered" },
          { "day": 2, "sentAt": "2025-01-05T18:00:00Z", "status": "delivered" },
          { "day": 3, "sentAt": "2025-01-06T18:00:00Z", "status": "delivered" }
        ]
      }
    ]
  }
}
```

**Frontend Implementation:**
```javascript
async function getCampaignDetails(campaignId) {
  const response = await fetch(`http://localhost:3002/api/relance/campaigns/${campaignId}`, {
    headers: {
      'Authorization': `Bearer ${userToken}`
    }
  });

  const data = await response.json();

  if (data.success) {
    displayCampaignDetails(data.data);
  }
}
```

---

#### 2.5. Start Campaign

**Endpoint:** `POST /api/relance/campaigns/:campaignId/start`

**Headers:**
```
Authorization: Bearer <user-jwt-token>
Content-Type: application/json
```

**Request Body:** Empty `{}`

**Response:**
```json
{
  "success": true,
  "message": "Campaign started successfully"
}
```

**Frontend Implementation:**
```javascript
async function startCampaign(campaignId) {
  const response = await fetch(`http://localhost:3002/api/relance/campaigns/${campaignId}/start`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${userToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({})
  });

  const data = await response.json();

  if (data.success) {
    alert('Campaign started! Messages will be sent automatically.');
    // Refresh campaigns list
    getCampaigns();
  } else {
    alert('Error: ' + data.message);
  }
}
```

**Important Notes:**
- Starting a filtered campaign will **automatically pause** the default auto-enrollment campaign
- Unless user has enabled "Allow Simultaneous Campaigns" in settings

---

#### 2.6. Pause Campaign

**Endpoint:** `POST /api/relance/campaigns/:campaignId/pause`

**Headers:**
```
Authorization: Bearer <user-jwt-token>
Content-Type: application/json
```

**Request Body:** Empty `{}`

**Response:**
```json
{
  "success": true,
  "message": "Campaign paused successfully"
}
```

**Frontend Implementation:**
```javascript
async function pauseCampaign(campaignId) {
  if (!confirm('Pause this campaign? No messages will be sent while paused.')) {
    return;
  }

  const response = await fetch(`http://localhost:3002/api/relance/campaigns/${campaignId}/pause`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${userToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({})
  });

  const data = await response.json();

  if (data.success) {
    alert('Campaign paused');
    getCampaigns();
  }
}
```

---

#### 2.7. Resume Campaign

**Endpoint:** `POST /api/relance/campaigns/:campaignId/resume`

**Headers:**
```
Authorization: Bearer <user-jwt-token>
Content-Type: application/json
```

**Request Body:** Empty `{}`

**Response:**
```json
{
  "success": true,
  "message": "Campaign resumed successfully"
}
```

**Frontend Implementation:**
```javascript
async function resumeCampaign(campaignId) {
  const response = await fetch(`http://localhost:3002/api/relance/campaigns/${campaignId}/resume`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${userToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({})
  });

  const data = await response.json();

  if (data.success) {
    alert('Campaign resumed');
    getCampaigns();
  }
}
```

---

#### 2.8. Cancel Campaign

**Endpoint:** `POST /api/relance/campaigns/:campaignId/cancel`

**Headers:**
```
Authorization: Bearer <user-jwt-token>
Content-Type: application/json
```

**Request Body:**
```json
{
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

**Frontend Implementation:**
```javascript
async function cancelCampaign(campaignId) {
  const reason = prompt('Why are you cancelling this campaign?');

  if (!reason) {
    return; // User cancelled
  }

  if (!confirm('Cancel this campaign? All active targets will be removed from the loop.')) {
    return;
  }

  const response = await fetch(`http://localhost:3002/api/relance/campaigns/${campaignId}/cancel`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${userToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ reason })
  });

  const data = await response.json();

  if (data.success) {
    alert('Campaign cancelled');
    getCampaigns();
  }
}
```

**Important Notes:**
- Cancelling removes all targets from the campaign
- If this was the last active filtered campaign, default auto-enrollment will **resume automatically**

---

### 3. **Configuration**

#### 3.1. Update Campaign Settings

**Endpoint:** `PATCH /api/relance/config`

**Headers:**
```
Authorization: Bearer <user-jwt-token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "allowSimultaneousCampaigns": true,
  "maxMessagesPerDay": 75,
  "maxTargetsPerCampaign": 300
}
```

**Available Fields:**
- `allowSimultaneousCampaigns` (boolean): Allow default + filtered campaigns to run together
- `maxMessagesPerDay` (number): 1-100
- `maxTargetsPerCampaign` (number): 10-1000
- `defaultCampaignPaused` (boolean): Manually pause default campaign

**Response:**
```json
{
  "success": true,
  "message": "Configuration updated successfully",
  "data": {
    "allowSimultaneousCampaigns": true,
    "maxMessagesPerDay": 75,
    "maxTargetsPerCampaign": 300
  }
}
```

**Frontend Implementation:**
```javascript
async function updateSettings(settings) {
  const response = await fetch('http://localhost:3002/api/relance/config', {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${userToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(settings)
  });

  const data = await response.json();

  if (data.success) {
    alert('Settings updated successfully');
  }
}
```

**UI Design (Settings Page):**
```
┌─────────────────────────────────────┐
│ Campaign Settings                   │
├─────────────────────────────────────┤
│                                     │
│ [x] Allow simultaneous campaigns    │
│     Run default + filtered together │
│                                     │
│ Max Messages Per Day: [75]          │
│ (Recommended: 50)                   │
│                                     │
│ Max Targets Per Campaign: [300]     │
│ (Recommended: 500)                  │
│                                     │
│ [Save Settings]                     │
└─────────────────────────────────────┘
```

---

### 4. **View Active Targets**

#### 4.1. Get My Relance Targets

**Endpoint:** `GET /api/relance/targets`

**Headers:**
```
Authorization: Bearer <user-jwt-token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "targets": [
      {
        "_id": "68e12346xyz987",
        "referralUserId": {
          "_id": "675e56b891e9691b6fe52ad9",
          "name": "John Doe",
          "email": "john@example.com"
        },
        "campaignId": "68e12345abcd1234ef567890",
        "currentDay": 3,
        "status": "active",
        "nextMessageDue": "2025-01-07T18:00:00Z",
        "messagesDelivered": [
          { "day": 1, "sentAt": "2025-01-04T18:00:00Z", "status": "delivered" },
          { "day": 2, "sentAt": "2025-01-05T18:00:00Z", "status": "delivered" },
          { "day": 3, "sentAt": "2025-01-06T18:00:00Z", "status": "delivered" }
        ]
      }
    ],
    "totalCount": 15
  }
}
```

**Frontend Implementation:**
```javascript
async function getMyTargets() {
  const response = await fetch('http://localhost:3002/api/relance/targets', {
    headers: {
      'Authorization': `Bearer ${userToken}`
    }
  });

  const data = await response.json();

  if (data.success) {
    displayTargets(data.data.targets);
  }
}
```

---

## Complete User Flow Example

### **Campaign Creation Flow**

```javascript
// 1. User opens "Create Campaign" page
async function openCreateCampaignWizard() {
  // Show step 1: Campaign name
  showStep1();
}

// Step 1: Campaign Name
function showStep1() {
  const html = `
    <h2>Step 1: Campaign Name</h2>
    <input id="campaign-name" placeholder="Enter campaign name">
    <button onclick="showStep2()">Next</button>
  `;
  document.getElementById('wizard').innerHTML = html;
}

// Step 2: Select Filters
function showStep2() {
  const html = `
    <h2>Step 2: Select Filters</h2>
    <label>Countries:</label>
    <select id="countries" multiple>
      <option value="CM">Cameroon</option>
      <option value="NG">Nigeria</option>
      <option value="CI">Ivory Coast</option>
    </select>

    <label>Gender:</label>
    <select id="gender">
      <option value="all">All</option>
      <option value="male">Male</option>
      <option value="female">Female</option>
    </select>

    <label>Age Range:</label>
    <input id="min-age" type="number" placeholder="Min age">
    <input id="max-age" type="number" placeholder="Max age">

    <button onclick="previewFiltersStep()">Preview Results</button>
  `;
  document.getElementById('wizard').innerHTML = html;
}

// Step 3: Preview Results
async function previewFiltersStep() {
  const filters = {
    countries: Array.from(document.getElementById('countries').selectedOptions).map(o => o.value),
    gender: document.getElementById('gender').value,
    minAge: parseInt(document.getElementById('min-age').value) || undefined,
    maxAge: parseInt(document.getElementById('max-age').value) || undefined,
    excludeCurrentTargets: true
  };

  // Call preview API
  const response = await fetch('http://localhost:3002/api/relance/campaigns/preview', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${userToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ targetFilter: filters })
  });

  const data = await response.json();

  if (data.success) {
    showStep3(data.data, filters);
  }
}

// Step 3: Show Preview Results
function showStep3(previewData, filters) {
  const html = `
    <h2>Step 3: Preview Results</h2>
    <p><strong>${previewData.message}</strong></p>

    <h3>Sample Users (5 shown):</h3>
    <div id="sample-users">
      ${previewData.sampleUsers.map(user => `
        <div class="user-preview">
          <strong>${user.name}</strong><br>
          ${user.email} | ${user.phoneNumber}<br>
          ${user.country}, ${user.age} years, ${user.profession}
        </div>
      `).join('')}
    </div>

    <button onclick="createCampaignStep()">Create Campaign</button>
    <button onclick="showStep2()">Adjust Filters</button>
  `;
  document.getElementById('wizard').innerHTML = html;

  // Store filters for next step
  window.selectedFilters = filters;
}

// Step 4: Create Campaign
async function createCampaignStep() {
  const name = document.getElementById('campaign-name').value;
  const filters = window.selectedFilters;

  const response = await fetch('http://localhost:3002/api/relance/campaigns', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${userToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: name,
      targetFilter: filters,
      maxMessagesPerDay: 30
    })
  });

  const data = await response.json();

  if (data.success) {
    const campaignId = data.data._id;
    showStep4(campaignId);
  }
}

// Step 4: Start or Schedule
function showStep4(campaignId) {
  const html = `
    <h2>Campaign Created!</h2>
    <p>Your campaign is ready.</p>

    <button onclick="startCampaign('${campaignId}')">Start Now</button>
    <button onclick="window.location.href='/campaigns'">Start Later</button>
  `;
  document.getElementById('wizard').innerHTML = html;
}
```

---

## Filter Options Reference

### **Available Filters**

| Filter | Type | Required | Description | Example |
|--------|------|----------|-------------|---------|
| `countries` | `string[]` | No | Array of country codes (ISO 2-letter) | `["CM", "NG"]` |
| `gender` | `string` | No | Gender filter | `"all"`, `"male"`, `"female"`, `"other"` |
| `professions` | `string[]` | No | Array of professions | `["Engineer", "Teacher"]` |
| `minAge` | `number` | No | Minimum age | `18` |
| `maxAge` | `number` | No | Maximum age | `45` |
| `registrationDateFrom` | `string` (ISO) | No | Start date for registration | `"2024-01-01"` |
| `registrationDateTo` | `string` (ISO) | No | End date for registration | `"2025-12-31"` |
| `excludeCurrentTargets` | `boolean` | No | Exclude users already in campaigns | `true` |

**Example Filter Object:**
```javascript
const filters = {
  countries: ["CM", "NG", "CI"],
  gender: "all",
  professions: ["Engineer", "Teacher", "Doctor"],
  minAge: 18,
  maxAge: 45,
  registrationDateFrom: "2024-01-01",
  registrationDateTo: "2025-12-31",
  excludeCurrentTargets: true
};
```

---

## Error Handling

### **Common Error Responses**

```javascript
// WhatsApp Not Connected
{
  "success": false,
  "message": "WhatsApp not connected"
}

// No Active Subscription
{
  "success": false,
  "message": "User does not have active RELANCE subscription"
}

// Campaign Not Found
{
  "success": false,
  "message": "Campaign not found"
}

// Invalid Status Transition
{
  "success": false,
  "message": "Cannot start campaign with status: completed"
}

// Too Many Targets
{
  "success": false,
  "message": "Filter matches 550 targets, exceeds limit of 500"
}
```

### **Frontend Error Handling Example**

```javascript
async function handleApiCall(url, options) {
  try {
    const response = await fetch(url, options);
    const data = await response.json();

    if (!data.success) {
      // Display error to user
      showError(data.message);
      return null;
    }

    return data;

  } catch (error) {
    // Network error
    showError('Network error. Please check your connection.');
    return null;
  }
}

function showError(message) {
  // Display error toast/alert
  alert('Error: ' + message);
  // Or use a toast library
  // toast.error(message);
}
```

---

## UI/UX Recommendations

### **1. Campaign Creation Wizard**

**Steps:**
1. Campaign Name
2. Select Filters
3. **Preview Results** (show count + 5 sample users)
4. Confirm & Create
5. Start or Schedule

**Design Tips:**
- Use step indicator (1 → 2 → 3 → 4 → 5)
- Allow going back to adjust filters
- Show preview before creating
- Highlight the 5 sample users clearly
- Show clear "X users match" message

---

### **2. Campaign Dashboard**

**Elements:**
- List of all campaigns with status badges
- Progress bars for each campaign
- Quick actions (pause/resume/cancel)
- Delivery rate percentage
- "Create New Campaign" button

**Status Colors:**
- 🟢 Active (green)
- 🟡 Paused (yellow)
- 🔵 Draft (blue)
- ⚫ Completed (gray)
- 🔴 Cancelled (red)

---

### **3. Campaign Details Page**

**Sections:**
- Campaign Overview (name, status, dates)
- Statistics (targets, messages, delivery rate)
- Filters Applied (show what filters were used)
- Target List (paginated)
- Message History
- Actions (pause/resume/cancel)

---

### **4. WhatsApp Connection UI**

**Connection Flow:**
1. Show "Connect WhatsApp" button
2. Click → Show QR code in modal
3. Display instructions
4. Auto-close modal when connected
5. Show "✅ Connected" status

**Disconnected State:**
```
⚠️ WhatsApp Not Connected

To use Relance campaigns, you must connect
your WhatsApp account.

[Connect WhatsApp]
```

**Connected State:**
```
✅ WhatsApp Connected
Last scanned: Jan 4, 2025

[Disconnect]
```

---

## Testing Checklist

### **Frontend Integration Testing**

**WhatsApp Connection:**
- [ ] WhatsApp connection flow works
- [ ] QR code displays correctly
- [ ] Status updates when connected
- [ ] Normal disconnect works (session preserved)
- [ ] Force disconnect works (session deleted)
- [ ] Failure counter displays correctly (0-3)
- [ ] Reconnect without QR works (failureCount < 3)
- [ ] New QR required after 3 failures
- [ ] UI shows different states based on failureCount

**Campaign Management:**
- [ ] Filter preview shows correct count
- [ ] Sample users display (5 users)
- [ ] Campaign creation successful
- [ ] Campaign list displays
- [ ] Start/pause/resume/cancel work

**General:**
- [ ] Settings update correctly
- [ ] Error messages display properly
- [ ] Loading states work
- [ ] Authentication errors handled
- [ ] Network errors handled

---

## Support & Documentation

**Backend Documentation:**
- `CAMPAIGN_API_TESTING_GUIDE.md` - Complete API reference
- `CAMPAIGN_QUICK_START.md` - Quick reference
- `FILTERED_RELANCE_IMPLEMENTATION_PLAN.md` - Architecture

**Need Help?**
- Check network tab in browser dev tools
- Verify JWT token is valid
- Check server logs: `docker-compose logs -f notification-service`
- Look for `[Relance]` logs

---

## Summary

**User Frontend needs to implement:**

1. **WhatsApp Connection**
   - Connect/disconnect buttons
   - QR code display
   - Status indicator

2. **Campaign Creation**
   - Multi-step wizard
   - Filter selection UI
   - **Preview results (show count + 5 sample users)**
   - Create & start campaign

3. **Campaign Management**
   - List campaigns
   - Campaign details
   - Pause/resume/cancel actions
   - Progress tracking

4. **Settings**
   - Toggle simultaneous campaigns
   - Adjust message limits
   - Adjust target limits

**All endpoints are ready and functional!** 🎉
