# Admin Message Limit Bug - Root Cause Analysis and Fix

## Problem

Admin users were being blocked at the 4th message with error:
```json
{"success":false,"message":"Failed to send message"}
```

Despite having exemption logic for admin users in the 3-message limit feature.

## Root Cause

The bug was in the **user-service** endpoint `/api/users/internal/:userId/validate`.

### The Issue

**chat-service** calls this endpoint to get user details and check if the user is an admin:

```typescript
// chat-service/src/services/clients/user.service.client.ts
async getUserDetails(userId: string): Promise<UserDetails | null> {
    const response = await this.apiClient.get(`/users/internal/${userId}/validate`);
    if (response.data.success && response.data.data) {
        return response.data.data; // Expects user data here
    }
    return null;
}

async isAdmin(userId: string): Promise<boolean> {
    const user = await this.getUserDetails(userId);
    return user?.role === 'admin'; // Checks role field
}
```

**But the user-service endpoint was NOT returning user data:**

```typescript
// BEFORE (user-service/src/api/controllers/user.controller.ts)
async validateUser(req: Request, res: Response): Promise<void> {
    const isValid = await this.userService.validateUser(userId);
    res.status(200).json({
        success: true,
        valid: isValid
        // ❌ Missing: data field with user role!
    });
}
```

Result:
- `response.data.data` was `undefined`
- `user?.role` was `undefined`
- `isAdmin()` returned `false` for ALL users (including admins)
- Admin exemption never triggered
- Admin users hit the 3-message limit

## The Fix

Updated user-service endpoint to return user data with role field:

```typescript
// AFTER (user-service/src/api/controllers/user.controller.ts)
async validateUser(req: Request, res: Response): Promise<void> {
    const user = await this.userService.getUserById(userId);

    if (!user || user.blocked || user.deleted) {
        return res.status(200).json({
            success: true,
            valid: false,
            data: null
        });
    }

    // ✅ Now returns user data including role
    res.status(200).json({
        success: true,
        valid: true,
        data: {
            _id: user._id.toString(),
            name: user.name,
            email: user.email,
            phoneNumber: user.phoneNumber,
            avatar: user.avatar,
            country: user.country,
            city: user.city,
            region: user.region,
            role: user.role // IMPORTANT: Now included for admin checks
        }
    });
}
```

## Enhanced Debug Logging

Added comprehensive logging to help diagnose similar issues in the future:

### chat-service/src/services/conversation.service.ts

```typescript
async checkMessageLimit(conversationId: string, userId: string): Promise<void> {
    log.debug(`[checkMessageLimit] Starting check for user ${userId} in conversation ${conversationId}`);
    log.debug(`[checkMessageLimit] Conversation acceptanceStatus: ${conversation.acceptanceStatus}`);

    const isAdmin = await userServiceClient.isAdmin(userId);
    log.debug(`[checkMessageLimit] User ${userId} admin check result: ${isAdmin}`);

    if (isAdmin) {
        log.info(`[checkMessageLimit] User ${userId} is admin, exempting from limit`);
        return;
    }

    // ... more logging throughout the method
}
```

### chat-service/src/services/clients/user.service.client.ts

```typescript
async getUserDetails(userId: string): Promise<UserDetails | null> {
    const response = await this.apiClient.get(`/users/internal/${userId}/validate`);
    log.debug(`[getUserDetails] Response for user ${userId}:`, {
        success: response.data.success,
        hasData: !!response.data.data,
        role: response.data.data?.role
    });
    // ...
}

async isAdmin(userId: string): Promise<boolean> {
    const user = await this.getUserDetails(userId);
    const isAdminResult = user?.role === 'admin';
    log.debug(`[isAdmin] User ${userId} - role: ${user?.role}, isAdmin: ${isAdminResult}`);
    return isAdminResult;
}
```

## Files Modified

### 1. user-service/src/api/controllers/user.controller.ts
- **Line 616-655**: Updated `validateUser()` method to return user data with role field

### 2. chat-service/src/services/conversation.service.ts
- **Line 264-326**: Added comprehensive debug logging to `checkMessageLimit()` method

### 3. chat-service/src/services/clients/user.service.client.ts
- **Line 38-56**: Added logging to `getUserDetails()` method
- **Line 95-105**: Added logging to `isAdmin()` method

## Testing the Fix

### 1. Restart Services

Since you're running with `npm run dev`, the changes should auto-reload. If not, restart:

**Terminal 1 - User Service:**
```bash
cd user-service
npm run dev
```

**Terminal 2 - Chat Service:**
```bash
cd chat-service
npm run dev
```

### 2. Verify Admin User Role

First, check your admin user in MongoDB:

```bash
# Connect to MongoDB
mongosh

# Switch to user service database
use sbc_user_dev

# Find your admin user
db.users.findOne({ email: "your-admin@email.com" }, { role: 1, email: 1, name: 1 })
```

