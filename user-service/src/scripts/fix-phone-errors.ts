import mongoose from 'mongoose';
import UserModel from '../database/models/user.model';
import config from '../config'; // Assuming your DB URI is in config
import readline from 'readline';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// countryDialingCodesMap remains available but is not directly used by the updated normalization logic
const countryDialingCodesMap: { [key: string]: string } = {
    CM: '237', // Cameroon (Note: new logic uses 2376 specifically)
    BJ: '229', // Benin
    CG: '242', // Congo
    GH: '233', // Ghana
    CI: '225', // Cote d'Ivoire
    SN: '221', // Senegal
    TG: '228', // Togo
    BF: '226', // Burkina Faso
    GN: '224', // Guinea
    ML: '223', // Mali
    NE: '227', // Niger
    GA: '241', // Gabon
    CD: '243', // DRC
    KE: '254', // Kenya
    // Add other countries supported by your application
};

const askQuestion = (query: string): Promise<string> => {
    return new Promise(resolve => rl.question(query, resolve));
};

const manuallyNormalizePhoneNumber = (phoneNumber: string, countryCode?: string): string => {
    if (!phoneNumber) return '';

    console.log(`  [Manual Norm] Input: "${phoneNumber}", Country: ${countryCode || 'N/A'}`);
    const cleanedPhone = phoneNumber.replace(/\D/g, ''); // Remove all non-digits

    if (countryCode === 'CM') {
        // New Cameroonian format: 2376XXXXXXXX (12 digits total)
        const cameroonNewFormatRegex = /^2376\d{8}$/;

        if (cameroonNewFormatRegex.test(cleanedPhone)) {
            console.log(`  [Manual Norm CM] Phone "${cleanedPhone}" is already in the target 2376XXXXXXXX format.`);
            return cleanedPhone;
        }

        if (cleanedPhone.length >= 8) {
            const lastEightDigits = cleanedPhone.slice(-8);
            const normalizedPhone = `2376${lastEightDigits}`;
            console.log(`  [Manual Norm CM] Cleaned: "${cleanedPhone}", Extracted last 8: "${lastEightDigits}", Result: "${normalizedPhone}"`);
            return normalizedPhone;
        } else {
            console.warn(`  [Manual Norm CM] Cleaned phone "${cleanedPhone}" (length ${cleanedPhone.length}) has fewer than 8 digits. Cannot normalize to 2376XXXXXXXX. Returning cleaned version.`);
            return cleanedPhone;
        }
    } else {
        console.warn(`  [Manual Norm] Country is not 'CM' (country: ${countryCode || 'N/A'}). Returning cleaned phone: "${cleanedPhone}". Specific normalization rules for 2376XXXXXXXX not applied.`);
        return cleanedPhone;
    }
};

