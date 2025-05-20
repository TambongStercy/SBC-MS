import mongoose from 'mongoose';
import UserModel from '../database/models/user.model'; // Adjust path as needed
import config from '../config'; // Assuming your DB URI is in config
import readline from 'readline';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

interface CountryPhoneRule {
    name: string;
    dialingCode: string;
    nsnRequiredPrefix: string; // Still useful as a "common" or "default" prefix if constructing from minimal digits, or if ignoreNsnPrefixValidation is false
    nsnTotalLength: number;
    ignoreNsnPrefixValidation?: boolean; // If true, nsnRequiredPrefix is not strictly enforced for validation
}

const countryPhoneRules: { [countryCode: string]: CountryPhoneRule } = {
    TG: {
        name: "Togo",
        dialingCode: '228',
        nsnRequiredPrefix: '9', // Enforces NSN starts with '9'
        nsnTotalLength: 8,
        ignoreNsnPrefixValidation: false // Default behavior
    },
    CG: {
        name: "Congo (Brazzaville)",
        dialingCode: '242',
        nsnRequiredPrefix: '0', // Enforces NSN starts with '0' (e.g., 01, 05, 06)
        nsnTotalLength: 9
    },
    CD: {
        name: "Congo (DRC)",
        dialingCode: '243',
        nsnRequiredPrefix: '8', // Enforces NSN starts with '8' (e.g., 81, 82, 89)
        nsnTotalLength: 9       // If DRC numbers can also start with 9xxxxx... and you want to allow BOTH, set ignoreNsnPrefixValidation: true
    },
    GH: {
        name: "Ghana",
        dialingCode: '233',
        nsnRequiredPrefix: '',   // Not strictly enforced due to flag below. Could be '2' or '5' as common examples.
        nsnTotalLength: 9,       // Ghanaian NSN is 9 digits (e.g., 20xxxxxxx, 54xxxxxxx)
        ignoreNsnPrefixValidation: true // Allows any 9 digits after 233
    },
    BJ: {
        name: "Benin",
        dialingCode: '229',
        nsnRequiredPrefix: '9', // Example: enforce '9'
        nsnTotalLength: 8
    },
    BF: {
        name: "Burkina Faso",
        dialingCode: '226',
        nsnRequiredPrefix: '7', // Example: enforce '7'
        nsnTotalLength: 8
    },
    CI: {
        name: "Cote d'Ivoire",
        dialingCode: '225',
        nsnRequiredPrefix: '07', // Example: enforce '07' (Orange-like numbers)
        nsnTotalLength: 10       // NSN is 10 digits (e.g., 07xxxxxxxx)
    },
    CM: { // Example from previous script, now with explicit ignoreNsnPrefixValidation: false
        name: "Cameroon",
        dialingCode: '237',
        nsnRequiredPrefix: '6',
        nsnTotalLength: 9, // 237 + 6XXXXXXXX (9 digits NSN)
        ignoreNsnPrefixValidation: false
    }
};

const askQuestion = (query: string): Promise<string> => {
    return new Promise(resolve => rl.question(query, resolve));
};

