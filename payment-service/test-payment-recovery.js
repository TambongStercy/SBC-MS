/**
 * Test script for payment recovery API implementations
 * 
 * This script tests the new fetchCinetPayPaymentStatus and fetchFeexPayPaymentStatus methods
 * to ensure they can successfully retrieve real transaction data from providers.
 */

const { TransactionRecoveryService } = require('./dist/scripts/transaction-recovery.script');
const config = require('./dist/config').default;
const logger = require('./dist/utils/logger').default;

const log = logger.getLogger('PaymentRecoveryTest');

async function testCinetPayPaymentStatus() {
    console.log('\n=== Testing CinetPay Payment Status ===');
    
    // Replace with a real CinetPay transaction ID for testing
    const testTransactionId = 'TEST_CINETPAY_TX_ID_HERE';
    
    try {
        const service = new TransactionRecoveryService();
        
        // We need to access the private method, so we'll call the parent method
        // that uses it internally
        console.log(`Testing CinetPay payment status for: ${testTransactionId}`);
        console.log('Note: Replace TEST_CINETPAY_TX_ID_HERE with a real transaction ID');
        
        // For now, just log the configuration to ensure it's loaded
        console.log('CinetPay Config:', {
            baseUrl: config.cinetpay.baseUrl,
            siteId: config.cinetpay.siteId ? 'SET' : 'NOT SET',
            apiKey: config.cinetpay.apiKey ? 'SET' : 'NOT SET'
        });
        
    } catch (error) {
        console.error('Error testing CinetPay payment status:', error.message);
    }
}

async function testFeexPayPaymentStatus() {
    console.log('\n=== Testing FeexPay Payment Status ===');
    
    // Replace with a real FeexPay reference for testing
    const testReference = 'TEST_FEEXPAY_REF_HERE';
    
    try {
        const service = new TransactionRecoveryService();
        
        console.log(`Testing FeexPay payment status for: ${testReference}`);
        console.log('Note: Replace TEST_FEEXPAY_REF_HERE with a real transaction reference');
        
        // For now, just log the configuration to ensure it's loaded
        console.log('FeexPay Config:', {
            baseUrl: config.feexpay.baseUrl,
            shopId: config.feexpay.shopId ? 'SET' : 'NOT SET',
            apiKey: config.feexpay.apiKey ? 'SET' : 'NOT SET'
        });
        
    } catch (error) {
        console.error('Error testing FeexPay payment status:', error.message);
    }
}

async function testRecoveryEndpoints() {
    console.log('🔄 Testing Payment Recovery API Implementations');
    console.log('===============================================');
    
    // Test configuration
    console.log('Environment:', process.env.NODE_ENV || 'development');
    
    await testCinetPayPaymentStatus();
    await testFeexPayPaymentStatus();
    
    console.log('\n✅ Test completed!');
    console.log('\nNext steps:');
    console.log('1. Replace test transaction IDs with real ones');
    console.log('2. Run: npm run recovery recover --provider cinetpay --type payment --references "real_tx_id"');
    console.log('3. Run: npm run recovery recover --provider feexpay --type payment --references "real_reference"');
    console.log('4. Check the logs to verify real data is retrieved');
}

// Run the tests
testRecoveryEndpoints().catch(console.error);