# WhatsApp Session Retry Implementation

## Overview
Implemented a 3-retry mechanism for WhatsApp connection failures to preserve user sessions and prevent unnecessary QR code rescanning.

---

## 🎯 Problem Statement

**Before:** Users had to rescan QR code every time connection failed (even temporary network issues)

**After:** Sessions are preserved for up to 3 consecutive failures, allowing automatic reconnection

---

## ✨ Key Features

### 1. **Automatic Failure Tracking**
- Tracks consecutive connection failures per user
- Increments counter on each `loggedOut` (401) disconnect
- Resets counter to 0 on successful connection

### 2. **3-Retry Policy**
- **Failures 1-2:** Session files preserved, connection can be retried
- **Failure 3:** Session files deleted, user must rescan QR code
- Prevents indefinite retry loops while giving reasonable retry attempts

### 3. **Force Disconnect Option**
- Users can manually reset their session immediately
- Useful when user wants fresh start (new phone, different WhatsApp account, etc.)
- Bypasses retry mechanism

### 4. **Transparent User Experience**
- No code changes required in frontend
- Sessions automatically preserved when possible
- Clear logging for troubleshooting

---

## 📊 Database Changes

### RelanceConfig Model Updates

**New Fields:**

```typescript
export interface IRelanceConfig extends Document {
    // ... existing fields ...

    connectionFailureCount: number;      // Track consecutive connection failures
    lastConnectionFailure?: Date;        // When last failure occurred

    // ... existing fields ...
}
```

**Schema:**

```typescript
connectionFailureCount: {
    type: Number,
    default: 0
},
lastConnectionFailure: {
    type: Date
}
```

---

## 🔧 Implementation Details

### Connection Failure Tracking

**Location:** `whatsapp.relance.service.ts`

**Logic:**

1. **On Connection Close (401 loggedOut):**
   ```typescript
   const failureCount = (currentConfig.connectionFailureCount || 0) + 1;

   await RelanceConfigModel.updateOne(
       { userId },
       {
           connectionFailureCount: failureCount,
           lastConnectionFailure: new Date()
       }
   );

   log.warn(`Connection failure ${failureCount}/3 for user ${userId}`);
   ```

2. **Session File Handling:**
   ```typescript
   if (failureCount >= 3) {
       log.error(`3 consecutive failures, deleting session files`);
       fs.rmSync(userSessionPath, { recursive: true, force: true });

       await RelanceConfigModel.updateOne(
           { userId },
           {
               whatsappStatus: WhatsAppStatus.DISCONNECTED,
               connectionFailureCount: 0
           }
       );
   } else {
       log.warn(`Keeping session files for retry (${failureCount}/3 failures)`);
       await RelanceConfigModel.updateOne(
           { userId },
           { whatsappStatus: WhatsAppStatus.DISCONNECTED }
       );
   }
   ```

3. **On Successful Connection:**
   ```typescript
   await RelanceConfigModel.updateOne(
       { userId },
       {
           whatsappStatus: WhatsAppStatus.CONNECTED,
           lastQrScanDate: new Date(),
           lastConnectionCheck: new Date(),
           connectionFailureCount: 0,        // ← Reset counter
           lastConnectionFailure: undefined  // ← Clear failure date
       }
   );
   ```

---

## 🎮 Updated Methods

### 1. `generateQRCode(userId)`

**Changes:**
- Only deletes session files if `failureCount >= 3`
- Preserves existing session files for retry attempts

```typescript
const failureCount = config?.connectionFailureCount || 0;
if (fs.existsSync(userSessionPath)) {
    if (failureCount >= 3) {
        log.info(`Deleting session (${failureCount} failures - threshold reached)`);
        fs.rmSync(userSessionPath, { recursive: true, force: true });
    } else {
        log.info(`Keeping session (${failureCount}/3 failures)`);
    }
}
```

### 2. `disconnect(userId, force?)`

**Changes:**
- Added optional `force` parameter
- Normal disconnect: preserves session files
- Force disconnect: deletes session files immediately

```typescript
async disconnect(userId: string, force: boolean = false): Promise<void> {
    // Close connection...

    if (force) {
        // Delete session files + reset counter
        fs.rmSync(userSessionPath, { recursive: true, force: true });
        await RelanceConfigModel.updateOne(
            { userId },
            {
                whatsappStatus: WhatsAppStatus.DISCONNECTED,
                connectionFailureCount: 0,
                lastConnectionFailure: undefined
            }
        );
    } else {
        // Normal disconnect - keep session files
        await RelanceConfigModel.updateOne(
            { userId },
            { whatsappStatus: WhatsAppStatus.DISCONNECTED }
        );
    }
}
```

### 3. Connection Event Handlers

**Updated Locations:**
- `generateQRCode()` → `connection.update` event (2 places)
- `initializeClient()` → `connection.update` event

**All `connection === 'open'` handlers:**
- Reset `connectionFailureCount` to 0
- Clear `lastConnectionFailure`

**All `connection === 'close'` handlers:**
- Track failure count
- Only delete session after 3rd failure

---

## 📡 API Changes

### Disconnect Endpoint

**Route:** `DELETE /api/relance/disconnect`

**Request Body (Optional):**
```json
{
    "force": true  // Optional: force delete session files
}
```

**Response:**
```json
{
    "success": true,
    "message": "WhatsApp session completely reset"  // if force=true
    // OR
    "message": "WhatsApp disconnected successfully" // if force=false
}
```

**Usage Examples:**

**Normal Disconnect (preserve session):**
```javascript
await fetch('/api/relance/disconnect', {
    method: 'DELETE',
    headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    }
});
```