const normalizePhoneNumberByRule = (phoneNumber: string, rule: CountryPhoneRule): string => {
    if (!phoneNumber) return '';

    const { name, dialingCode, nsnRequiredPrefix, nsnTotalLength, ignoreNsnPrefixValidation } = rule;
    console.log(`  [Norm "${name}"] Input: "${phoneNumber}"`);
    let cleanedPhone = phoneNumber.replace(/\D/g, '');

    if (ignoreNsnPrefixValidation) {
        // Goal: dialingCode + nsnTotalLength digits. No specific NSN prefix enforced from rule.
        const correctFormatRegex = new RegExp(`^${dialingCode}\\d{${nsnTotalLength}}$`);
        if (correctFormatRegex.test(cleanedPhone)) {
            console.log(`  [Norm "${name}" FlexPrefix] Cleaned phone "${cleanedPhone}" already matches target format ${correctFormatRegex.source}.`);
            return cleanedPhone;
        }

        let nationalPart = cleanedPhone;
        if (cleanedPhone.startsWith(dialingCode)) {
            // Input might be like 233024... or 23324...
            nationalPart = cleanedPhone.substring(dialingCode.length);
            console.log(`  [Norm "${name}" FlexPrefix] Stripped dialing code, national part for suffix extraction: "${nationalPart}"`);
        }
        // Now, nationalPart is what remains (or the whole string if no dialing code was prefixed in input)
        // We need to ensure it provides nsnTotalLength digits for the NSN.

        if (nationalPart.length >= nsnTotalLength) {
            const relevantNationalDigits = nationalPart.slice(-nsnTotalLength);
            const normalizedPhone = `${dialingCode}${relevantNationalDigits}`;
            console.log(`  [Norm "${name}" FlexPrefix] Extracted NSN: "${relevantNationalDigits}", Result: "${normalizedPhone}"`);
            return normalizedPhone;
        } else {
            console.warn(`  [Norm "${name}" FlexPrefix] National part "${nationalPart}" (length ${nationalPart.length}) is shorter than required nsnTotalLength ${nsnTotalLength}. Returning cleaned full input: "${cleanedPhone}".`);
            return cleanedPhone; // Return cleaned input if too short to form a valid number
        }
    } else {
        // Original logic: enforce nsnRequiredPrefix from rule
        const numDigitsForSuffix = nsnTotalLength - (nsnRequiredPrefix ? nsnRequiredPrefix.length : 0);
        if (numDigitsForSuffix < 0) {
            console.error(`  [Norm "${name}" StrictPrefix] Invalid rule: nsnRequiredPrefix "${nsnRequiredPrefix}" is longer than nsnTotalLength ${nsnTotalLength}.`);
            return cleanedPhone;
        }

        const correctFormatRegex = new RegExp(`^${dialingCode}${nsnRequiredPrefix}\\d{${numDigitsForSuffix}}$`);
        if (correctFormatRegex.test(cleanedPhone)) {
            console.log(`  [Norm "${name}" StrictPrefix] Cleaned phone "${cleanedPhone}" already matches target format ${correctFormatRegex.source}.`);
            return cleanedPhone;
        }

        // Attempt to construct: dialingCode + nsnRequiredPrefix + (last numDigitsForSuffix from cleanedPhone)
        if (cleanedPhone.length >= numDigitsForSuffix) {
            const suffix = cleanedPhone.slice(-numDigitsForSuffix);
            const normalizedPhone = `${dialingCode}${nsnRequiredPrefix}${suffix}`;
            console.log(`  [Norm "${name}" StrictPrefix] Cleaned: "${cleanedPhone}", Extracted suffix for prefix: "${suffix}", Result: "${normalizedPhone}"`);
            return normalizedPhone;
        } else {
            console.warn(`  [Norm "${name}" StrictPrefix] Cleaned phone "${cleanedPhone}" (length ${cleanedPhone.length}) is too short to extract ${numDigitsForSuffix} suffix digits for prefix rule. Returning cleaned version.`);
            return cleanedPhone;
        }
    }
};


