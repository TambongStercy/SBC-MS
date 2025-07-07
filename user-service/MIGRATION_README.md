# Cameroon Country Migration

This document describes the migration script to normalize Cameroon country name variations to the standard ISO code "CM".

## Overview

The system now automatically normalizes country names during user registration and profile updates. However, there may be existing users in the database with country names like "Cameroun", "Cameroon", "Camerun", or "Kamerun" that need to be converted to the standard "CM" code.

## What the Migration Does

The migration script will:

1. **Search** for all users with Cameroon country variations (case insensitive):
   - "Cameroon", "cameroon", "CAMEROON"
   - "Cameroun", "cameroun", "CAMEROUN" 
   - "Camerun", "camerun", "CAMERUN"
   - "Kamerun", "kamerun", "KAMERUN"

2. **Update** these users to have `country: "CM"`

3. **Verify** the migration completed successfully

4. **Report** statistics on the migration results

## How to Run the Migration

### Option 1: Using npm script (Recommended)

```bash
cd user-service
npm run migrate:cameroon
```

### Option 2: Direct Node.js execution

```bash
cd user-service
node migrate-cameroon-countries.js
```

### Option 3: Using the TypeScript version

```bash
cd user-service
npx ts-node src/scripts/migrate-cameroon-countries.ts
```

## Environment Variables

The script will use these environment variables for database connection:
- `DATABASE_URI` (primary)
- `MONGODB_URI` (fallback)
- Default: `mongodb://localhost:27017/sbc_backend`

Make sure your environment variables are set correctly before running the migration.

## Example Output

```
🚀 Starting Cameroon country migration script...
✅ Connected to MongoDB
🔍 Searching for users with Cameroon country variations...
📊 Found 45 users with Cameroon country variations
📋 Found country variations: [ 'Cameroun', 'Cameroon', 'cameroun' ]
⚙️  Processing batch 1/1
✏️  Updated user 507f1f77bcf86cd799439011: Cameroun -> CM
✏️  Updated user 507f1f77bcf86cd799439012: Cameroon -> CM
✏️  Updated user 507f1f77bcf86cd799439013: cameroun -> CM
🎉 Migration completed successfully!
📈 Total users processed: 45
✅ Users updated: 45
❌ Errors encountered: 0
🔍 Verifying migration...
✅ Migration verification successful! No more Cameroon variations found.
🇨🇲 Total users with country 'CM': 128
🔌 MongoDB connection closed
🎊 Migration script completed successfully
```

## Safety Features

- **Batch Processing**: Updates users in batches of 100 to avoid overwhelming the database
- **Error Handling**: Continues processing even if individual updates fail
- **Verification**: Checks that all variations were successfully updated
- **Logging**: Provides detailed logs of the migration process
- **Dry-run Capability**: The script first shows what will be updated before making changes

## Future Registration Handling

After running this migration, the system will automatically normalize country names during:

1. **User Registration**: `registerUser()` method now calls `normalizeCountryName()`
2. **Profile Updates**: `updateUserProfile()` method now calls `normalizeCountryName()`  
3. **Admin Updates**: `adminUpdateUser()` method now calls `normalizeCountryName()`

This means new users registering with "Cameroun" or "Cameroon" will automatically get "CM" as their country code.

## Files Modified

1. **user-service/src/services/user.service.ts**
   - Added country normalization to registration
   - Added country normalization to profile updates
   - Added country normalization to admin updates

2. **user-service/src/utils/phone.utils.ts**
   - Already contained `normalizeCountryName()` function with Cameroon mappings

3. **Migration Scripts**
   - `user-service/src/scripts/migrate-cameroon-countries.ts` (TypeScript version)
   - `user-service/migrate-cameroon-countries.js` (JavaScript version)

4. **package.json**
   - Added `migrate:cameroon` script

## Important Notes

- ⚠️ **Backup your database** before running the migration in production
- 🔄 The migration is **idempotent** - safe to run multiple times
- 📊 The script provides detailed statistics and verification
- 🛡️ Error handling ensures partial failures don't break the entire migration
- 🔍 All changes are logged for audit purposes

## Support

If you encounter any issues with the migration:

1. Check the console output for specific error messages
2. Verify your database connection string
3. Ensure the user service has proper database permissions
4. Check the logs for detailed error information

The migration script includes comprehensive error handling and will provide specific error messages if something goes wrong. 