Expected output:
```json
{
  "_id": ObjectId("..."),
  "email": "your-admin@email.com",
  "name": "Your Name",
  "role": "admin"  // ✅ This must be "admin"
}
```

If role is not "admin", update it:
```javascript
db.users.updateOne(
    { email: "your-admin@email.com" },
    { $set: { role: "admin" } }
)
```

### 3. Test Message Sending

1. **Start a new conversation** (or use existing one)
2. **Send 4+ messages** as the admin user
3. **Expected Result**: All messages go through without errors

### 4. Monitor Debug Logs

Watch the chat-service logs for debug output:

```
[checkMessageLimit] Starting check for user 67... in conversation 68...
[checkMessageLimit] Conversation acceptanceStatus: pending
[checkMessageLimit] Checking if user 67... is admin...
[getUserDetails] Response for user 67...: { success: true, hasData: true, role: 'admin' }
[isAdmin] User 67... - role: admin, isAdmin: true
[checkMessageLimit] User 67... is admin, exempting from limit
```

### 5. Test Non-Admin Users

To verify the limit still works for regular users:

1. **Log in as non-admin user**
2. **Start a new conversation**
3. **Send 3 messages** - should work
4. **Send 4th message** - should fail with:
   ```json
   {
     "success": false,
     "message": "You have reached the maximum of 3 messages. The recipient must accept this conversation before you can send more messages."
   }
   ```

### 6. Test Referral Exemption

For users with direct referral relationship:

1. **User A** directly refers **User B**
2. **User A** and **User B** chat
3. Both should be able to send unlimited messages (no limit applies)

## How the 3-Message Limit Works

### Flow Chart

```
User sends message
    ↓
checkMessageLimit()
    ↓
Is conversation accepted? → YES → ✅ Allow
    ↓ NO
Is conversation reported/blocked? → YES → ❌ Block
    ↓ NO
Is user admin? → YES → ✅ Allow (FIXED!)
    ↓ NO
Do users have direct referral? → YES → ✅ Allow
    ↓ NO
Message count < 3? → YES → ✅ Allow
    ↓ NO
❌ Block with error message
```

### Exemptions

1. **Accepted Conversations**: No limit once recipient accepts
2. **Admin Users**: Can send unlimited messages
3. **Direct Referrals**: Level 1 referral relationships (both directions)
4. **Within Limit**: Users can send up to 3 messages before needing acceptance

### Actions After 3 Messages

Recipient can:
- **Accept**: `POST /api/chat/conversations/:id/accept`
  - Sets `acceptanceStatus` to 'accepted'
  - Removes all message limits

- **Report**: `POST /api/chat/conversations/:id/report`
  - Sets `acceptanceStatus` to 'reported'
  - Blocks ALL future messages from sender

## Common Issues and Debugging

### Issue 1: Admin still blocked

**Check:**
1. Is user's role actually "admin" in database?
   ```javascript
   db.users.findOne({ _id: ObjectId("YOUR_USER_ID") }, { role: 1 })
   ```

2. Is user-service returning the role?
   - Check logs: `[getUserDetails] Response for user ...`
   - Should show `role: 'admin'`

3. Is SERVICE_SECRET configured correctly?
   - Check chat-service/.env: `SERVICE_SECRET=...`
   - Check user-service/.env: `SERVICE_SECRET=...`
   - They must match!

### Issue 2: userServiceClient errors

**Symptoms:**
- Logs show "Error fetching user..."
- Admin check returns false

**Check:**
1. Is user-service running? Check port 3001
   ```bash
   curl http://localhost:3001/api/health
   ```

2. Is USER_SERVICE_URL correct in chat-service/.env?
   ```bash
   USER_SERVICE_URL=http://localhost:3001/api
   ```

3. Check chat-service logs for connection errors

### Issue 3: Non-admin users can send unlimited messages

**Check:**
1. Conversation acceptanceStatus:
   ```javascript
   db.conversations.findOne({ _id: ObjectId("CONVERSATION_ID") })
   ```
   - Should be 'pending' for new conversations
   - Should NOT be 'accepted' until recipient accepts

2. Message counts tracking:
   ```javascript
   db.conversations.findOne(
       { _id: ObjectId("CONVERSATION_ID") },
       { messageCounts: 1 }
   )
   ```
   - Should show message counts per user

## Related Documentation

- [CONVERSATION_ACCEPTANCE_FRONTEND_GUIDE.md](./chat-service/CONVERSATION_ACCEPTANCE_FRONTEND_GUIDE.md) - Frontend implementation guide
- [CONTENT_MODERATION_GUIDE.md](./chat-service/CONTENT_MODERATION_GUIDE.md) - Content moderation setup
- [NSFWJS_DEPLOYMENT_GUIDE.md](./chat-service/NSFWJS_DEPLOYMENT_GUIDE.md) - NSFW.js deployment

## Summary

**Root Cause**: user-service endpoint not returning user role field

**Fix**: Updated endpoint to include user data with role in response

**Result**: Admin exemption now works correctly

**Test**: Send 4+ messages as admin - should work without errors