const fixProblematicPhoneNumbers = async (isDryRun: boolean) => {
    const BATCH_SIZE = 200;
    try {
        console.log(`Attempting to connect to MongoDB to fix phone errors... ${isDryRun ? "(DRY RUN)" : "(LIVE RUN)"}`);
        await mongoose.connect(config.mongodb.uri);
        console.log('MongoDB connected successfully.');

        const correctCameroonPhoneRegex = /^2376\d{8}$/;

        const usersToFix = await UserModel.find({
            country: 'CM',
            phoneNumber: {
                $ne: null,
                $nin: ['', undefined],
                $not: correctCameroonPhoneRegex
            }
        }).select('_id name phoneNumber country');

        console.log(`\nFound ${usersToFix.length} users in Cameroon whose phone numbers are targeted for processing (not matching ${correctCameroonPhoneRegex}).`);

        if (usersToFix.length === 0) {
            console.log('No users found to fix based on the criteria.');
            return;
        }

        let totalProcessedCounter = 0;
        let totalFixedCounter = 0;
        let totalUnchangedCounter = 0;
        let totalSkippedForDuplicateCounter = 0;
        let totalErrorCounter = 0;
        let operationsBatch: any[] = [];

        for (let i = 0; i < usersToFix.length; i++) {
            const user = usersToFix[i];
            const originalPhoneNumber = user.phoneNumber;
            totalProcessedCounter++;

            console.log(`\n(${totalProcessedCounter}/${usersToFix.length}) Processing User ID: ${user._id}, Name: ${user.name || 'N/A'}`);
            console.log(`  Original Phone: "${originalPhoneNumber}", Country: ${user.country}`);

            if (!originalPhoneNumber) {
                console.log("  Skipping user with null/empty original phone number.");
                totalUnchangedCounter++;
                continue;
            }

            const normalizedPhoneNumber = manuallyNormalizePhoneNumber(originalPhoneNumber, user.country);
            console.log(`  Intended normalized phone: "${normalizedPhoneNumber}"`);

            if (originalPhoneNumber === normalizedPhoneNumber) {
                console.log(`  Phone UNCHANGED (normalization resulted in the same string, or it was too short/unsuitable for CM normalization): "${originalPhoneNumber}"`);
                totalUnchangedCounter++;
            } else {
                // If normalization produced a different string, it's a candidate for update.
                if (isDryRun) {
                    // Simulate duplicate check for dry run
                    const existingUserWithNormalizedPhone = await UserModel.findOne({
                        phoneNumber: normalizedPhoneNumber,
                        _id: { $ne: user._id }
                    }).lean(); // Use .lean() for reads
                    if (existingUserWithNormalizedPhone) {
                        console.log(`  [DRY RUN] Would SKIP update: Normalized phone "${normalizedPhoneNumber}" already exists for user ${existingUserWithNormalizedPhone._id}.`);
                        totalSkippedForDuplicateCounter++;
                    } else {
                        console.log(`  [DRY RUN] Would change phone from "${originalPhoneNumber}" to "${normalizedPhoneNumber}"`);
                    }
                } else {
                    // LIVE RUN: Check for duplicates before adding to batch
                    const existingUserWithNormalizedPhone = await UserModel.findOne({
                        phoneNumber: normalizedPhoneNumber,
                        _id: { $ne: user._id }
                    });

                    if (existingUserWithNormalizedPhone) {
                        console.log(`  SKIPPING update: Normalized phone "${normalizedPhoneNumber}" already exists for user ${existingUserWithNormalizedPhone._id} (Name: ${existingUserWithNormalizedPhone.name}).`);
                        totalSkippedForDuplicateCounter++;
                    } else {
                        operationsBatch.push({
                            updateOne: {
                                filter: { _id: user._id },
                                update: { $set: { phoneNumber: normalizedPhoneNumber } }
                            }
                        });
                    }
                }
            }

            if (!isDryRun && (operationsBatch.length === BATCH_SIZE || i === usersToFix.length - 1)) {
                if (operationsBatch.length > 0) {
                    console.log(`  Executing batch of ${operationsBatch.length} update operations...`);
                    try {
                        const result = await UserModel.bulkWrite(operationsBatch);
                        const modifiedCount = result.modifiedCount || 0;
                        console.log(`  Batch executed. Modified: ${modifiedCount}`);
                        totalFixedCounter += modifiedCount;

                        if (modifiedCount < operationsBatch.length) {
                            totalUnchangedCounter += (operationsBatch.length - modifiedCount);
                            console.log(`  ${operationsBatch.length - modifiedCount} operations in batch resulted in no change at DB level (or were duplicates caught by DB).`);
                        }
                    } catch (batchError: any) {
                        console.error(`  Error executing batch: ${batchError.message}`);
                        // Check for duplicate key error in batch and count them as skipped/errors
                        if (batchError.code === 11000) { // MongoDB duplicate key error code
                            console.warn(`  Batch failed due to duplicate key. Some numbers in the batch might be duplicates not caught by pre-check.`);
                            // It's hard to know exactly how many in the batch caused it without parsing writeErrors
                            // For simplicity, we'll count the whole batch as errors/skipped here, review logs for details
                            totalErrorCounter += operationsBatch.length; // Or add to a specific duplicate error counter for batches
                        } else {
                            totalErrorCounter += operationsBatch.length;
                        }
                    }
                    operationsBatch = [];
                }
            }
        }

        console.log("\n--- Run Summary ---");
        console.log(`Total users queried for potential fixing: ${usersToFix.length}`);
        console.log(`Total processed in script loop: ${totalProcessedCounter}`);
        if (isDryRun) {
            console.log("DRY RUN Complete. Review logs for intended changes. No actual data was modified.");
            console.log(`  Would be skipped due to potential duplicate: ${totalSkippedForDuplicateCounter}`);
        } else {
            console.log(`Successfully fixed (DB modified): ${totalFixedCounter}`);
            console.log(`Skipped due to existing duplicate normalized number: ${totalSkippedForDuplicateCounter}`);
            console.log(`Remained unchanged/not requiring update/failed to normalize as expected: ${totalUnchangedCounter}`);
            console.log(`Failed to save (errors during batch, incl. potential batch duplicates): ${totalErrorCounter}`);
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
    console.log("This script will identify and fix phone numbers for users with country 'CM'.");
    console.log("It normalizes numbers to the '2376XXXXXXXX' format.");
    console.log("The definition of a 'correct' number for querying is /^2376\\d{8}$/.");

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
            rl.close();
        }
    }
};

main();