const readline = require('readline');

// Create readline interface
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Function to extract timestamp from MongoDB ObjectId
function extractTimestampFromObjectId(objectId) {
    try {
        // Remove any whitespace and validate length
        const cleanId = objectId.trim();
        
        if (cleanId.length !== 24) {
            throw new Error('ObjectId must be exactly 24 characters long');
        }
        
        // Check if it's a valid hex string
        if (!/^[0-9a-fA-F]{24}$/.test(cleanId)) {
            throw new Error('ObjectId must contain only hexadecimal characters');
        }
        
        // Extract first 8 characters (4 bytes) which represent the timestamp
        const timestampHex = cleanId.substring(0, 8);
        
        // Convert hex to decimal (Unix timestamp)
        const timestamp = parseInt(timestampHex, 16);
        
        // Convert to JavaScript Date
        const date = new Date(timestamp * 1000);
        
        return {
            success: true,
            timestamp: timestamp,
            date: date,
            iso: date.toISOString(),
            local: date.toLocaleString(),
            utc: date.toUTCString()
        };
        
    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
}

// Function to display the result
function displayResult(result) {
    if (result.success) {
        console.log('\n✅ Timestamp extracted successfully!');
        console.log('━'.repeat(50));
        console.log(`📅 Local Time:    ${result.local}`);
        console.log(`🌍 UTC Time:      ${result.utc}`);
        console.log(`📋 ISO Format:    ${result.iso}`);
        console.log(`⏰ Unix Timestamp: ${result.timestamp}`);
        console.log('━'.repeat(50));
    } else {
        console.log(`\n❌ Error: ${result.error}`);
    }
}

// Main interactive function
function askForObjectId() {
    console.log('\n🔍 MongoDB ObjectId Timestamp Extractor');
    console.log('━'.repeat(50));
    
    rl.question('Enter MongoDB ObjectId (or "exit" to quit): ', (input) => {
        const userInput = input.trim();
        
        // Check if user wants to exit
        if (userInput.toLowerCase() === 'exit' || userInput.toLowerCase() === 'quit') {
            console.log('\n👋 Goodbye!');
            rl.close();
            return;
        }
        
        // Check if input is empty
        if (!userInput) {
            console.log('\n⚠️  Please enter a valid ObjectId or "exit" to quit.');
            askForObjectId();
            return;
        }
        
        // Extract and display timestamp
        const result = extractTimestampFromObjectId(userInput);
        displayResult(result);
        
        // Ask again
        askForObjectId();
    });
}

// Start the program
console.log('🚀 Starting MongoDB ObjectId Timestamp Extractor...');
console.log('💡 Tip: ObjectIds are 24-character hexadecimal strings');
console.log('📝 Example: 507f1f77bcf86cd799439011');

askForObjectId();