import mongoose from 'mongoose';
import UserModel from '../database/models/user.model'; // Adjust path as needed
import config from '../config'; // Adjust path to your config to get DB URI

// Helper function to generate a new unique referral code (ensure it's lowercase)
async function generateNewUniqueReferralCode(): Promise<string> {
    let newCode: string;
    let isUnique = false;
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    do {
        newCode = '';
        for (let i = 0; i < 6; i++) { // Generate a 6-character code
            newCode += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        // Check if this new code already exists (case-sensitive check, as it's already lowercase)
        const existingUser = await UserModel.findOne({ referralCode: newCode }).exec();
        if (!existingUser) {
            isUnique = true;
        }
    } while (!isUnique);
    return newCode;
}

async function runScript() {
    try {
        console.log("Connecting to MongoDB...");
        await mongoose.connect(config.mongodb.uri, config.mongodb.options);
        console.log("Successfully connected to MongoDB.");

        // --- Step 1: Finding and resolving case-insensitive duplicate referral codes ---
        console.log("\nStep 1: Finding and resolving case-insensitive duplicate referral codes...");

        const caseInsensitiveDuplicateAgg = [
            {
                $match: {
                    referralCode: { $exists: true, $nin: [null, ""] }
                }
            },
            {
                $group: {
                    _id: { $toLower: "$referralCode" }, // Group by lowercased referral code
                    users: {
                        $push: {
                            _id: "$_id",
                            originalReferralCode: "$referralCode"
                        }
                    },
                    count: { $sum: 1 }
                }
            },
            {
                $match: {
                    count: { $gt: 1 } // Find codes used by more than one user (case-insensitively)
                }
            }
        ];

        const caseInsensitiveDuplicates = await UserModel.aggregate(caseInsensitiveDuplicateAgg).exec();
        let resolvedDuplicateUserCount = 0;

        if (caseInsensitiveDuplicates.length === 0) {
            console.log("No case-insensitive duplicate referral codes found.");
        } else {
            console.log(`Found ${caseInsensitiveDuplicates.length} case-insensitive duplicate groups. Resolving...`);
            for (const dupGroup of caseInsensitiveDuplicates) {
                console.log(`Resolving duplicates for lowercased code: "${dupGroup._id}" used by ${dupGroup.count} users.`);
                // Keep the original code for the first user (it will be lowercased in Step 2)
                // Assign new codes to the rest of the users in this group
                const usersToAssignNewCode = dupGroup.users.slice(1);

                for (const userInfo of usersToAssignNewCode) {
                    const newUniqueCode = await generateNewUniqueReferralCode(); // Already lowercase
                    await UserModel.updateOne(
                        { _id: userInfo._id },
                        { $set: { referralCode: newUniqueCode } }
                    ).exec();
                    console.log(`  - User ${userInfo._id} (original code: "${userInfo.originalReferralCode}") assigned new code: ${newUniqueCode}`);
                    resolvedDuplicateUserCount++;
                }
            }
            console.log(`Resolved duplicates for ${resolvedDuplicateUserCount} users by assigning new codes.`);
        }
        console.log("Step 1 finished.");
        console.log("--------------------");

        // --- Step 2: Lowercasing all referral codes in the database ---
        console.log("\nStep 2: Lowercasing all referral codes in the database...");
        const result = await UserModel.updateMany(
            { referralCode: { $exists: true, $nin: [null, ""] } },
            [{ $set: { referralCode: { $toLower: "$referralCode" } } }] // Aggregation pipeline update
        ).exec();

        // Mongoose updateMany with pipeline returns an object like { acknowledged: true, modifiedCount: X, upsertedId: null, upsertedCount: 0, matchedCount: Y }
        // For older Mongoose versions, the direct result might vary.
        // The result for updateMany with pipeline might not directly be what's expected by `result.matchedCount` like in mongosh.
        // It's better to query counts before and after if exact numbers are needed, or rely on the general success.
        // However, modern Mongoose (v6+) should return matchedCount and modifiedCount.
        if (result && typeof result.acknowledged !== 'undefined') {
            console.log(`Update operation acknowledged: ${result.acknowledged}. Matched: ${result.matchedCount}, Modified: ${result.modifiedCount}`);
        } else {
            console.log("Update operation completed, but detailed counts (matched/modified) were not available in the result object. Check MongoDB logs if necessary.");
        }
        console.log("Step 2 finished.");
        console.log("--------------------");

        console.log("\nScript completed successfully.");

    } catch (error) {
        console.error("Error during script execution:", error);
        process.exit(1); // Exit with error
    } finally {
        if (mongoose.connection.readyState === 1) { // 1 === connected
            await mongoose.disconnect();
            console.log("Disconnected from MongoDB.");
        }
    }
}

// Execute the script
runScript();
