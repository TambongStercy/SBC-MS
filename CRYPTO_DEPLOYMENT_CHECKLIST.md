# Crypto Payments Deployment Checklist

## 🚀 **Pre-Deployment Checklist**

### **1. Database Preparation**
- [ ] **Run USD Balance Migration**
  ```bash
  cd user-service
  node src/scripts/add-usd-balance-migration.js
  ```
- [ ] **Verify Migration Success**
  - [ ] All users have `usdBalance: 0` field
  - [ ] No migration errors in logs
  - [ ] Database indexes updated

### **2. Environment Configuration**

#### **NOWPayments API Configuration**
- [ ] **Payment Service `.env`**:
  ```env
  NOWPAYMENTS_API_KEY=your_api_key_here
  NOWPAYMENTS_PAYOUT_API_KEY=your_payout_key_here  
  NOWPAYMENTS_IPN_SECRET=your_ipn_secret_here
  NOWPAYMENTS_SANDBOX=false  # Set to true for testing
  ```

#### **Service URLs Configuration**
- [ ] **User Service URL** in payment service config
- [ ] **Payment Service URL** in user service config
- [ ] **Webhook URLs** accessible from NOWPayments

### **3. Code Deployment**

#### **User Service Changes**
- [ ] **Model**: `usdBalance` field added to User schema
- [ ] **Repository**: `updateUsdBalance()` method added
- [ ] **Service**: USD balance and conversion methods added
- [ ] **Controller**: USD balance endpoints added
- [ ] **Routes**: USD balance routes added

#### **Payment Service Changes**
- [ ] **Config**: Crypto pricing configuration added
- [ ] **Service**: Crypto payment methods added to PaymentService
- [ ] **Controller**: Crypto payment endpoints added
- [ ] **Routes**: Crypto payment routes added
- [ ] **Client**: USD balance methods added to UserServiceClient

#### **Frontend Changes**
- [ ] **Payment Page**: Crypto payments enabled (beta flag removed)
- [ ] **JavaScript**: Crypto payment functionality added
- [ ] **Assets**: Payment JS file deployed

### **4. Service Dependencies**

#### **Required Services Running**
- [ ] **User Service**: Port 3001
- [ ] **Payment Service**: Port 3002
- [ ] **MongoDB**: Database accessible
- [ ] **NOWPayments API**: Connectivity verified

#### **Service Communication**
- [ ] User service can reach payment service
- [ ] Payment service can reach user service
- [ ] NOWPayments can reach webhook endpoints

### **5. Testing Verification**

#### **Basic Functionality Tests**
- [ ] **USD Balance Operations**: Get, update, convert
- [ ] **Crypto Estimates**: XAF→USD conversion works
- [ ] **Crypto Payments**: Address generation works
- [ ] **Webhook Processing**: Test webhook handling
- [ ] **Commission Distribution**: USD commissions work

#### **End-to-End Tests**
- [ ] **Complete Payment Flow**: From estimate to completion
- [ ] **Frontend Integration**: Crypto payments work in UI
- [ ] **Error Handling**: Graceful error responses
- [ ] **Currency Conversion**: Rates applied correctly

### **6. Security Verification**

#### **API Security**
- [ ] **NOWPayments Credentials**: Properly secured
- [ ] **Webhook Signatures**: Verification enabled
- [ ] **Service Authentication**: Inter-service auth working
- [ ] **Input Validation**: All endpoints validated

#### **Data Security**
- [ ] **Balance Updates**: Atomic operations
- [ ] **Transaction Logging**: Complete audit trail
- [ ] **Error Logging**: No sensitive data in logs
- [ ] **Rate Limiting**: API endpoints protected

### **7. Monitoring Setup**

#### **Logging Configuration**
- [ ] **Crypto Payment Logs**: Proper log levels set
- [ ] **Error Tracking**: Error monitoring enabled
- [ ] **Performance Monitoring**: Response time tracking
- [ ] **Business Metrics**: Commission tracking

