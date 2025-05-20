import mongoose from 'mongoose';
import UserModel from '../database/models/user.model';
import config from '../config'; // Assuming your DB URI is in config
import readline from 'readline';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const askQuestion = (query: string): Promise<string> => {
    return new Promise(resolve => rl.question(query, resolve));
};

const fixProblematicPhoneNumbers = async (isDryRun: boolean) => {
    try {
        console.log(`Attempting to connect to MongoDB to fix phone errors... ${isDryRun ? "(DRY RUN)" : "(LIVE RUN)"}`);
        await mongoose.connect(config.mongodb.uri);
        console.log('MongoDB connected successfully.');

        const correctCameroonPhoneRegex = /^237\d{9}$/;

        // Find users to fix (same query as the find script)
        const usersToFix = await UserModel.find({
            country: 'CM',
            phoneNumber: {
                $ne: null,
                $nin: ['', undefined],
                $not: correctCameroonPhoneRegex
            }
        }); // Not using .lean() because we need to call .save()

        console.log(`\nFound ${usersToFix.length} users in Cameroon whose phone numbers are targeted for processing.`);

        if (usersToFix.length === 0) {
            console.log('No users found to fix based on the criteria.');
            return;
        }

        let processedCount = 0;
        let fixedCount = 0;
        let unchangedCount = 0;
        let errorCount = 0;

        for (const user of usersToFix) {
            const originalPhoneNumber = user.phoneNumber;
            processedCount++;
            console.log(`\n(${processedCount}/${usersToFix.length}) Processing User ID: ${user._id}, Name: ${user.name || 'N/A'}`);
            console.log(`  Original Phone: "${originalPhoneNumber}", Country: ${user.country}`);

            if (!originalPhoneNumber) {
                console.log("  Skipping user with null/empty original phone number (should have been filtered by query).");
                continue;
            }

            if (isDryRun) {
                console.log(`  [DRY RUN] Would attempt to re-save user to trigger phone normalization.`);
                // In a dry run, we can't perfectly simulate the pre-save hook without complex logic replication.
                // We are showing the original and relying on user to know the hook's expected behavior.
            } else {
                try {
                    // Re-assign the phone number to itself. This marks the path as 'modified' internally
                    // if the actual value would change after the pre-save hook logic, or simply ensures
                    // the pre-save hook's `isModified('phoneNumber')` check considers it.
                    user.phoneNumber = originalPhoneNumber;

                    await user.save(); // This will trigger the pre-save hook in user.model.ts

                    if (user.phoneNumber === originalPhoneNumber) {
                        console.log(`  Phone UNCHANGED: "${user.phoneNumber}" (Pre-save hook resulted in the same number or deemed it unalterable to target format)`);
                        unchangedCount++;
                    } else {
                        console.log(`  Phone FIXED: From "${originalPhoneNumber}" To "${user.phoneNumber}"`);
                        fixedCount++;
                    }
                } catch (err: any) {
                    console.error(`  Error fixing phone for user ${user._id}: ${err.message}`);
                    errorCount++;
                }
            }
        }

        console.log("\n--- Run Summary ---");
        if (isDryRun) {
            console.log(`${usersToFix.length} users were identified for potential fixing.`);
            console.log("To see the actual changes, run in LIVE mode.");
        } else {
            console.log(`Total processed: ${usersToFix.length}`);
            console.log(`Successfully fixed: ${fixedCount}`);
            console.log(`Remained unchanged: ${unchangedCount}`);
            console.log(`Failed to fix (errors): ${errorCount}`);
        }

    } catch (error) {
        console.error('\nError in fixProblematicPhoneNumbers script:');
        if (error instanceof Error && error.message.includes('querySrv ENOTFOUND')) {
            console.error('MongoDB connection error: Could not resolve SRV record. Check your database URL and network connection.');
        } else {
            console.error(error);
        }
    } finally {
        if (mongoose.connection.readyState === 1) {
            await mongoose.disconnect();
            console.log('\nMongoDB disconnected.');
        }
        rl.close();
    }
};

const main = async () => {
    console.log("This script will identify and potentially fix phone numbers for users with country 'CM'.");
    console.log("It relies on the pre-save hook in your User model to perform the normalization.");

    const mode = await askQuestion("Run in (D)RY RUN or (L)IVE mode? (D/L, default D): ");
    const isDryRun = mode.toUpperCase() !== 'L';

    if (isDryRun) {
        console.log("\nStarting DRY RUN...");
        await fixProblematicPhoneNumbers(true);
    } else {
        console.log("\nStarting LIVE RUN...");
        const confirmation = await askQuestion("WARNING: This will modify data in the database. Are you sure you want to proceed with a LIVE run? (yes/no): ");
        if (confirmation.toLowerCase() === 'yes') {
            await fixProblematicPhoneNumbers(false);
        } else {
            console.log("LIVE run aborted by user.");
            rl.close(); // Ensure readline is closed if aborted early
        }
    }
};

main(); 