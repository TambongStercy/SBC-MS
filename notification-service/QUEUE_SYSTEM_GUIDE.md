# Notification Queue System Guide

## Overview

The notification service now uses a robust queue system powered by Redis and Bull Queue to handle email and SMS delivery reliably. This replaces the previous immediate-send approach that could fail silently.

## Why Queue System?

### Previous Issues:
- **Silent Failures**: If SMTP servers were down or slow, notifications failed without proper retry
- **Poor User Experience**: Users experiencing "forgot password" issues when emails failed to send
- **No Reliability**: Single-point-of-failure with immediate sending
- **No Monitoring**: Difficult to track failed notifications

### New Benefits:
- **Automatic Retries**: Failed notifications retry 5 times with exponential backoff
- **Reliability**: Notifications survive service restarts and network issues
- **Monitoring**: Full visibility into queue statistics and failed jobs
- **Performance**: Non-blocking notification sending
- **Scalability**: Can handle high notification volumes

## Architecture

```
User Request → Notification Service → Queue → Background Workers → Email/SMS Provider
                     ↓
                Database (Pending)
                     ↓
              Background Workers → Email/SMS Provider → Update Status (Sent/Failed)
```

## Queue Configuration

### Redis Settings
```bash
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=        # Optional
REDIS_DB=0
```

### Queue Settings
- **Email Queue**: Processes 5 jobs concurrently
- **SMS Queue**: Processes 3 jobs concurrently  
- **Retry Policy**: 5 attempts with exponential backoff (5s, 25s, 125s, 625s, 3125s)
- **Job Retention**: Keeps 100 completed jobs and 50 failed jobs for monitoring

## How It Works

### 1. Notification Creation
When a notification is requested:
1. Create notification record in MongoDB with `PENDING` status
2. Add job to appropriate queue (email/sms)
3. Return immediately to client

### 2. Background Processing
Queue workers continuously:
1. Pick up jobs from queue
2. Fetch notification from database
3. Attempt to send via email/SMS service
4. Update notification status (`SENT` or `FAILED`)
5. If failed, Bull automatically retries with backoff

### 3. Monitoring
- Queue statistics available via `/api/notifications/queue/stats`
- Job status tracking in Redis
- Notification status in MongoDB

## Usage Examples

### Send Email Notification (from user-service)
```typescript
// This now automatically queues the notification
await notificationService.sendOtp({
    userId: user._id.toString(),
    recipient: user.email,
    channel: DeliveryChannel.EMAIL,
    code: otpCode,
    expireMinutes: 10,
    isRegistration: false,
    userName: user.name
});
```

### Monitor Queue Health
```bash
GET /api/notifications/queue/stats
```

Response:
```json
{
  "success": true,
  "data": {
    "email": {
      "waiting": 0,
      "active": 2,
      "completed": 150,
      "failed": 3
    },
    "sms": {
      "waiting": 0,
      "active": 1,
      "completed": 45,
      "failed": 1
    }
  },
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

## Deployment Requirements

### Development
1. Install Redis:
   ```bash
   # macOS
   brew install redis
   brew services start redis
   
   # Ubuntu/Debian
   sudo apt install redis-server
   sudo systemctl start redis
   
   # Windows
   # Use Docker or WSL
   ```

2. Update environment variables:
   ```bash
   REDIS_HOST=localhost
   REDIS_PORT=6379
   REDIS_DB=0
   ```

3. Install dependencies:
   ```bash
   cd notification-service
   npm install
   ```

### Production
1. Use Docker Compose (Redis already included):
   ```bash
   docker-compose up -d
   ```

2. Or deploy Redis separately:
   ```bash
   # Use managed Redis service (AWS ElastiCache, Azure Redis, etc.)
   REDIS_HOST=your-redis-host.com
   REDIS_PORT=6379
   REDIS_PASSWORD=your-password
   ```

## Troubleshooting

### Common Issues

#### 1. Redis Connection Errors
```
Error: Redis connection failed
```
**Solution**: Ensure Redis is running and accessible:
```bash
redis-cli ping  # Should return "PONG"
```

#### 2. High Failed Job Count
**Check**: 
- SMTP credentials and configuration
- Network connectivity to email provider
- Rate limiting from email provider

#### 3. Jobs Stuck in Waiting
**Check**:
- Redis memory usage
- Worker processes running
- Queue processing not stalled

### Monitoring Commands

#### Check Queue Statistics
```bash
curl -H "Authorization: Bearer sbc_all_services" \
     http://localhost:3002/api/notifications/queue/stats
```

#### Check Redis Directly
```bash
redis-cli
> KEYS bull:email*
> LLEN bull:email:waiting
> LLEN bull:email:failed
```

#### Check Notification Status in Database
```javascript
// MongoDB query
db.notifications.find({
  status: "FAILED",
  createdAt: { $gte: new Date("2024-01-15") }
}).sort({ createdAt: -1 })
```

## Migration from Old System

The queue system is backward compatible. Existing notification code will automatically use the new queue system without changes.

### Legacy Background Processor
The old `notificationProcessor.ts` still runs as a fallback, but with the queue system, it should have very few pending notifications to process.

## Performance Tuning

### High Volume Deployments
For high notification volumes, consider:

1. **Increase Concurrency**:
   ```typescript
   // In queue.service.ts
   this.emailQueue.process('send-email', 10, ...)  // Increase from 5
   ```

2. **Separate Redis Instance**:
   ```bash
   REDIS_HOST=dedicated-redis-for-queues.com
   ```

3. **Monitor Memory Usage**:
   ```bash
   redis-cli info memory
   ```

4. **Scale Workers Horizontally**:
   Deploy multiple notification-service instances - they'll share the same Redis queue.

## Security Considerations

1. **Redis Security**:
   - Use AUTH if Redis is network-accessible
   - Configure firewall to restrict Redis access
   - Use TLS for Redis connections in production

2. **Queue Isolation**:
   - Use separate Redis DB for different environments
   - Consider separate Redis instances for different services

## Future Enhancements

1. **Dead Letter Queue**: Move permanently failed jobs to separate queue for manual inspection
2. **Priority Queues**: High-priority notifications (OTP, password reset) get processed first  
3. **Rate Limiting**: Respect email provider rate limits
4. **Webhooks**: Real-time notification of delivery status
5. **Analytics**: Track delivery rates and performance metrics 