#### **Alerts Configuration**
- [ ] **Failed Payments**: Alert on crypto payment failures
- [ ] **API Errors**: Alert on NOWPayments API issues
- [ ] **Balance Discrepancies**: Alert on balance issues
- [ ] **Webhook Failures**: Alert on webhook processing failures

### **8. Documentation**

#### **Technical Documentation**
- [ ] **API Documentation**: Crypto endpoints documented
- [ ] **Service Architecture**: Updated with crypto services
- [ ] **Database Schema**: USD balance field documented
- [ ] **Configuration Guide**: Environment setup documented

#### **User Documentation**
- [ ] **Crypto Payment Guide**: User instructions
- [ ] **Currency Conversion**: Rates and process explained
- [ ] **Commission Structure**: USD commission rates documented
- [ ] **Troubleshooting**: Common issues and solutions

## 🎯 **Deployment Steps**

### **Step 1: Database Migration**
```bash
# Backup database first
mongodump --db your_database_name

# Run migration
cd user-service
node src/scripts/add-usd-balance-migration.js

# Verify migration
mongo your_database_name --eval "db.users.findOne({}, {usdBalance: 1})"
```

### **Step 2: Service Deployment**
```bash
# Deploy user service
cd user-service
npm run build
pm2 restart user-service

# Deploy payment service  
cd payment-service
npm run build
pm2 restart payment-service

# Deploy frontend assets
cp payment-service/src/public/* /var/www/html/assets/
```

### **Step 3: Configuration Update**
```bash
# Update environment variables
# Restart services with new config
pm2 restart all
```

### **Step 4: Verification**
```bash
# Test API endpoints
curl -X GET http://localhost:3001/api/users/USER_ID/usd-balance
curl -X POST http://localhost:3002/api/payments/crypto-estimate

# Check service logs
pm2 logs user-service
pm2 logs payment-service
```

## ✅ **Post-Deployment Verification**

### **Immediate Checks (First 30 minutes)**
- [ ] **Services Started**: All services running without errors
- [ ] **Database Connection**: Services connected to database
- [ ] **API Endpoints**: Crypto endpoints responding
- [ ] **Frontend**: Crypto payment option visible and working

### **Short-term Monitoring (First 24 hours)**
- [ ] **Payment Processing**: Monitor crypto payment success rate
- [ ] **Commission Distribution**: Verify USD commissions working
- [ ] **Error Rates**: Monitor for increased error rates
- [ ] **Performance**: Check response times

### **Long-term Monitoring (First Week)**
- [ ] **User Adoption**: Track crypto payment usage
- [ ] **Conversion Rates**: Monitor XAF to crypto conversion rates
- [ ] **Balance Accuracy**: Verify USD balance accuracy
- [ ] **System Stability**: Ensure no performance degradation

## 🚨 **Rollback Plan**

### **If Issues Occur**
1. **Immediate**: Disable crypto payments (set beta flag to true)
2. **Database**: Restore from backup if needed
3. **Services**: Rollback to previous version
4. **Frontend**: Revert frontend changes

### **Rollback Commands**
```bash
# Disable crypto payments
# Set isBeta = true in payment.ejs

# Rollback services
pm2 stop user-service payment-service
git checkout previous-stable-version
npm run build
pm2 start all

# Restore database if needed
mongorestore --drop backup-directory/
```

## 🎉 **Success Metrics**

### **Deployment Successful When**:
- ✅ All services running without errors
- ✅ Crypto payments processing successfully  
- ✅ USD commissions distributing correctly
- ✅ No increase in error rates
- ✅ Frontend crypto payments working
- ✅ Currency conversion working properly

### **Business Metrics to Track**:
- **Crypto Payment Volume**: Number and value of crypto payments
- **Commission Distribution**: USD commissions paid out
- **User Adoption**: Users using crypto payments
- **Conversion Rates**: XAF to crypto conversion success rate

The crypto payment system is now ready for production deployment! 🚀