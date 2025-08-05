// MongoDB shell script to backup production data before recovery
// Run with: mongosh --file 1-backup-production.js

const prodDb = connect('mongodb://127.0.0.1:27017/sbc_user_dev');

print('=== PRODUCTION BACKUP BEFORE RECOVERY ===\n');

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDbName = `sbc_user_dev_backup_${timestamp}`;

print(`Creating backup database: ${backupDbName}`);

// Create backup database
const backupDb = connect(`mongodb://127.0.0.1:27017/${backupDbName}`);

print('Backing up collections...');

// Backup users
print('- Backing up users...');
const users = prodDb.users.find({}).toArray();
if (users.length > 0) {
    backupDb.users.insertMany(users);
}
print(`  Users backed up: ${users.length}`);

// Backup referrals
print('- Backing up referrals...');
const referrals = prodDb.referrals.find({}).toArray();
if (referrals.length > 0) {
    backupDb.referrals.insertMany(referrals);
}
print(`  Referrals backed up: ${referrals.length}`);

// Backup subscriptions
print('- Backing up subscriptions...');
const subscriptions = prodDb.subscriptions.find({}).toArray();
if (subscriptions.length > 0) {
    backupDb.subscriptions.insertMany(subscriptions);
}
print(`  Subscriptions backed up: ${subscriptions.length}`);

// Backup other collections
const collections = ['partners', 'partnertransactions', 'dailywithdrawals', 'testusers'];
collections.forEach(collName => {
    if (prodDb.getCollection(collName).countDocuments() > 0) {
        print(`- Backing up ${collName}...`);
        const docs = prodDb.getCollection(collName).find({}).toArray();
        if (docs.length > 0) {
            backupDb.getCollection(collName).insertMany(docs);
        }
        print(`  ${collName} backed up: ${docs.length}`);
    }
});

print(`\n✅ Backup completed successfully!`);
print(`Backup database: ${backupDbName}`);
print(`\nTo restore from backup if needed:`);
print(`mongosh --eval "db.dropDatabase()" mongodb://127.0.0.1:27017/sbc_user_dev`);
print(`mongosh --eval "db.copyDatabase('${backupDbName}', 'sbc_user_dev')" mongodb://127.0.0.1:27017`);