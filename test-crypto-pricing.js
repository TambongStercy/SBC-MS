// Test script to verify crypto pricing implementation
const axios = require('axios');

const USER_SERVICE_URL = 'http://localhost:3001'; // Adjust port as needed
const PAYMENT_SERVICE_URL = 'http://localhost:3002'; // Adjust port as needed

async function testCryptoPricing() {
    console.log('🧪 Testing Crypto Pricing Implementation...\n');

    try {
        // Test 1: Get available plans with crypto pricing
        console.log('📋 Test 1: Getting available plans with crypto pricing');
        const cryptoPlansResponse = await axios.get(`${USER_SERVICE_URL}/api/subscriptions/plans?paymentMethod=crypto`);
        
        if (cryptoPlansResponse.data.success) {
            console.log('✅ Crypto plans retrieved successfully:');
            cryptoPlansResponse.data.data.forEach(plan => {
                console.log(`   - ${plan.name}: ${plan.price} ${plan.currency}`);
            });
        } else {
            console.log('❌ Failed to get crypto plans:', cryptoPlansResponse.data.message);
        }

        // Test 2: Get available plans with traditional pricing
        console.log('\n📋 Test 2: Getting available plans with traditional pricing');
        const traditionalPlansResponse = await axios.get(`${USER_SERVICE_URL}/api/subscriptions/plans?paymentMethod=traditional`);
        
        if (traditionalPlansResponse.data.success) {
            console.log('✅ Traditional plans retrieved successfully:');
            traditionalPlansResponse.data.data.forEach(plan => {
                console.log(`   - ${plan.name}: ${plan.price} ${plan.currency}`);
            });
        } else {
            console.log('❌ Failed to get traditional plans:', traditionalPlansResponse.data.message);
        }

        // Test 3: Compare pricing
        console.log('\n💰 Test 3: Pricing Comparison');
        if (cryptoPlansResponse.data.success && traditionalPlansResponse.data.success) {
            const cryptoClassique = cryptoPlansResponse.data.data.find(p => p.type === 'CLASSIQUE');
            const traditionalClassique = traditionalPlansResponse.data.data.find(p => p.type === 'CLASSIQUE');
            
            const cryptoCible = cryptoPlansResponse.data.data.find(p => p.type === 'CIBLE');
            const traditionalCible = traditionalPlansResponse.data.data.find(p => p.type === 'CIBLE');

            console.log('Classique Plan:');
            console.log(`   Traditional: ${traditionalClassique?.price} ${traditionalClassique?.currency}`);
            console.log(`   Crypto: ${cryptoClassique?.price} ${cryptoClassique?.currency}`);
            
            console.log('Cible Plan:');
            console.log(`   Traditional: ${traditionalCible?.price} ${traditionalCible?.currency}`);
            console.log(`   Crypto: ${cryptoCible?.price} ${cryptoCible?.currency}`);

            // Verify expected pricing
            const expectedPricing = {
                classique: { crypto: 4, traditional: 2070 },
                cible: { crypto: 10, traditional: 5140 }
            };

            let allCorrect = true;

            if (cryptoClassique?.price !== expectedPricing.classique.crypto) {
                console.log(`❌ Crypto Classique price incorrect: expected ${expectedPricing.classique.crypto}, got ${cryptoClassique?.price}`);
                allCorrect = false;
            }

            if (traditionalClassique?.price !== expectedPricing.classique.traditional) {
                console.log(`❌ Traditional Classique price incorrect: expected ${expectedPricing.classique.traditional}, got ${traditionalClassique?.price}`);
                allCorrect = false;
            }

            if (cryptoCible?.price !== expectedPricing.cible.crypto) {
                console.log(`❌ Crypto Cible price incorrect: expected ${expectedPricing.cible.crypto}, got ${cryptoCible?.price}`);
                allCorrect = false;
            }

            if (traditionalCible?.price !== expectedPricing.cible.traditional) {
                console.log(`❌ Traditional Cible price incorrect: expected ${expectedPricing.cible.traditional}, got ${traditionalCible?.price}`);
                allCorrect = false;
            }

            if (allCorrect) {
                console.log('✅ All pricing is correct!');
            }
        }

        console.log('\n🎉 Crypto pricing test completed!');
        console.log('\n📝 Summary:');
        console.log('   - Classique (Traditional): 2070 XAF (~$3.40)');
        console.log('   - Classique (Crypto): $4 USD');
        console.log('   - Cible (Traditional): 5140 XAF (~$8.40)');
        console.log('   - Cible (Crypto): $10 USD');
        console.log('   - Upgrade (Traditional): 3070 XAF (~$5.00)');
        console.log('   - Upgrade (Crypto): $6 USD');

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        if (error.response) {
            console.error('Response data:', error.response.data);
        }
    }
}

// Run the test
testCryptoPricing();