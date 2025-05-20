import mongoose from 'mongoose';
import UserModel from '../database/models/user.model';
import config from '../config';
import readline from 'readline';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Shared map, ensure it's consistent with your models/other scripts
const countryDialingCodesMap: { [key: string]: string } = {
    CM: '237', BJ: '229', CG: '242', GH: '233', CI: '225', SN: '221', TG: '228', BF: '226',
    GN: '224', ML: '223', NE: '227', GA: '241', CD: '243', KE: '254',
    // Add all other relevant countries from your user.model.ts or system
    DZ: '213', AO: '244', BW: '267', BI: '257', CV: '238', CF: '236', TD: '235', KM: '269',
    DJ: '253', EG: '20', GQ: '240', ER: '291', SZ: '268', ET: '251', GM: '220', GW: '245',
    LS: '266', LR: '231', LY: '218', MG: '261', MW: '265', MR: '222', MU: '230', MA: '212',
    MZ: '258', NA: '264', NG: '234', RW: '250', ST: '239', SC: '248', SL: '232', SO: '252',
    ZA: '27', SS: '211', SD: '249', TZ: '255', TN: '216', UG: '256', ZM: '260', ZW: '263'
};

const askQuestion = (query: string): Promise<string> => {
    return new Promise(resolve => rl.question(query, resolve));
};

const normalizePhoneNumberGeneral = (phoneNumber: string, userCountry?: string): string => {
    if (!phoneNumber || typeof phoneNumber !== 'string') {
        // console.log('  [Norm Gen] Invalid or empty phone number input.');
        return ''; // Return empty for invalid inputs
    }

    let cleanedPhone = phoneNumber.replace(/\D/g, ''); // 1. Remove all non-digits
    // console.log(`  [Norm Gen] Original: "${phoneNumber}", Cleaned (digits only): "${cleanedPhone}"`);

    const countryUpper = userCountry?.toUpperCase();
    const dialingCode = countryUpper ? countryDialingCodesMap[countryUpper] : null;

    if (dialingCode) {
        // console.log(`  [Norm Gen] User country: ${countryUpper}, Dialing code: ${dialingCode}`);
        const doubleDialingCode = dialingCode + dialingCode;
        if (cleanedPhone.startsWith(doubleDialingCode)) {
            const previousCleaned = cleanedPhone;
            cleanedPhone = cleanedPhone.substring(dialingCode.length); // Remove first instance of dialing code
            console.log(`  [Norm Gen] Removed duplicate prefix for ${countryUpper}. Was: "${previousCleaned}", Now: "${cleanedPhone}"`);
        }
    } else {
        // console.log(`  [Norm Gen] No dialing code found for country: "${userCountry || 'N/A'}". Using cleaned phone as is.`);
    }
    return cleanedPhone;
};

