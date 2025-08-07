# WhatsApp Business API Pricing Guide

## 🏷️ **Pricing Model: Conversation-Based**

WhatsApp charges per **24-hour conversation window**, not per individual message. Once a conversation starts, you can send multiple messages within 24 hours for the same price.

## 💬 **Conversation Types**

### 1. **Business-Initiated Conversations**
- **When**: You send the first message to a user
- **Requirements**: Must use approved message templates
- **Examples**: OTP codes, notifications, marketing messages
- **Cost**: Higher rate (varies by country)

### 2. **User-Initiated Conversations** 
- **When**: User messages you first
- **Messages**: Can send any message type (templates or free-form)
- **Examples**: Customer support, replies to user questions
- **Cost**: Lower rate (varies by country)

## 🌍 **Regional Pricing (USD per conversation)**

### **Africa Region** (Your main market):
| Country | Business-Initiated | User-Initiated |
|---------|-------------------|----------------|
| **Cameroon** 🇨🇲 | $0.0327 | $0.0164 |
| **Nigeria** 🇳🇬 | $0.0327 | $0.0164 |
| **Kenya** 🇰🇪 | $0.0327 | $0.0164 |
| **Ghana** 🇬🇭 | $0.0327 | $0.0164 |
| **South Africa** 🇿🇦 | $0.0327 | $0.0164 |
| **Most African Countries** | $0.0327 | $0.0164 |

### **Other Regions**:
| Region | Business-Initiated | User-Initiated |
|--------|-------------------|----------------|
| **North America** | $0.0255 | $0.0127 |
| **Europe** | $0.0364 | $0.0182 |
| **Asia Pacific** | $0.0364 | $0.0182 |
| **Latin America** | $0.0327 | $0.0164 |
| **Middle East** | $0.0327 | $0.0164 |
| **Rest of World** | $0.0327 | $0.0164 |

## 🔄 **How Conversations Work**

### **Scenario 1: Business-Initiated (Template)**
```
Day 1, 10:00 AM: You send OTP template → Starts 24hr window
Day 1, 10:05 AM: You send another template → Same conversation (FREE)
Day 1, 2:00 PM: You send plain text → Same conversation (FREE)
Day 1, 8:00 PM: You send another template → Same conversation (FREE)
Day 2, 10:01 AM: 24hr window expires

Cost: $0.0327 (for Cameroon) - ONE conversation charge
```

### **Scenario 2: User-Initiated**
```
Day 1, 3:00 PM: User sends "Hi" → Starts 24hr window
Day 1, 3:01 PM: You reply with template → Same conversation (FREE)
Day 1, 5:00 PM: You send OTP template → Same conversation (FREE)
Day 1, 8:00 PM: You send plain text → Same conversation (FREE)
Day 2, 3:01 PM: 24hr window expires

Cost: $0.0164 (for Cameroon) - ONE conversation charge
```

### **Scenario 3: Template During Active Conversation**
```
Day 1, 10:00 AM: You send OTP template → Business-initiated ($0.0327)
Day 1, 11:00 AM: User replies "Thanks" → Doesn't start new conversation
Day 1, 2:00 PM: You send another template → Still same conversation (FREE)
Day 1, 6:00 PM: You send marketing template → Still same conversation (FREE)

Total Cost: $0.0327 - Only the initial conversation
```

## 💰 **Cost Analysis for Your Use Case**

### **OTP Messages (Your Primary Use)**:
- **Cost per OTP**: $0.0327 (Cameroon) if business-initiated
- **Multiple messages**: FREE within 24 hours
- **Follow-up templates**: FREE within same conversation

### **Monthly Cost Estimates**:
```
Scenario: 1000 OTP messages/month to Cameroon users

If all business-initiated:
1000 conversations × $0.0327 = $32.70/month

If 50% user-initiated (user contacts support first):
500 × $0.0327 + 500 × $0.0164 = $24.55/month

If 80% user-initiated:
200 × $0.0327 + 800 × $0.0164 = $19.66/month
```

## 🎯 **Cost Optimization Strategies**

### 1. **Encourage User-Initiated Conversations**
- Add "Contact Support" buttons in your app
- Encourage users to message you first
- 50% cost savings when user initiates

### 2. **Batch Messages Within 24 Hours**
- Send multiple notifications in same conversation
- Group related messages together
- Additional messages are FREE

### 3. **Use Templates Strategically**
- Templates work anytime (no 24hr restriction)
- Same cost whether template or plain text
- Better delivery rates

### 4. **Regional Considerations**
- African countries have consistent pricing
- No premium for your main markets
- Same rate across most African countries

## 📊 **Free Tier & Billing**

### **Free Tier**:
- **1,000 conversations/month** FREE
- Applies to both business and user-initiated
- Great for testing and small scale

### **Billing**:
- Monthly billing cycle
- Pay only for conversations that start
- No charges for messages within active conversations

## 🔍 **Key Takeaways for Your Business**

1. **Templates vs Plain Text**: Same cost within a conversation
2. **Multiple Templates**: FREE if sent within 24 hours of conversation start
3. **African Pricing**: Consistent $0.0327/$0.0164 across your markets
4. **Optimization**: Encourage user-initiated conversations for 50% savings
5. **Scale**: 1,000 free conversations/month to start

## 📈 **Monitoring Costs**

You can track conversation costs in:
- WhatsApp Business Manager
- Meta Business Account billing
- API analytics (conversation counts)

The key insight: **It's about conversations, not messages**. Once a conversation starts, send as many messages as needed within 24 hours at no extra cost!