**Force Disconnect (delete session):**
```javascript
await fetch('/api/relance/disconnect', {
    method: 'DELETE',
    headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({ force: true })
});
```

---

## 🔄 User Flow Examples

### Scenario 1: Temporary Network Issue

1. User's phone loses internet connection
2. WhatsApp connection closes → **Failure 1/3**
3. Session files preserved
4. User's phone reconnects to internet
5. User calls `GET /api/relance/qr` (or service auto-reconnects)
6. Connection succeeds using existing session
7. **Counter reset to 0/3** ✅

### Scenario 2: Repeated Connection Issues

1. Connection fails → **Failure 1/3** (session preserved)
2. User tries again, fails → **Failure 2/3** (session preserved)
3. User tries again, fails → **Failure 3/3** (session **DELETED**)
4. User must scan new QR code
5. User scans QR, connects successfully
6. **Counter reset to 0/3** ✅

### Scenario 3: User Wants Fresh Start

1. User clicks "Reset WhatsApp Connection" button
2. Frontend calls `DELETE /api/relance/disconnect` with `force: true`
3. Session files deleted immediately
4. User must scan new QR code

---

## 🎯 Benefits

### For Users
✅ **Less friction** - Don't need to rescan QR for temporary issues
✅ **Automatic recovery** - Session resumes after network issues
✅ **Control** - Can force reset if needed
✅ **Transparent** - Works automatically, no code changes

### For System
✅ **Prevents session bloat** - Deletes bad sessions after 3 failures
✅ **Better logging** - Track failure patterns per user
✅ **Graceful degradation** - Handles both temporary and permanent failures
✅ **Configurable** - 3-retry limit can be adjusted if needed

---

## 📝 Logging Examples

**Failure Tracking:**
```
[Baileys] Connection failure 1/3 for user 65d2b...
[Baileys] Keeping session files for retry (1/3 failures)
```

**3rd Failure:**
```
[Baileys] Connection failure 3/3 for user 65d2b...
[Baileys] User 65d2b... - 3 consecutive failures, deleting session files
```

**Successful Recovery:**
```
[Baileys] ✓ Successfully connected for user 65d2b...
[Reset failure counter to 0]
```

**Force Disconnect:**
```
[Baileys] Disconnecting user 65d2b... (FORCE)
[Baileys] Force disconnect - deleting session files for user 65d2b...
```

---

## 🧪 Testing Scenarios

### Test 1: Single Failure Recovery
1. User connects successfully
2. Simulate network disconnect (close connection)
3. Verify failure count = 1
4. Verify session files still exist
5. Reconnect
6. Verify failure count = 0

### Test 2: 3-Failure Threshold
1. User connects
2. Force disconnect 3 times
3. Verify session files deleted on 3rd failure
4. Verify failure count reset to 0

### Test 3: Force Disconnect
1. User connects
2. Call disconnect with `force: true`
3. Verify session files deleted immediately
4. Verify failure count reset to 0

### Test 4: Normal Disconnect
1. User connects
2. Call disconnect with `force: false` (or omit)
3. Verify session files still exist
4. Verify failure count unchanged

---

## ⚙️ Configuration

### Adjusting Retry Limit

To change the 3-retry limit, update all occurrences of:

```typescript
if (failureCount >= 3) {
    // Delete session
}
```

Example for 5 retries:
```typescript
if (failureCount >= 5) {
    // Delete session
}
```

**Locations to update:**
- `generateQRCode()` → connection.close handler (line ~199)
- `initializeClient()` → connection.close handler (line ~431)

---

## 📁 Files Modified

### Backend Files
- ✅ **Modified:** `notification-service/src/database/models/relance-config.model.ts`
  - Added `connectionFailureCount` field
  - Added `lastConnectionFailure` field

- ✅ **Modified:** `notification-service/src/services/whatsapp.relance.service.ts`
  - Updated `generateQRCode()` to preserve sessions
  - Updated `disconnect()` to support force parameter
  - Updated `initializeClient()` to track failures
  - Reset failure counter on all successful connections
  - Track failures on all connection.close events

- ✅ **Modified:** `notification-service/src/api/controllers/relance.controller.ts`
  - Updated `disconnectWhatsApp()` to support force parameter

---

## 🚀 Migration Notes

### Existing Users
- Existing users have `connectionFailureCount: 0` by default (schema default)
- No migration script needed
- Works immediately after deployment

### Database Update
```javascript
// Automatic via schema defaults
// No manual update needed
```

---

## 📊 Monitoring

### Key Metrics to Monitor

1. **Average failure count per user**
   ```javascript
   db.relanceconfigs.aggregate([
       { $group: { _id: null, avgFailures: { $avg: "$connectionFailureCount" } } }
   ])
   ```

2. **Users at failure threshold**
   ```javascript
   db.relanceconfigs.find({ connectionFailureCount: { $gte: 2 } })
   ```

3. **Recent failures**
   ```javascript
   db.relanceconfigs.find({
       lastConnectionFailure: { $gte: new Date(Date.now() - 24*60*60*1000) }
   })
   ```

---

## ✅ Summary

**Implementation Status:** ✅ **COMPLETE**

The WhatsApp session retry mechanism is now active:
- ✅ Sessions preserved for up to 3 consecutive failures
- ✅ Automatic failure tracking and counter reset
- ✅ Force disconnect option for manual session reset
- ✅ Comprehensive logging for troubleshooting
- ✅ Zero breaking changes for existing users
- ✅ Improved user experience with automatic recovery

**Retry Policy:** 3 consecutive failures before session deletion

**User Impact:** Positive - fewer QR code rescans, better reliability

**Next Steps:** Monitor failure rates and adjust retry limit if needed
