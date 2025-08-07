# WhatsApp OTP Test Scripts

I've created two test scripts to verify your WhatsApp service is working with your number `237675080477`.

## Option 1: Simple Direct API Test (Recommended)

This script directly calls the WhatsApp API without dependencies:

```bash
cd notification-service
node simple-whatsapp-test.js
```

**What it does:**
- ✅ Sends a plain text OTP message to your number
- ✅ Attempts to send an OTP template message
- ✅ Tests phone number formatting (237675080477)
- ✅ Provides detailed error diagnostics

## Option 2: Full Service Test

This script uses your actual WhatsApp service classes:

```bash
cd notification-service
node test-whatsapp-otp.js
```

**What it does:**
- ✅ Tests the WhatsApp Cloud Service initialization
- ✅ Tests phone number formatting logic
- ✅ Sends OTP using template method (preferred)
- ✅ Falls back to plain text if template fails
- ✅ Tests legacy sendTextMessage method

## Expected Results

If working correctly, you should receive:
1. **Plain text message**: "🔐 Your SBC verification code is: 123456..."
2. **Template message**: Formatted OTP message using your approved template
3. **Console output**: Success messages with WhatsApp message IDs

## Troubleshooting

### Common Issues:
- **401 Unauthorized**: Check `WHATSAPP_ACCESS_TOKEN` in .env
- **404 Not Found**: Check `WHATSAPP_PHONE_NUMBER_ID` in .env  
- **Template errors**: Template might not be approved in WhatsApp Business Manager
- **Phone number errors**: Number might not be registered on WhatsApp

### Error Codes:
- **131000**: Generic user error (often phone number issues)
- **131005**: Phone number not registered on WhatsApp
- **131014**: Invalid recipient phone number
- **131026**: Message failed to send

## Your Test Configuration

- **Phone Number**: 237675080477 (Cameroon)
- **Test OTP**: 123456
- **Templates**: connexion (English), connexionfr (French)
- **Expected Format**: 237675080477 ✅

## Quick Test Command

For the fastest test, run:
```bash
cd notification-service && node simple-whatsapp-test.js
```

This will immediately attempt to send a test OTP to your number and show detailed results.