/**
 * Seed script: creates 1 admin + 1 normal user directly in MongoDB.
 * Bypasses OTP verification — both users are created as already verified.
 * Run: node seed-users.js
 */

const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const MONGO_URI = 'mongodb://localhost:27017';
const DB_NAME = 'sbc_user_dev';

function generateReferralCode() {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const bytes = crypto.randomBytes(8);
  return Array.from(bytes).map(b => chars[b % chars.length]).join('');
}

async function seed() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  const users = db.collection('users');
  const referrals = db.collection('referrals');

  const adminId = new ObjectId();
  const userId = new ObjectId();
  const adminReferralCode = generateReferralCode().toLowerCase();
  const userReferralCode = generateReferralCode().toLowerCase();
  const now = new Date();

  const adminPassword = await bcrypt.hash('Admin@1234', 10);
  const userPassword = await bcrypt.hash('User@1234', 10);

  const adminUser = {
    _id: adminId,
    name: 'Super Admin',
    email: 'admin@sbctest.com',
    phoneNumber: '+237600000001',
    password: adminPassword,
    country: 'CM',
    city: 'Yaoundé',
    region: 'Centre',
    role: 'admin',
    referralCode: adminReferralCode,
    isVerified: true,
    balance: 0,
    usdBalance: 0,
    activationBalance: 0,
    sbcLiveBalance: 0,
    debt: 0,
    deleted: false,
    blocked: false,
    flagged: false,
    notificationPreference: 'email',
    shareContactInfo: true,
    sex: 'male',
    createdAt: now,
    updatedAt: now,
  };

  const normalUser = {
    _id: userId,
    name: 'Jean Dupont',
    email: 'jean.dupont@sbctest.com',
    phoneNumber: '+237600000002',
    password: userPassword,
    country: 'CM',
    city: 'Douala',
    region: 'Littoral',
    role: 'user',
    referralCode: userReferralCode,
    referredBy: adminId,
    isVerified: true,
    balance: 0,
    usdBalance: 0,
    activationBalance: 0,
    sbcLiveBalance: 0,
    debt: 0,
    deleted: false,
    blocked: false,
    flagged: false,
    notificationPreference: 'email',
    shareContactInfo: true,
    sex: 'male',
    createdAt: now,
    updatedAt: now,
  };

  // Remove existing seed users if any
  await users.deleteMany({ email: { $in: [adminUser.email, normalUser.email] } });
  await referrals.deleteMany({ referrer: adminId });

  await users.insertMany([adminUser, normalUser]);

  // Create referral relationship: admin referred the normal user (level 1)
  await referrals.insertOne({
    _id: new ObjectId(),
    referrer: adminId,
    referredUser: userId,
    referralLevel: 1,
    archived: false,
    referredUserName: normalUser.name,
    referredUserEmail: normalUser.email,
    referredUserPhone: normalUser.phoneNumber,
    createdAt: now,
    updatedAt: now,
  });

  await client.close();

  console.log('\n✅ Seed complete!\n');
  console.log('┌─────────────────────────────────────────────┐');
  console.log('│              ADMIN USER                      │');
  console.log('├─────────────────────────────────────────────┤');
  console.log(`│  Email    : ${adminUser.email.padEnd(33)}│`);
  console.log(`│  Password : Admin@1234                      │`);
  console.log(`│  Phone    : ${adminUser.phoneNumber.padEnd(33)}│`);
  console.log(`│  Role     : admin                           │`);
  console.log(`│  Parrainage: ${adminReferralCode.padEnd(32)}│`);
  console.log('├─────────────────────────────────────────────┤');
  console.log('│              NORMAL USER                     │');
  console.log('├─────────────────────────────────────────────┤');
  console.log(`│  Email    : ${normalUser.email.padEnd(33)}│`);
  console.log(`│  Password : User@1234                       │`);
  console.log(`│  Phone    : ${normalUser.phoneNumber.padEnd(33)}│`);
  console.log(`│  Role     : user                            │`);
  console.log(`│  Parrainage: ${userReferralCode.padEnd(32)}│`);
  console.log(`│  Parrainé par: ${adminUser.name.padEnd(30)}│`);
  console.log('└─────────────────────────────────────────────┘\n');
}

seed().catch(err => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