const fixProblematicPhoneNumbersMultiCountry = async (isDryRun: boolean, targetCountries: string[]) => {
    const BATCH_SIZE = 200;
    let grandTotalProcessedCounter = 0;
    let grandTotalFixedCounter = 0;
    let grandTotalUnchangedCounter = 0;
    let grandTotalErrorCounter = 0;

    try {
        console.log(`Attempting to connect to MongoDB... ${isDryRun ? "(DRY RUN)" : "(LIVE RUN)"}`);
        await mongoose.connect(config.mongodb.uri);
        console.log('MongoDB connected successfully.');

        for (const countryCode of targetCountries) {
            const rule = countryPhoneRules[countryCode];
            if (!rule) {
                console.warn(`\nNo rule defined for country code: ${countryCode}. Skipping.`);
                continue;
            }

            console.log(`\n--- Processing Country: ${rule.name} (${countryCode}) ---`);
            const { dialingCode, nsnRequiredPrefix, nsnTotalLength, ignoreNsnPrefixValidation } = rule;

            let correctFormatRegexPattern: string;
            let currentCorrectFormatRegex: RegExp;

            if (ignoreNsnPrefixValidation) {
                correctFormatRegexPattern = `^${dialingCode}\\d{${nsnTotalLength}}$`;
            } else {
                const numDigitsForSuffix = nsnTotalLength - (nsnRequiredPrefix ? nsnRequiredPrefix.length : 0);
                if (numDigitsForSuffix < 0) {
                    console.error(`  Skipping ${rule.name} due to invalid rule: nsnRequiredPrefix "${nsnRequiredPrefix}" is longer than nsnTotalLength ${nsnTotalLength}.`);
                    continue;
                }
                correctFormatRegexPattern = `^${dialingCode}${nsnRequiredPrefix}\\d{${numDigitsForSuffix}}$`;
            }
            currentCorrectFormatRegex = new RegExp(correctFormatRegexPattern);

            const usersToFix = await UserModel.find({
                country: countryCode,
                phoneNumber: {
                    $ne: null,
                    $nin: ['', undefined],
                    $not: currentCorrectFormatRegex
                }
            }).select('_id name phoneNumber country');

            console.log(`Found ${usersToFix.length} users in ${rule.name} whose phone numbers are targeted (not matching ${currentCorrectFormatRegex.source}).`);

            if (usersToFix.length === 0) {
                console.log(`No users to fix in ${rule.name} based on the criteria.`);
                continue;
            }

            let operationsBatch: any[] = [];
            let countryProcessedCounter = 0;
            let countryFixedCounter = 0;
            let countryUnchangedCounter = 0;
            let countryErrorCounter = 0;

            for (let i = 0; i < usersToFix.length; i++) {
                const user = usersToFix[i];
                const originalPhoneNumber = user.phoneNumber;
                grandTotalProcessedCounter++;
                countryProcessedCounter++;

                console.log(`\n(${countryProcessedCounter}/${usersToFix.length}) Processing User ID: ${user._id}, Name: ${user.name || 'N/A'}`);
                console.log(`  Original Phone: "${originalPhoneNumber}", Country: ${user.country}`);

                if (!originalPhoneNumber) {
                    console.log("  Skipping user with null/empty original phone number.");
                    grandTotalUnchangedCounter++;
                    countryUnchangedCounter++;
                    continue;
                }

                const normalizedPhoneNumber = normalizePhoneNumberByRule(originalPhoneNumber, rule);
                console.log(`  Intended normalized phone for ${rule.name}: "${normalizedPhoneNumber}"`);

                if (originalPhoneNumber === normalizedPhoneNumber) {
                    console.log(`  Phone UNCHANGED (already in desired format or normalization resulted in same string): "${originalPhoneNumber}"`);
                    grandTotalUnchangedCounter++;
                    countryUnchangedCounter++;
                } else {
                    if (isDryRun) {
                        console.log(`  [DRY RUN] Would change phone from "${originalPhoneNumber}" to "${normalizedPhoneNumber}" for ${rule.name}`);
                    } else {
                        operationsBatch.push({
                            updateOne: {
                                filter: { _id: user._id },
                                update: { $set: { phoneNumber: normalizedPhoneNumber } }
                            }
                        });
                    }
                }

                if (!isDryRun && (operationsBatch.length === BATCH_SIZE || i === usersToFix.length - 1)) {
                    if (operationsBatch.length > 0) {
                        console.log(`  Executing batch of ${operationsBatch.length} update operations for ${rule.name}...`);
                        try {
                            const result = await UserModel.bulkWrite(operationsBatch);
                            const modifiedCount = result.modifiedCount || 0;
                            console.log(`  Batch executed for ${rule.name}. Modified: ${modifiedCount}`);
                            grandTotalFixedCounter += modifiedCount;
                            countryFixedCounter += modifiedCount;
                            if (modifiedCount < operationsBatch.length) {
                                const notModifiedInBatch = operationsBatch.length - modifiedCount;
                                grandTotalUnchangedCounter += notModifiedInBatch;
                                countryUnchangedCounter += notModifiedInBatch;
                                console.log(`  ${notModifiedInBatch} operations in batch resulted in no DB change for ${rule.name}.`);
                            }
                        } catch (batchError: any) {
                            console.error(`  Error executing batch for ${rule.name}: ${batchError.message}`);
                            const failedInBatch = operationsBatch.length;
                            grandTotalErrorCounter += failedInBatch;
                            countryErrorCounter += failedInBatch;
                        }
                        operationsBatch = [];
                    }
                }
            }
            console.log(`\n--- Summary for ${rule.name} (${countryCode}) ---`);
            console.log(`Total users queried for ${rule.name}: ${usersToFix.length}`);
            console.log(`Processed in script loop for ${rule.name}: ${countryProcessedCounter}`);
            if (!isDryRun) {
                console.log(`Successfully fixed for ${rule.name}: ${countryFixedCounter}`);
                console.log(`Unchanged/already correct/not updated for ${rule.name}: ${countryUnchangedCounter}`);
                console.log(`Failed to save for ${rule.name}: ${countryErrorCounter}`);
            }
        }

        console.log("\n--- GRAND TOTAL RUN SUMMARY ---");
        console.log(`Total countries processed: ${targetCountries.length}`);
        console.log(`Total users processed across all countries: ${grandTotalProcessedCounter}`);
        if (isDryRun) {
            console.log("DRY RUN Complete. Review logs for intended changes. No actual data was modified.");
        } else {
            console.log(`Total successfully fixed (DB modified): ${grandTotalFixedCounter}`);
            console.log(`Total remained unchanged/already correct/not updated: ${grandTotalUnchangedCounter}`);
            console.log(`Total failed to save (errors during batch): ${grandTotalErrorCounter}`);
        }

    } catch (error) {
        console.error('\nError in fixProblematicPhoneNumbersMultiCountry script:');
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
    console.log("This script will identify and fix phone numbers for multiple specified countries.");
    console.log("It uses predefined rules for normalization (dialing code, NSN prefix, NSN length).");
    console.log("Set 'ignoreNsnPrefixValidation: true' in a rule to skip NSN prefix enforcement for that country.");
    console.log("Ensure `countryPhoneRules` are correctly defined for your needs.");

    const definedCountries = Object.keys(countryPhoneRules);
    console.log("\nAvailable country configurations:", definedCountries.map(c => `${c} (${countryPhoneRules[c].ignoreNsnPrefixValidation ? 'Flex Prefix' : 'Strict Prefix'})`).join(', '));

    let countriesToProcessInput = await askQuestion(`Enter country codes to process, comma-separated (e.g., TG,GH), or 'ALL' for all defined (default ALL): `);
    if (!countriesToProcessInput || countriesToProcessInput.toUpperCase() === 'ALL') {
        countriesToProcessInput = definedCountries.join(',');
    }
    const targetCountries = countriesToProcessInput.split(',').map(c => c.trim().toUpperCase()).filter(c => definedCountries.includes(c));

    if (targetCountries.length === 0) {
        console.log("No valid country codes selected for processing. Exiting.");
        rl.close();
        return;
    }
    console.log("Will process numbers for:", targetCountries.join(', '));

    const mode = await askQuestion("Run in (D)RY RUN or (L)IVE mode? (D/L, default D): ");
    const isDryRun = mode.toUpperCase() !== 'L';

    if (isDryRun) {
        console.log("\nStarting DRY RUN...");
        await fixProblematicPhoneNumbersMultiCountry(true, targetCountries);
    } else {
        console.log("\nStarting LIVE RUN...");
        const confirmation = await askQuestion("WARNING: This will modify data in the database. Are you sure you want to proceed with a LIVE run? (yes/no): ");
        if (confirmation.toLowerCase() === 'yes') {
            await fixProblematicPhoneNumbersMultiCountry(false, targetCountries);
        } else {
            console.log("LIVE run aborted by user.");
            rl.close();
        }
    }
};

main();