const processAllUserPhones = async (isDryRun: boolean) => {
    const PAGE_SIZE = 1000; // How many users to fetch and process in memory at a time
    const BATCH_WRITE_SIZE = 500; // How many update operations to send in one bulkWrite
    let currentPage = 0;
    let totalUsersProcessed = 0;
    let totalUsersModifiedInDb = 0;
    let totalOperationsBatched = 0;
    let totalPotentialModifications = 0; // In dry run, count of numbers that would be changed
    let individualErrors = 0;
    let userMapForBatchErrors: { [key: number]: string } = {}; // To map batch index to userId

    try {
        console.log(`Starting phone normalization script for ALL users... ${isDryRun ? "(DRY RUN)" : "(LIVE RUN)"}`);
        await mongoose.connect(config.mongodb.uri);
        console.log('MongoDB connected successfully.');

        let operationsBatch: any[] = [];

        // eslint-disable-next-line no-constant-condition
        while (true) {
            console.log(`Fetching page ${currentPage + 1} (size ${PAGE_SIZE})...`);
            const users = await UserModel.find()
                .select('_id phoneNumber country name') // Select only necessary fields
                .sort({ _id: 1 }) // Consistent ordering for pagination
                .skip(currentPage * PAGE_SIZE)
                .limit(PAGE_SIZE)
                .exec(); // No .lean() if we were to call .save() individually, but for bulkWrite it's fine.
            // However, keeping it as full documents is safer if any instance methods were hypothetically involved pre-normalization.

            if (users.length === 0) {
                console.log("No more users found to process.");
                break; // Exit loop if no more users
            }

            console.log(`Processing ${users.length} users from page ${currentPage + 1}...`);

            for (let i = 0; i < users.length; i++) {
                const user = users[i];
                totalUsersProcessed++;

                const originalPhoneNumber = user.phoneNumber;
                const normalizedPhoneNumber = normalizePhoneNumberGeneral(originalPhoneNumber, user.country);

                if (originalPhoneNumber !== normalizedPhoneNumber) {
                    if (isDryRun) {
                        console.log(`  [DRY RUN] User ID: ${user._id} (Name: ${user.name || 'N/A'})`);
                        console.log(`    Original Phone: "${originalPhoneNumber}", Country: "${user.country || 'N/A'}"`);
                        console.log(`    Normalized to:  "${normalizedPhoneNumber}"`);
                        totalPotentialModifications++;
                    } else {
                        userMapForBatchErrors[operationsBatch.length] = user._id.toString(); // Store _id before adding to batch
                        operationsBatch.push({
                            updateOne: {
                                filter: { _id: user._id },
                                update: { $set: { phoneNumber: normalizedPhoneNumber } }
                            }
                        });
                        totalOperationsBatched++;
                    }
                }

                // If batch is full, process it (for live run)
                if (!isDryRun && operationsBatch.length >= BATCH_WRITE_SIZE) {
                    console.log(`  Executing batch of ${operationsBatch.length} update operations...`);
                    try {
                        const result = await UserModel.bulkWrite(operationsBatch, { ordered: false });
                        totalUsersModifiedInDb += result.modifiedCount || 0;
                        if (result.hasWriteErrors()) {
                            console.warn(`  WARNING: ${result.getWriteErrorCount()} write error(s) in batch.`);
                            for (const err of result.getWriteErrors()) {
                                const failedUserId = userMapForBatchErrors[err.index] || 'Unknown User (index mapping failed)';
                                console.error(`    Error for User ID ${failedUserId} (Op Index: ${err.index}): Code ${err.code}, Msg: ${err.errmsg?.substring(0, 100)}...`);
                                individualErrors++;
                            }
                        }
                    } catch (batchError: any) {
                        console.error(`  FATAL BATCH ERROR: ${batchError.message}. Operations in this batch might not have been fully processed or reported.`);
                        individualErrors += operationsBatch.length; // Assume all in batch failed if bulkWrite itself throws an unexpected error
                    }
                    operationsBatch = [];
                    userMapForBatchErrors = {};
                }
            }
            currentPage++;
        }

        // Process any remaining operations in the last batch (for live run)
        if (!isDryRun && operationsBatch.length > 0) {
            console.log(`  Executing final batch of ${operationsBatch.length} update operations...`);
            try {
                const result = await UserModel.bulkWrite(operationsBatch, { ordered: false });
                totalUsersModifiedInDb += result.modifiedCount || 0;
                if (result.hasWriteErrors()) {
                    console.warn(`  WARNING: ${result.getWriteErrorCount()} write error(s) in final batch.`);
                    for (const err of result.getWriteErrors()) {
                        const failedUserId = userMapForBatchErrors[err.index] || 'Unknown User (index mapping failed)';
                        console.error(`    Error for User ID ${failedUserId} (Op Index: ${err.index}): Code ${err.code}, Msg: ${err.errmsg?.substring(0, 100)}...`);
                        individualErrors++;
                    }
                }
            } catch (batchError: any) {
                console.error(`  FATAL FINAL BATCH ERROR: ${batchError.message}.`);
                individualErrors += operationsBatch.length;
            }
            operationsBatch = [];
            userMapForBatchErrors = {};
        }

        console.log("\n--- Script Execution Summary ---");
        console.log(`Total users scanned from DB (in pages): ${totalUsersProcessed}`);
        if (isDryRun) {
            console.log(`DRY RUN Complete. Potential modifications: ${totalPotentialModifications}`);
        } else {
            console.log(`Total operations batched for update: ${totalOperationsBatched}`);
            console.log(`Total users successfully modified in DB: ${totalUsersModifiedInDb}`);
            console.log(`Total individual write errors encountered: ${individualErrors}`);
            if (totalOperationsBatched > totalUsersModifiedInDb + individualErrors) {
                console.warn(`  Note: There's a discrepancy. Batched: ${totalOperationsBatched}, Modified: ${totalUsersModifiedInDb}, Errors: ${individualErrors}. Some ops might not have resulted in modification or errors weren't fully captured.`);
            }
        }

    } catch (error: any) {
        console.error('\nUnhandled error in processAllUserPhones script:');
        if (error.message?.includes('querySrv ENOTFOUND') || error.message?.includes('ECONNREFUSED')) {
            console.error('MongoDB connection error. Check your database URL and network connection.');
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
    console.log("This script will process all users to:");
    console.log("1. Remove any non-digit characters from their phone numbers.");
    console.log("2. Remove a duplicated country dialing code from the beginning of the cleaned number if present.");

    const mode = await askQuestion("Run in (D)RY RUN or (L)IVE mode? (D/L, default D): ");
    const isDryRun = mode.toUpperCase() !== 'L';

    if (isDryRun) {
        console.log("\nStarting DRY RUN...");
        await processAllUserPhones(true);
    } else {
        console.log("\nStarting LIVE RUN...");
        const confirmation = await askQuestion("WARNING: This will modify data in the database for ALL users. Are you sure? (yes/no): ");
        if (confirmation.toLowerCase() === 'yes') {
            await processAllUserPhones(false);
        } else {
            console.log("LIVE run aborted by user.");
            rl.close();
        }
    }
};

main(); 