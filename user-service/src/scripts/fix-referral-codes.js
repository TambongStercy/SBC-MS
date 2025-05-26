// Connect to your database (replace with your actual connection string and DB name)
// const db = connect("mongodb://localhost:27017/your_user_service_db");

print("Step 1: Finding and resolving case-insensitive duplicate referral codes...");

// Helper function to generate a new unique referral code (ensure it's lowercase)
function generateNewUniqueReferralCode() {
    let newCode;
    let isUnique = false;
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    do {
        newCode = '';
        for (let i = 0; i < 6; i++) { // Generate a 6-character code
            newCode += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        // Check if this new code already exists (case-sensitive check, as it's already lowercase)
        const existingUser = db.users.findOne({ referralCode: newCode });
        if (!existingUser) {
            isUnique = true;
        }
    } while (!isUnique);
    return newCode;
}

// Aggregation to find case-insensitive duplicates
const caseInsensitiveDuplicateAgg = [
    {
        $match: {
            referralCode: { $exists: true, $ne: null, $ne: "" }
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

const caseInsensitiveDuplicates = db.users.aggregate(caseInsensitiveDuplicateAgg).toArray();
let resolvedDuplicateUserCount = 0;

if (caseInsensitiveDuplicates.length === 0) {
    print("No case-insensitive duplicate referral codes found.");
} else {
    print(`Found ${caseInsensitiveDuplicates.length} case-insensitive duplicate groups. Resolving...`);
    caseInsensitiveDuplicates.forEach(dupGroup => {
        print(`Resolving duplicates for lowercased code: "${dupGroup._id}" used by ${dupGroup.count} users.`);
        // Keep the original code for the first user (it will be lowercased in Step 2)
        // Assign new codes to the rest of the users in this group
        const usersToAssignNewCode = dupGroup.users.slice(1);

        usersToAssignNewCode.forEach(userInfo => {
            const newUniqueCode = generateNewUniqueReferralCode(); // Already lowercase
            db.users.updateOne(
                { _id: userInfo._id },
                { $set: { referralCode: newUniqueCode } }
            );
            print(`  - User ${userInfo._id} (original code: "${userInfo.originalReferralCode}") assigned new code: ${newUniqueCode}`);
            resolvedDuplicateUserCount++;
        });
    });
    print(`Resolved duplicates for ${resolvedDuplicateUserCount} users by assigning new codes.`);
}
print("Step 1 finished.");
print("--------------------");

print("Step 2: Lowercasing all referral codes in the database...");
const result = db.users.updateMany(
    { referralCode: { $exists: true, $ne: null, $ne: "" } }, // Only update documents that have a referral code
    [{ $set: { referralCode: { $toLower: "$referralCode" } } }] // Use aggregation pipeline for update
);

print(`Matched ${result.matchedCount} users with referral codes.`);
print(`Modified ${result.modifiedCount} users to lowercase their referral codes.`);
print("Step 2 finished.");
print("--------------------");

print("Script completed.");
