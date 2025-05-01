import mongoose, { Schema, Document, Types, Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid'; // For generating unique transaction IDs if needed

// --- Configuration ---
const SOURCE_DB_URI = 'mongodb://127.0.0.1:27017/SBC'; // Your source DB
const USER_SERVICE_DB_URI = 'mongodb://localhost:27017/sbc_user_dev'; // Target User DB
const PAYMENT_SERVICE_DB_URI = 'mongodb://localhost:27017/sbc_payment_dev'; // Target Payment DB
const PRODUCT_SERVICE_DB_URI = 'mongodb://localhost:27017/sbc_product_dev'; // Target Product DB

const SALT_ROUNDS = 10; // For password hashing - Not needed if source is hashed
const BATCH_SIZE = 1000; // Process 1000 documents at a time

// --- Enums from Target Models (Redefined here for simplicity) ---
// User Service Enums
enum TargetUserRole { USER = 'user', ADMIN = 'admin' }
enum TargetUserSex { MALE = 'male', FEMALE = 'female', OTHER = 'other', PREFER_NOT_TO_SAY = 'prefer_not_to_say' }
enum TargetSubscriptionType { CLASSIQUE = 'CLASSIQUE', CIBLE = 'CIBLE' }
enum TargetSubscriptionStatus { ACTIVE = 'active', EXPIRED = 'expired', CANCELLED = 'cancelled' }
// Payment Service Enums
enum TargetTransactionStatus { PENDING = 'pending', COMPLETED = 'completed', FAILED = 'failed', CANCELLED = 'cancelled', REFUNDED = 'refunded' }
enum TargetTransactionType { DEPOSIT = 'deposit', WITHDRAWAL = 'withdrawal', TRANSFER = 'transfer', PAYMENT = 'payment', REFUND = 'refund', FEE = 'fee' }
enum TargetCurrency { XAF = 'XAF', XOF = 'XOF', USD = 'USD', EUR = 'EUR', GBP = 'GBP' }
// Product Service Enums
enum TargetProductStatus { PENDING = 'pending', APPROVED = 'approved', REJECTED = 'rejected' }


// --- Interfaces for Target Models (Based on provided .model.ts files) ---

// Sub-interfaces/types
interface ITargetOtp { code: string; expiration: Date; }
interface ITargetPaymentProviderData { provider: string; transactionId: string; status: string; metadata?: Record<string, any>; }

// Main Interfaces
interface ITargetUser extends Document {
    _id: Types.ObjectId;
    name: string;
    region: string;
    country?: string;
    city?: string;
    phoneNumber: string; // Target is String now
    momoNumber?: string; // Target is String now
    momoOperator?: string;
    email: string;
    password?: string;
    avatar?: string;
    avatarId?: string;
    blocked: boolean;
    debt: number;
    flagged: boolean;
    forceUnflagged: boolean;
    forceFlagged: boolean;
    isVerified: boolean;
    role: TargetUserRole;
    deleted: boolean;
    deletedAt?: Date;
    deletionReason?: string;
    contactsOtps: Types.DocumentArray<ITargetOtp>; // Use ITargetOtp here
    otps: Types.DocumentArray<ITargetOtp>; // Use ITargetOtp here
    ipAddress?: string;
    ipCity?: string;
    ipRegion?: string;
    ipCountry?: string;
    ipLocation?: string;
    ipOrg?: string;
    ipLastUpdated?: Date;
    referralCode?: string;
    balance: number;
    sex?: TargetUserSex;
    birthDate?: Date;
    language?: string[];
    preferenceCategories?: string[];
    interests?: string[];
    profession?: string;
    shareContactInfo: boolean;
    createdAt: Date;
    updatedAt: Date;
    // Note: referredBy is not directly on the user model based on referral.model.ts
}

interface ITargetProduct extends Document {
    _id: Types.ObjectId;
    userId: Types.ObjectId;
    name: string;
    category: string;
    subcategory: string;
    description: string;
    imagesUrl: string[];
    price: number;
    ratings: Types.ObjectId[]; // Array of Rating ObjectIds
    overallRating: number;
    status: TargetProductStatus;
    rejectionReason?: string;
    deleted: boolean;
    deletedAt?: Date;
    // hasActiveFlashSale?: boolean; // Field not present in provided product.model.ts
    createdAt: Date;
    updatedAt: Date;
}

// NOTE: Skipping ITargetRating migration for simplicity, as source ratings are embedded in user.product
// interface ITargetRating extends Document { ... }

interface ITargetTransaction extends Document {
    _id: Types.ObjectId;
    transactionId: string; // Target specific unique ID
    userId: Types.ObjectId;
    type: TargetTransactionType;
    amount: number; // Target is Number
    currency: TargetCurrency;
    fee: number;
    status: TargetTransactionStatus;
    description: string;
    metadata?: Record<string, any>;
    paymentProvider?: ITargetPaymentProviderData; // Use ITargetPaymentProviderData
    relatedTransactions?: Types.ObjectId[];
    ipAddress?: string;
    deviceInfo?: string;
    deleted: boolean;
    deletedAt?: Date;
    reference?: string;
    serviceProvider?: string;
    paymentMethod?: string;
    externalTransactionId?: string; // Use source transId here?
    createdAt: Date;
    updatedAt: Date;
}

interface ITargetSubscription extends Document {
    _id: Types.ObjectId;
    user: Types.ObjectId;
    subscriptionType: TargetSubscriptionType;
    startDate: Date;
    endDate: Date;
    status: TargetSubscriptionStatus;
    metadata?: Record<string, any>;
    createdAt: Date;
    updatedAt: Date;
}

interface ITargetReferral extends Document {
    _id: Types.ObjectId;
    referrer: Types.ObjectId;
    referredUser: Types.ObjectId;
    referralLevel: number;
    archived: boolean;
    archivedAt?: Date;
    createdAt: Date; // Source only has createdAt
}


// --- Interfaces for Source Data (Matching Schemas) ---
interface ISourceOtp {
    code: string;
    expiration: Date;
}

interface ISourceRating {
    user: Types.ObjectId;
    rating: number;
}

interface ISourceProduct {
    name: string;
    category: string;
    subcategory: string;
    description: string;
    imagesUrl: string[];
    imagesId?: string[]; // Optional based on source
    price: number;
    ratings?: ISourceRating[]; // Array of source ratings
    overallRating?: number;
    accepted?: boolean; // Maps to target 'status'
    createdAt?: Date;
}

// Define ISourceUser explicitly to fix linter errors
interface ISourceUser extends Document {
    _id: Types.ObjectId;
    name: string;
    region: string;
    phoneNumber: number; // Source is Number
    momoNumber?: number; // Source is Number
    momoCorrespondent?: string; // Maps to momoOperator
    email: string;
    password?: string; // Assuming this holds the HASHED password
    token?: string;
    avatar?: string;
    avatarId?: string;
    blocked?: boolean;
    debt?: number;
    flagged?: boolean;
    forceUnflagged?: boolean;
    forceFlagged?: boolean;
    isVerified?: boolean;
    deleted?: boolean;
    deletedAt?: Date;
    deletionReason?: string;
    contactsOtps?: ISourceOtp[];
    otps?: ISourceOtp[];
    ipAddress?: string;
    ipCity?: string;
    ipRegion?: string;
    ipCountry?: string;
    ipLocation?: string;
    ipOrg?: string;
    ipLastUpdated?: Date;
    referralCode?: string;
    balance?: number;
    product?: ISourceProduct[]; // Embedded products
    // Add any other potential fields from the source schema
}

interface ISourceTransaction extends Document {
    _id: Types.ObjectId;
    userId?: Types.ObjectId; // Make optional if it can be missing
    userEmail?: string;
    transType?: 'withdrawal' | 'deposit';
    status?: string;
    message?: string;
    amount?: string; // Source is STRING
    date?: Date;
    transId?: string;
    createdAt?: Date; // From timestamps: true
    updatedAt?: Date; // From timestamps: true
}

interface ISourceSubscribe extends Document {
    _id: Types.ObjectId;
    date?: Date; // Make optional if it can be missing
    user?: Types.ObjectId; // unique in source
    plan?: '1' | '2' | '3';
    createdAt?: Date; // From timestamps? Needs verification
    updatedAt?: Date; // From timestamps? Needs verification
}

interface ISourceReferral extends Document {
    _id: Types.ObjectId;
    referrer?: Types.ObjectId; // Make optional if it can be missing
    referredUser?: Types.ObjectId; // Make optional if it can be missing
    referralLevel?: number;
    createdAt?: Date;
    archived?: boolean;
    archivedAt?: Date;
}


// --- Simplified Schemas for Source Data Fetching (Based on oldschema/*.js) ---

const SourceOtpSchema = new Schema<ISourceOtp>({
    code: String,
    expiration: Date,
}, { _id: false });

const SourceProductSchema = new Schema<ISourceProduct>({
    name: String,
    category: String,
    subcategory: String,
    description: String,
    imagesUrl: [String],
    imagesId: [String], // Not in target product model
    price: Number,
    ratings: [ // Embedded ratings - skipping migration of these for now
        {
            user: Schema.Types.ObjectId,
            rating: Number
        }
    ],
    overallRating: Number, // Source has this
    accepted: Boolean, // Maps to target 'status'
    createdAt: Date,
}, { _id: false });

const SourceUserSchema = new Schema<ISourceUser>({
    _id: Schema.Types.ObjectId, // Mongoose default
    name: String,
    region: String,
    phoneNumber: Number, // Source is Number
    momoNumber: Number,
    momoCorrespondent: String, // Maps to momoOperator
    email: String,
    password: String, // Hashed password from source
    token: String, // Not directly migrated
    avatar: String,
    avatarId: String,
    blocked: Boolean,
    debt: Number,
    flagged: Boolean,
    forceUnflagged: Boolean,
    forceFlagged: Boolean,
    isVerified: Boolean,
    deleted: Boolean, // Soft delete fields
    deletedAt: Date,
    deletionReason: String,
    contactsOtps: [SourceOtpSchema],
    otps: [SourceOtpSchema],
    ipAddress: String,
    ipCity: String,
    ipRegion: String,
    ipCountry: String,
    ipLocation: String,
    ipOrg: String,
    ipLastUpdated: Date,
    referralCode: String,
    balance: Number,
    product: [SourceProductSchema], // Embedded products
    // dailyWithdrawals: Array, // Not migrating this specific field
    // sex, birthDate, etc. not in source schema, need defaults or skip
}, { strict: false, collection: 'users' });

const SourceTransactionSchema = new Schema<ISourceTransaction>({
    _id: Schema.Types.ObjectId, // Mongoose default
    userId: Schema.Types.ObjectId, // Source is ObjectId
    userEmail: String, // Not in target transaction model
    transType: { type: String, enum: ['withdrawal', 'deposit'] },
    status: String, // Loosely defined status string
    message: String, // Maps to description
    amount: String, // Source is STRING!
    date: Date, // Maps to createdAt
    transId: String, // Sparse string, map to externalTransactionId?
}, { strict: false, collection: 'transactions', timestamps: true }); // Source has timestamps: true

const SourceSubscribeSchema = new Schema<ISourceSubscribe>({
    _id: Schema.Types.ObjectId, // Mongoose default
    date: Date, // Maps to startDate
    user: { type: Schema.Types.ObjectId, ref: 'user', required: true, unique: true }, // Source user is unique
    plan: { type: String, enum: ['1', '2', '3'] } // Maps to subscriptionType
}, { strict: false, collection: 'subscribes' });

const SourceReferralSchema = new Schema<ISourceReferral>({
    _id: Schema.Types.ObjectId, // Mongoose default
    referrer: { type: Schema.Types.ObjectId, ref: 'user', required: true },
    referredUser: { type: Schema.Types.ObjectId, ref: 'user', required: true },
    referralLevel: Number,
    createdAt: Date, // Source has default: Date.now
    archived: Boolean,
    archivedAt: Date,
}, { strict: false, collection: 'referrals' });


// --- Country Code Mapping ---
// Note: Prefixes are strings, numbers will be converted for checking
const countryCodePrefixes: { [key: string]: string[] } = {
    'DZ': ['213'], // Algeria
    'AO': ['244'], // Angola
    'BJ': ['229'], // Benin
    'BW': ['267'], // Botswana
    'BF': ['226'], // Burkina Faso
    'BI': ['257'], // Burundi
    'CV': ['238'], // Cabo Verde
    'CM': ['237'], // Cameroon
    'CF': ['236'], // Central African Republic
    'TD': ['235'], // Chad
    'KM': ['269'], // Comoros
    'CD': ['243'], // Congo, DRC
    'CG': ['242'], // Congo, Republic
    'CI': ['225'], // Cote d'Ivoire
    'DJ': ['253'], // Djibouti
    'EG': ['20'],  // Egypt
    'GQ': ['240'], // Equatorial Guinea
    'ER': ['291'], // Eritrea
    'SZ': ['268'], // Eswatini
    'ET': ['251'], // Ethiopia
    'GA': ['241'], // Gabon
    'GM': ['220'], // Gambia
    'GH': ['233'], // Ghana
    'GN': ['224'], // Guinea
    'GW': ['245'], // Guinea-Bissau
    'KE': ['254'], // Kenya
    'LS': ['266'], // Lesotho
    'LR': ['231'], // Liberia
    'LY': ['218'], // Libya
    'MG': ['261'], // Madagascar
    'MW': ['265'], // Malawi
    'ML': ['223'], // Mali
    'MR': ['222'], // Mauritania
    'MU': ['230'], // Mauritius
    'MA': ['212'], // Morocco
    'MZ': ['258'], // Mozambique
    'NA': ['264'], // Namibia
    'NE': ['227'], // Niger
    'NG': ['234'], // Nigeria
    'RW': ['250'], // Rwanda
    'ST': ['239'], // Sao Tome and Principe
    'SN': ['221'], // Senegal
    'SC': ['248'], // Seychelles
    'SL': ['232'], // Sierra Leone
    'SO': ['252'], // Somalia
    'ZA': ['27'],  // South Africa
    'SS': ['211'], // South Sudan
    'SD': ['249'], // Sudan
    'TZ': ['255'], // Tanzania
    'TG': ['228'], // Togo
    'TN': ['216'], // Tunisia
    'UG': ['256'], // Uganda
    'ZM': ['260'], // Zambia
    'ZW': ['263'], // Zimbabwe
};

// Helper function to get country ISO code from phone number (handles number or string type from source)
function getCountryFromPhoneNumber(phoneNumber: number | string | undefined, momoNumber: number | string | undefined): string | undefined {
    const numbersToCheck: (number | string | undefined)[] = [phoneNumber, momoNumber];

    for (const num of numbersToCheck) {
        if (num !== undefined && num !== null) { // Check if num has a value
            const numStr = String(num); // Convert number or string to string
            for (const [isoCode, prefixes] of Object.entries(countryCodePrefixes)) {
                for (const prefix of prefixes) {
                    if (numStr.startsWith(prefix)) {
                        return isoCode; // Return the first match
                    }
                }
            }
        }
    }
    return undefined; // No match found
}


// --- Main Migration Function ---
async function runMigration() {
    console.log('Starting migration...');

    let sourceConn: mongoose.Connection | null = null;
    let userConn: mongoose.Connection | null = null;
    let paymentConn: mongoose.Connection | null = null;
    let productConn: mongoose.Connection | null = null;

    const userIdMap = new Map<string, Types.ObjectId>(); // Map<oldUserIdString, newUserIdObjectId>

    try {
        // --- Connect to Databases ---
        console.log('Connecting to databases...');
        sourceConn = await mongoose.createConnection(SOURCE_DB_URI).asPromise();
        userConn = await mongoose.createConnection(USER_SERVICE_DB_URI).asPromise();
        paymentConn = await mongoose.createConnection(PAYMENT_SERVICE_DB_URI).asPromise();
        productConn = await mongoose.createConnection(PRODUCT_SERVICE_DB_URI).asPromise();
        console.log('Database connections established.');

        // --- Get Models ---
        // Source Models
        const SourceUser: Model<ISourceUser> = sourceConn.model<ISourceUser>('SourceUser', SourceUserSchema);
        const SourceTransaction: Model<ISourceTransaction> = sourceConn.model<ISourceTransaction>('SourceTransaction', SourceTransactionSchema);
        const SourceSubscribe: Model<ISourceSubscribe> = sourceConn.model<ISourceSubscribe>('SourceSubscribe', SourceSubscribeSchema);
        const SourceReferral: Model<ISourceReferral> = sourceConn.model<ISourceReferral>('SourceReferral', SourceReferralSchema);

        // --- Define Target Schemas and Models ---
        // These should ideally match your actual microservice model definitions exactly

        // Target User Model
        const TargetOtpSchema = new Schema<ITargetOtp>({ code: String, expiration: Date }, { _id: false });
        const TargetUserSchema = new Schema<ITargetUser>({
            name: { type: String, required: true, trim: true },
            region: { type: String, required: true, trim: true },
            country: { type: String, trim: true },
            city: { type: String, trim: true },
            phoneNumber: { type: String, required: true, unique: true, index: true }, // Target uses String
            momoNumber: { type: String },
            momoOperator: { type: String },
            email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
            password: { type: String, select: false }, // select: false is important for the TARGET model
            avatar: { type: String },
            avatarId: { type: String },
            blocked: { type: Boolean, default: false },
            debt: { type: Number, default: 0 },
            flagged: { type: Boolean, default: false },
            forceUnflagged: { type: Boolean, default: false },
            forceFlagged: { type: Boolean, default: false },
            isVerified: { type: Boolean, default: false },
            role: { type: String, enum: Object.values(TargetUserRole), default: TargetUserRole.USER, required: true },
            deleted: { type: Boolean, default: false, index: true },
            deletedAt: { type: Date },
            deletionReason: { type: String },
            contactsOtps: [TargetOtpSchema],
            otps: [TargetOtpSchema],
            ipAddress: { type: String },
            ipCity: { type: String },
            ipRegion: { type: String },
            ipCountry: { type: String },
            ipLocation: { type: String },
            ipOrg: { type: String },
            ipLastUpdated: { type: Date },
            referralCode: { type: String, unique: true, sparse: true, index: true },
            balance: { type: Number, default: 0, required: true },
            sex: { type: String, enum: Object.values(TargetUserSex) },
            birthDate: { type: Date },
            language: [{ type: String }],
            preferenceCategories: [{ type: String }],
            interests: [{ type: String }],
            profession: { type: String },
            shareContactInfo: { type: Boolean, default: true }, // Default from target model
        }, { timestamps: true, collection: 'users' });

        const TargetUser: Model<ITargetUser> = userConn.model<ITargetUser>('User', TargetUserSchema);


        // Target Product Model
        const TargetProductSchema = new Schema<ITargetProduct>({
            userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
            name: { type: String, required: true, trim: true },
            category: { type: String, required: true, trim: true, lowercase: true, index: true },
            subcategory: { type: String, required: true, trim: true, lowercase: true, index: true },
            description: { type: String, required: true, trim: true },
            imagesUrl: [{ type: String }],
            price: { type: Number, required: true, min: 0 },
            ratings: [{ type: Schema.Types.ObjectId, ref: 'Rating' }], // Ref to Rating model
            overallRating: { type: Number, default: 0, min: 0, max: 5 },
            status: { type: String, enum: Object.values(TargetProductStatus), default: TargetProductStatus.PENDING, index: true },
            rejectionReason: { type: String, trim: true },
            deleted: { type: Boolean, default: false, index: true },
            deletedAt: { type: Date },
        }, { timestamps: true, collection: 'products' });
        const TargetProduct: Model<ITargetProduct> = productConn.model<ITargetProduct>('Product', TargetProductSchema);


        // Target Transaction Model
        const TargetPaymentProviderDataSchema = new Schema<ITargetPaymentProviderData>({
            provider: { type: String, required: true },
            transactionId: { type: String, required: true },
            status: { type: String, required: true },
            metadata: { type: Schema.Types.Mixed },
        }, { _id: false });
        const TargetTransactionSchema = new Schema<ITargetTransaction>({
            transactionId: { type: String, required: true, unique: true, index: true }, // Needs generation
            userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
            type: { type: String, enum: Object.values(TargetTransactionType), required: true, index: true },
            amount: { type: Number, required: true },
            currency: { type: String, enum: Object.values(TargetCurrency), required: true, default: TargetCurrency.XAF },
            fee: { type: Number, default: 0 },
            status: { type: String, enum: Object.values(TargetTransactionStatus), default: TargetTransactionStatus.PENDING, required: true, index: true },
            description: { type: String, required: true },
            metadata: { type: Schema.Types.Mixed },
            paymentProvider: TargetPaymentProviderDataSchema,
            relatedTransactions: [{ type: Schema.Types.ObjectId, ref: 'Transaction' }],
            ipAddress: { type: String },
            deviceInfo: { type: String },
            deleted: { type: Boolean, default: false, index: true },
            deletedAt: { type: Date },
            reference: { type: String, index: true },
            serviceProvider: { type: String, index: true },
            paymentMethod: { type: String, index: true },
            externalTransactionId: { type: String, index: true }, // Use source transId here
        }, { timestamps: true, collection: 'transactions' });
        const TargetTransaction: Model<ITargetTransaction> = paymentConn.model<ITargetTransaction>('Transaction', TargetTransactionSchema);


        // Target Subscription Model
        const TargetSubscriptionSchema = new Schema<ITargetSubscription>({
            user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
            subscriptionType: { type: String, required: true, enum: Object.values(TargetSubscriptionType), index: true },
            startDate: { type: Date, required: true },
            endDate: { type: Date, required: true, index: true },
            status: { type: String, enum: Object.values(TargetSubscriptionStatus), default: TargetSubscriptionStatus.ACTIVE, index: true },
            metadata: { type: Schema.Types.Mixed },
        }, { timestamps: true, collection: 'subscriptions' });
        const TargetSubscription: Model<ITargetSubscription> = userConn.model<ITargetSubscription>('Subscription', TargetSubscriptionSchema);


        // Target Referral Model
        const TargetReferralSchema = new Schema<ITargetReferral>({
            referrer: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
            referredUser: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
            referralLevel: { type: Number, required: true, min: 1, max: 3, index: true },
            archived: { type: Boolean, default: false, index: true },
            archivedAt: { type: Date },
        }, { timestamps: { createdAt: true, updatedAt: false }, collection: 'referrals' }); // Match target model timestamps
        const TargetReferral: Model<ITargetReferral> = userConn.model<ITargetReferral>('Referral', TargetReferralSchema);


        // Target Rating Model (Product Service)
        interface ITargetRating extends Document {
            _id: Types.ObjectId;
            userId: Types.ObjectId; // Reference to the user who rated
            productId: Types.ObjectId; // Reference to the product being rated
            rating: number; // Rating value (1-5)
            review?: string; // Optional review text
            helpful: number; // Count of users who found this review helpful
            helpfulVotes?: Types.ObjectId[];
            deleted: boolean;
            deletedAt?: Date;
            createdAt: Date;
            updatedAt: Date;
        }
        const TargetRatingSchema = new Schema<ITargetRating>({
            userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
            productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
            rating: { type: Number, required: true, min: 1, max: 5 },
            review: { type: String, trim: true },
            helpful: { type: Number, default: 0, min: 0 },
            helpfulVotes: [{ type: Schema.Types.ObjectId, ref: 'User' }],
            deleted: { type: Boolean, default: false, index: true },
            deletedAt: { type: Date }
        }, { timestamps: true, collection: 'ratings' }); // Explicit collection name
        TargetRatingSchema.index({ userId: 1, productId: 1 }, { unique: true }); // Ensure user can rate a product only once
        const TargetRating: Model<ITargetRating> = productConn.model<ITargetRating>('Rating', TargetRatingSchema);


        // --- Migration Steps ---

        // 1. Migrate Users and Products (Batched)
        console.log('Migrating users and products...');
        let userBatch: Partial<ITargetUser>[] = [];
        let productBatch: (Partial<ITargetProduct> & {
            _originalUserId: string;
            _originalProductIndex: number; // To uniquely identify the source product within the user
            _sourceRatings?: ISourceRating[]; // Store original ratings temporarily
        })[] = [];
        let usersProcessed = 0;
        let usersMigrated = 0;
        let productsMigrated = 0;
        let ratingsMigrated = 0;
        const productMap = new Map<string, Types.ObjectId>(); // Map<originalUserId-originalProductIndex, newProductId>
        const userCursor = SourceUser.find().cursor();

        // Array to store rating info for later processing
        type PendingRatingInfo = {
            oldRatingUserId: string;
            oldProductOwnerId: string;
            originalProductIndex: number;
            ratingValue: number;
            createdAt: Date;
        };
        const pendingRatingsData: PendingRatingInfo[] = [];

        const TARGET_USER_DEBUG_ID = '65d073cb411f423f597c8f27'; // Define the ID to track

        // Helper function to process user and product batches
        const processUserProductBatch = async () => {
            if (userBatch.length === 0 && productBatch.length === 0) return;

            const currentProductBatch = [...productBatch]; // Copy product batch for processing ratings later
            productBatch = []; // Clear global batch for next iteration
            const currentUserBatch = [...userBatch]; // Copy user batch
            userBatch = []; // Clear global batch

            // --- Insert Users ---
            if (currentUserBatch.length > 0) {
                console.log(`Processing user batch of ${currentUserBatch.length}...`);
                let userInsertResult;
                try {
                    userInsertResult = await TargetUser.insertMany(currentUserBatch, { ordered: false });
                    usersMigrated += userInsertResult.length;
                    console.log(` -> Inserted ${userInsertResult.length} users.`);
                    userInsertResult.forEach((insertedUser, index) => {
                        const originalSourceUser = currentUserBatch[index];
                        if (originalSourceUser && originalSourceUser._id) {
                            userIdMap.set(originalSourceUser._id.toString(), insertedUser._id);
                        }
                    });
                } catch (error: any) {
                    console.error(`Error inserting user batch: ${error.message}`);
                    if (error.name === 'MongoBulkWriteError' && error.result) {
                        const numInserted = error.result.nInserted || 0;
                        usersMigrated += numInserted;
                        console.warn(` -> Partially inserted ${numInserted} users due to errors.`);
                        const insertedIdsMap = error.result.insertedIds || {};
                        for (const indexStr in insertedIdsMap) {
                            if (insertedIdsMap.hasOwnProperty(indexStr)) {
                                const index = parseInt(indexStr, 10);
                                const insertedId = insertedIdsMap[indexStr];
                                const originalSourceUser = currentUserBatch[index];
                                if (originalSourceUser && originalSourceUser._id && insertedId) {
                                    userIdMap.set(originalSourceUser._id.toString(), insertedId);
                                }
                            }
                        }
                        if (error.writeErrors) {
                            error.writeErrors.forEach(async (writeError: any) => {
                                const failedUserIndex = writeError.index;
                                const failedUser = currentUserBatch[failedUserIndex];
                                if (writeError.code === 11000 && failedUser?._id) {
                                    const oldUserId = failedUser._id.toString();
                                    const conflictingKey = Object.keys(writeError.keyValue)[0];
                                    const conflictingValue = writeError.keyValue[conflictingKey];
                                    console.log(`   -> Duplicate key error for User ID ${oldUserId} on ${conflictingKey}: ${conflictingValue}. Attempting to find existing target user...`);

                                    if (oldUserId === TARGET_USER_DEBUG_ID) {
                                        console.log(`[DEBUG ${TARGET_USER_DEBUG_ID}] Encountered duplicate key error during insertion.`);
                                    }

                                    let existingUser: { _id: Types.ObjectId } | null = null;
                                    try {
                                        // Try finding by the field that caused the error first
                                        existingUser = await TargetUser.findOne({ [conflictingKey]: conflictingValue }).select('_id').lean();

                                        // If not found, and the failed user has the other unique field, try that
                                        if (!existingUser) {
                                            if (conflictingKey === 'phoneNumber' && failedUser.email) {
                                                console.log(`   -> Finding by phoneNumber failed, trying email: ${failedUser.email}`);
                                                existingUser = await TargetUser.findOne({ email: failedUser.email.toLowerCase() }).select('_id').lean();
                                            } else if (conflictingKey === 'email' && failedUser.phoneNumber) {
                                                const phoneStr = String(failedUser.phoneNumber); // Convert to string for query
                                                console.log(`   -> Finding by email failed, trying phoneNumber: ${phoneStr}`);
                                                existingUser = await TargetUser.findOne({ phoneNumber: phoneStr }).select('_id').lean();
                                            }
                                        }

                                        if (existingUser) {
                                            // Log details before mapping duplicate
                                            console.log(`   -> Found existing user ${existingUser._id}. Mapping old user ${oldUserId} to it.`);
                                            console.log(`     Old User Details: Email=${failedUser.email}, Phone=${failedUser.phoneNumber}`);
                                            // We can't easily log existing user details here without another query, but the ID confirms it was found.
                                            userIdMap.set(oldUserId, existingUser._id);
                                            console.log(`   -> SUCCESS: Mapped old user ID ${oldUserId} to existing target user ${existingUser._id}.`);
                                            if (oldUserId === TARGET_USER_DEBUG_ID) {
                                                console.log(`[DEBUG ${TARGET_USER_DEBUG_ID}] Successfully mapped to existing user ${existingUser._id} after duplicate error.`);
                                            }
                                        } else {
                                            console.warn(`   -> FAILURE: Could not find existing target user for duplicate check on User ID ${oldUserId}. Ratings by this user will be skipped.`);
                                            if (oldUserId === TARGET_USER_DEBUG_ID) {
                                                console.warn(`[DEBUG ${TARGET_USER_DEBUG_ID}] FAILED to map to existing user after duplicate error. Ratings BY this user will be skipped.`);
                                            }
                                        }
                                    } catch (lookupError: any) {
                                        console.error(`   -> ERROR during duplicate user lookup for ${oldUserId}: ${lookupError.message}`);
                                        if (oldUserId === TARGET_USER_DEBUG_ID) {
                                            console.error(`[DEBUG ${TARGET_USER_DEBUG_ID}] Error during duplicate lookup: ${lookupError.message}`);
                                        }
                                    }
                                }
                            });
                        }
                    } else {
                        console.error(' -> Unhandled error during user batch insert:', error);
                    }
                }
            }

            // --- Insert Products (without ratings first) ---
            let productInsertResult: ITargetProduct[] = [];
            const productDataToInsert = currentProductBatch.filter(p => userIdMap.has(p._originalUserId)); // Only insert products whose user was mapped

            if (productDataToInsert.length > 0) {
                console.log(`Processing product batch of ${productDataToInsert.length}...`);
                // Remove temporary fields before insertion
                const cleanProductData = productDataToInsert.map(({ _originalUserId, _originalProductIndex, _sourceRatings, ...rest }) => ({
                    ...rest,
                    userId: userIdMap.get(_originalUserId)!, // Assign the mapped userId
                }));

                try {
                    productInsertResult = await TargetProduct.insertMany(cleanProductData, { ordered: false });
                    productsMigrated += productInsertResult.length;
                    console.log(` -> Inserted ${productInsertResult.length} products.`);

                    // Populate productMap for successfully inserted products
                    productInsertResult.forEach((insertedProduct, index) => {
                        const originalProductData = productDataToInsert[index]; // Find corresponding original data
                        if (originalProductData) {
                            const mapKey = `${originalProductData._originalUserId}-${originalProductData._originalProductIndex}`;
                            productMap.set(mapKey, insertedProduct._id);
                        }
                    });
                } catch (error: any) {
                    // Handle partial success for products
                    if (error.name === 'MongoBulkWriteError' && error.result) {
                        const numInserted = error.result.nInserted || 0;
                        productsMigrated += numInserted;
                        console.warn(` -> Partially inserted ${numInserted} products due to errors.`);
                        const insertedIdsMap = error.result.insertedIds || {};
                        // Populate map for successful inserts from the error result
                        for (const indexStr in insertedIdsMap) {
                            if (insertedIdsMap.hasOwnProperty(indexStr)) {
                                const index = parseInt(indexStr, 10);
                                const insertedId = insertedIdsMap[indexStr];
                                const originalProductData = productDataToInsert[index];
                                if (originalProductData) {
                                    const mapKey = `${originalProductData._originalUserId}-${originalProductData._originalProductIndex}`;
                                    productMap.set(mapKey, insertedId);
                                }
                            }
                        }
                        if (error.writeErrors) {
                            error.writeErrors.forEach((writeError: any) => {
                                const failedProductData = productDataToInsert[writeError.index];
                                console.warn(`  -> Failed product insert (Index ${writeError.index}): ${writeError.errmsg}. Original User ID: ${failedProductData?._originalUserId}, Product Name: ${failedProductData?.name}`);
                            });
                        }
                    } else {
                        console.error(`Error inserting product batch: ${error.message}`, error);
                    }
                }
            }

            // --- Process Ratings and Product Updates --- (REMOVED FROM BATCH - will happen after main loop)
            /*
            const ratingBatch: Partial<ITargetRating>[] = [];
            const productUpdateOps: any[] = []; // Array for bulkWrite operations
            let skippedRatings = 0;

            // Iterate through the *original* product data batch again to find source ratings and map products
            for (const originalProductData of productDataToInsert) {
                const mapKey = `${originalProductData._originalUserId}-${originalProductData._originalProductIndex}`;
                const newProductId = productMap.get(mapKey);

                if (!newProductId) {
                    if (originalProductData._sourceRatings && originalProductData._sourceRatings.length > 0) {
                        skippedRatings += originalProductData._sourceRatings.length;
                    }
                    continue; // Skip if the product itself wasn't successfully inserted/mapped
                }

                const sourceRatings = originalProductData._sourceRatings ?? [];
                if (sourceRatings.length === 0) {
                    continue; // No ratings for this product
                }

                const newRatingIds: Types.ObjectId[] = [];
                let ratingSum = 0;

                for (const sourceRating of sourceRatings) {
                    // DEBUG Log start for target user's product ratings
                    if (originalProductData._originalUserId === TARGET_USER_DEBUG_ID) {
                        console.log(`[DEBUG ${TARGET_USER_DEBUG_ID}] Processing rating by user ${sourceRating.user?.toString()} for product index ${originalProductData._originalProductIndex} (New PID: ${newProductId})`);
                    }

                    const oldRatingUserId = sourceRating.user?.toString();
                    const newRatingUserId = oldRatingUserId ? userIdMap.get(oldRatingUserId) : undefined;

                    if (!newRatingUserId) {
                        const message = ` -> Skipping rating for product ${newProductId}: Rating User ${oldRatingUserId} not found in userIdMap.`;
                        console.warn(message);
                        // DEBUG Log skip reason if related to target user
                        if (originalProductData._originalUserId === TARGET_USER_DEBUG_ID) {
                            console.warn(`[DEBUG ${TARGET_USER_DEBUG_ID}] Rating for OWN product skipped because rating user ${oldRatingUserId} was not mapped.`);
                        }
                        if (oldRatingUserId === TARGET_USER_DEBUG_ID) {
                            console.warn(`[DEBUG ${TARGET_USER_DEBUG_ID}] Rating BY target user for product ${newProductId} skipped because target user was not mapped (this shouldn't happen if caught earlier, but checking).`);
                        }
                        skippedRatings++;
                        continue;
                    }
                    if (!sourceRating.rating || sourceRating.rating < 1 || sourceRating.rating > 5) {
                        skippedRatings++;
                        continue;
                    }

                    const newRating: Partial<ITargetRating> = {
                        _id: new Types.ObjectId(), // Generate new ID for the rating
                        userId: newRatingUserId,
                        productId: newProductId,
                        rating: sourceRating.rating,
                        review: undefined, // Source has no review
                        helpful: 0,
                        helpfulVotes: [],
                        deleted: false,
                        // Use the PRODUCT's creation timestamp (derived from user ID) for rating creation
                        createdAt: originalProductData.createdAt ?? new Date()
                    };
                    ratingBatch.push(newRating);
                    newRatingIds.push(newRating._id!); // Add the new rating ID
                    ratingSum += sourceRating.rating;
                }

                if (newRatingIds.length > 0) {
                    const newOverallRating = ratingSum / newRatingIds.length;
                    // Prepare update operation for this product
                    productUpdateOps.push({
                        updateOne: {
                            filter: { _id: newProductId },
                            update: {
                                $set: {
                                    ratings: newRatingIds,
                                    overallRating: parseFloat(newOverallRating.toFixed(2)) // Store with 2 decimal places
                                }
                            }
                        }
                    });
                }
            }

            // Insert Ratings
            if (ratingBatch.length > 0) {
                console.log(`Inserting rating batch of ${ratingBatch.length}...`);
                try {
                    const ratingInsertResult = await TargetRating.insertMany(ratingBatch, { ordered: false });
                    ratingsMigrated += ratingInsertResult.length;
                    console.log(` -> Inserted ${ratingInsertResult.length} ratings.`);
                } catch (error: any) {
                    const numInserted = error.result?.nInserted || 0;
                    ratingsMigrated += numInserted;
                    console.error(`Error inserting rating batch: ${error.message}`);
                    if (error.name === 'MongoBulkWriteError' && error.writeErrors) {
                        console.warn(` -> Partially inserted ${numInserted} ratings due to errors.`);
                        error.writeErrors.forEach((writeError: any) => {
                            const failedRatingData = ratingBatch[writeError.index];
                            console.warn(`  -> Failed rating insert (Index ${writeError.index}): ${writeError.errmsg}. ProductID: ${failedRatingData?.productId}`);
                        });
                        // Check if any failed rating involved the target user or their products
                        error.writeErrors.forEach((writeError: any) => {
                            const failedRatingIndex = writeError.index;
                            const failedRating = ratingBatch[failedRatingIndex];
                            const failedProductId = failedRating?.productId;
                            const failedRatingUserId = failedRating?.userId; // This is the NEW user ID

                            // Check if the product belongs to the target user
                            let productOwnerIsTarget = false;
                            productMap.forEach((value, key) => {
                                if (productOwnerIsTarget) return; // Already found, skip rest
                                if (value.equals(failedProductId) && key.startsWith(TARGET_USER_DEBUG_ID + '-')) {
                                    productOwnerIsTarget = true;
                                }
                            });

                            // Check if the rating was made by the target user (requires mapping target ID)
                            const targetNewUserId = userIdMap.get(TARGET_USER_DEBUG_ID);
                            const ratingUserIsTarget = targetNewUserId && targetNewUserId.equals(failedRatingUserId);

                            if (productOwnerIsTarget) {
                                console.warn(`[DEBUG ${TARGET_USER_DEBUG_ID}] Rating insert failed for OWN product ${failedProductId}. Error: ${writeError.errmsg}`);
                            }
                            if (ratingUserIsTarget) {
                                console.warn(`[DEBUG ${TARGET_USER_DEBUG_ID}] Rating insert failed for rating MADE BY target user for product ${failedProductId}. Error: ${writeError.errmsg}`);
                            }
                        });
                    } else {
                        console.error(' -> Unhandled error during rating batch insert:', error);
                    }
                }
            }
            if (skippedRatings > 0) {
                console.warn(` -> Skipped ${skippedRatings} ratings due to mapping issues or invalid data.`);
            }

            // Update Products with ratings
            if (productUpdateOps.length > 0) {
                console.log(`Updating ${productUpdateOps.length} products with ratings info...`);
                try {
                    const bulkWriteResult = await TargetProduct.bulkWrite(productUpdateOps, { ordered: false });
                    console.log(` -> Product BulkWrite result: Matched: ${bulkWriteResult.matchedCount}, Modified: ${bulkWriteResult.modifiedCount}`);
                } catch (error: any) {
                    console.error(`Error during product bulk update for ratings: ${error.message}`, error);
                    // Log specific errors if available (bulkWrite errors are complex)
                    if (error.writeErrors) {
                        error.writeErrors.forEach((writeError: any) => {
                            console.warn(`  -> Failed product update op (Index ${writeError.index}): ${writeError.errmsg}`);
                        });
                    }
                }
            }
            */
        };

        // --- Main User Processing Loop ---
        for await (const sourceUser of userCursor) {
            usersProcessed++;
            if (!sourceUser?._id || !sourceUser.email) {
                console.warn(`Skipping user record without _id or email at index ${usersProcessed}:`, sourceUser._id);
                continue;
            }
            const oldUserId = sourceUser._id.toString();

            // DEBUG Log when processing the target user
            if (oldUserId === TARGET_USER_DEBUG_ID) {
                console.log(`[DEBUG ${TARGET_USER_DEBUG_ID}] Processing source user ${oldUserId}...`);
            }

            const mappedCountry = getCountryFromPhoneNumber(sourceUser.phoneNumber, sourceUser.momoNumber);

            const newUser: Partial<ITargetUser> = {
                _id: sourceUser._id, // Store old ID temporarily 
                name: sourceUser.name,
                region: sourceUser.region,
                country: mappedCountry,
                city: sourceUser.ipCity,
                phoneNumber: String(sourceUser.phoneNumber), // <-- Convert to string
                momoNumber: sourceUser.momoNumber !== undefined && sourceUser.momoNumber !== null ? String(sourceUser.momoNumber) : undefined, // <-- Convert to string if exists
                momoOperator: sourceUser.momoCorrespondent,
                email: sourceUser.email?.toLowerCase(),
                password: sourceUser.password, // Assign existing hash
                avatar: sourceUser.avatar,
                avatarId: sourceUser.avatarId,
                blocked: sourceUser.blocked ?? false,
                debt: sourceUser.debt ?? 0,
                flagged: sourceUser.flagged ?? false,
                forceUnflagged: sourceUser.forceUnflagged ?? false,
                forceFlagged: sourceUser.forceFlagged ?? false,
                isVerified: sourceUser.isVerified ?? false,
                role: TargetUserRole.USER,
                deleted: sourceUser.deleted ?? false,
                deletedAt: sourceUser.deletedAt,
                deletionReason: sourceUser.deletionReason,
                contactsOtps: (sourceUser.contactsOtps?.map((otp: ISourceOtp) => ({ code: otp.code, expiration: otp.expiration })) || []) as any,
                otps: (sourceUser.otps?.map((otp: ISourceOtp) => ({ code: otp.code, expiration: otp.expiration })) || []) as any,
                ipAddress: sourceUser.ipAddress,
                ipCity: sourceUser.ipCity, ipRegion: sourceUser.ipRegion, ipCountry: sourceUser.ipCountry, ipLocation: sourceUser.ipLocation, ipOrg: sourceUser.ipOrg, ipLastUpdated: sourceUser.ipLastUpdated,
                referralCode: sourceUser.referralCode,
                balance: sourceUser.balance ?? 0,
                sex: undefined, birthDate: undefined, language: [], preferenceCategories: [], interests: [], profession: undefined, shareContactInfo: true,
                createdAt: sourceUser._id?.getTimestamp() ?? new Date(), // Use ObjectId timestamp
            };

            if (!newUser.password) {
                // Handle users without passwords if necessary (e.g., generate one, or skip)
                console.warn(`User ${oldUserId} (${newUser.email}) has no password hash in source. Skipping password field.`);
            }

            userBatch.push(newUser);

            // Prepare Products for this user
            if (Array.isArray(sourceUser.product) && sourceUser.product.length > 0) {
                sourceUser.product.forEach((sourceProduct, index) => {
                    if (!sourceProduct || typeof sourceProduct !== 'object' || !sourceProduct.name) return;

                    // DEBUG Log when processing one of the target user's products
                    if (oldUserId === TARGET_USER_DEBUG_ID) {
                        console.log(`[DEBUG ${TARGET_USER_DEBUG_ID}] Processing OWN product at index ${index}: ${sourceProduct.name}`);
                    }

                    let targetStatus: TargetProductStatus = TargetProductStatus.PENDING;
                    if (sourceProduct.accepted === true) targetStatus = TargetProductStatus.APPROVED;

                    const productCreatedAt = sourceUser._id?.getTimestamp() ?? sourceProduct.createdAt ?? new Date();

                    const newProductData: Partial<ITargetProduct> & { _originalUserId: string; _originalProductIndex: number; _sourceRatings?: ISourceRating[] } = {
                        _originalUserId: oldUserId,
                        _originalProductIndex: index, // Store the index within the user's product array
                        // _sourceRatings: sourceProduct.ratings, // No longer needed directly here
                        // userId will be added during batch processing after mapping
                        name: sourceProduct.name,
                        category: sourceProduct.category?.toLowerCase(),
                        subcategory: sourceProduct.subcategory?.toLowerCase(),
                        description: sourceProduct.description,
                        imagesUrl: sourceProduct.imagesUrl || [],
                        price: sourceProduct.price,
                        ratings: [], // Initially empty, will be populated after rating migration
                        overallRating: 0, // Initially 0, will be recalculated
                        status: targetStatus,
                        deleted: false,
                        createdAt: productCreatedAt,
                    };
                    productBatch.push(newProductData);

                    // --- Collect Pending Ratings Info ---
                    if (Array.isArray(sourceProduct.ratings)) {
                        for (const sourceRating of sourceProduct.ratings) {
                            if (sourceRating && sourceRating.user && sourceRating.rating >= 1 && sourceRating.rating <= 5) {
                                pendingRatingsData.push({
                                    oldRatingUserId: sourceRating.user.toString(),
                                    oldProductOwnerId: oldUserId,
                                    originalProductIndex: index,
                                    ratingValue: sourceRating.rating,
                                    createdAt: productCreatedAt // Use product creation time for rating time
                                });
                            } else {
                                // Optional: Log skipped collection due to invalid source rating data
                                // console.warn(`Skipping collection of rating for product owner ${oldUserId}, index ${index} due to invalid source rating data:`, sourceRating);
                            }
                        }
                    }
                });
            }

            if (userBatch.length >= BATCH_SIZE || productBatch.length >= BATCH_SIZE) {
                await processUserProductBatch();
            }

            if (usersProcessed % (BATCH_SIZE * 5) === 0) { // Log progress more frequently
                console.log(`--- Progress: Processed ${usersProcessed} source users | Users Migrated: ${usersMigrated} | Products Migrated: ${productsMigrated} | Ratings Migrated: ${ratingsMigrated} ---`);
            }
        }
        // Process any remaining users/products/ratings in the last batch
        await processUserProductBatch();

        console.log(`User/Product migration finished. Processed Users: ${usersProcessed}, Migrated Users: ${usersMigrated}, Migrated Products: ${productsMigrated}`);
        console.log(`User ID Map size: ${userIdMap.size}`);
        console.log(`Product Map size: ${productMap.size}`);
        console.log(`Collected ${pendingRatingsData.length} potential ratings to process.`);

        // --- Phase 3: Process Collected Ratings ---
        console.log('\nStarting Phase 3: Processing collected ratings...');
        const ratingBatchInsert: Partial<ITargetRating>[] = [];
        const productUpdatesMap = new Map<string, { newRatingIds: Types.ObjectId[], ratingSum: number }>(); // Map<newProductIdString, {updates}> 
        let processedRatingsCount = 0;
        let successfullyPreparedRatings = 0;
        let skippedRatingsCount = 0;

        for (const pendingRating of pendingRatingsData) {
            processedRatingsCount++;
            const newRatingUserId = userIdMap.get(pendingRating.oldRatingUserId);
            const productMapKey = `${pendingRating.oldProductOwnerId}-${pendingRating.originalProductIndex}`;
            const newProductId = productMap.get(productMapKey);

            if (newRatingUserId && newProductId) {
                // Prepare rating document for insertion
                const newRating: Partial<ITargetRating> = {
                    _id: new Types.ObjectId(),
                    userId: newRatingUserId,
                    productId: newProductId,
                    rating: pendingRating.ratingValue,
                    createdAt: pendingRating.createdAt,
                    // Set defaults for other fields explicitly if needed
                    review: undefined,
                    helpful: 0,
                    helpfulVotes: [],
                    deleted: false,
                };
                ratingBatchInsert.push(newRating);
                successfullyPreparedRatings++;

                // Aggregate data for product update
                const productIdStr = newProductId.toString();
                if (!productUpdatesMap.has(productIdStr)) {
                    productUpdatesMap.set(productIdStr, { newRatingIds: [], ratingSum: 0 });
                }
                const productUpdateData = productUpdatesMap.get(productIdStr)!;
                productUpdateData.newRatingIds.push(newRating._id!);
                productUpdateData.ratingSum += newRating.rating!;

            } else {
                // Log why it was skipped (user not mapped or product not mapped)
                if (!newRatingUserId) {
                    // Minimal log to avoid flooding console, check previous logs for duplicate/failure details
                    // console.warn(`Skipping collected rating by ${pendingRating.oldRatingUserId}: User not mapped.`);
                }
                if (!newProductId) {
                    console.warn(`Skipping collected rating by ${pendingRating.oldRatingUserId}: Product (Owner: ${pendingRating.oldProductOwnerId}, Index: ${pendingRating.originalProductIndex}) not mapped.`);
                }
                skippedRatingsCount++;
            }

            // Insert ratings batch if full
            if (ratingBatchInsert.length >= BATCH_SIZE) {
                console.log(`Inserting rating batch of ${ratingBatchInsert.length}...`);
                try {
                    const ratingInsertResult = await TargetRating.insertMany(ratingBatchInsert, { ordered: false });
                    ratingsMigrated += ratingInsertResult.length;
                    console.log(` -> Inserted ${ratingInsertResult.length} ratings.`);
                } catch (error: any) {
                    const numInserted = error.result?.nInserted || 0;
                    ratingsMigrated += numInserted;
                    console.error(`Error inserting rating batch: ${error.message}`);
                    if (error.name === 'MongoBulkWriteError' && error.writeErrors) {
                        console.warn(` -> Partially inserted ${numInserted} ratings due to errors.`);
                        error.writeErrors.forEach((writeError: any) => {
                            console.warn(`  -> Failed rating insert: ${writeError.errmsg}`);
                            // Note: Debug logs for specific user already exist here if needed
                        });
                    }
                } finally {
                    ratingBatchInsert.length = 0; // Clear the batch array
                }
            }
            if (processedRatingsCount % (BATCH_SIZE * 10) === 0) {
                console.log(`Processed ${processedRatingsCount} collected ratings... Migrated: ${ratingsMigrated}, Skipped: ${skippedRatingsCount}`);
            }
        }

        // Insert any remaining ratings
        if (ratingBatchInsert.length > 0) {
            console.log(`Inserting final rating batch of ${ratingBatchInsert.length}...`);
            try {
                const ratingInsertResult = await TargetRating.insertMany(ratingBatchInsert, { ordered: false });
                ratingsMigrated += ratingInsertResult.length;
                console.log(` -> Inserted ${ratingInsertResult.length} final ratings.`);
            } catch (error: any) {
                const numInserted = error.result?.nInserted || 0;
                ratingsMigrated += numInserted;
                console.error(`Error inserting final rating batch: ${error.message}`);
                if (error.name === 'MongoBulkWriteError' && error.writeErrors) {
                    console.warn(` -> Partially inserted ${numInserted} ratings due to errors.`);
                    error.writeErrors.forEach((writeError: any) => {
                        console.warn(`  -> Failed final rating insert: ${writeError.errmsg}`);
                    });
                }
            }
        }
        console.log(`Rating insertion finished. Total Processed: ${processedRatingsCount}, Prepared: ${successfullyPreparedRatings}, Actually Inserted: ${ratingsMigrated}, Skipped: ${skippedRatingsCount}`);

        // --- Phase 4: Update Products with Ratings ---
        console.log('\nStarting Phase 4: Updating products with ratings...');
        const productUpdateOpsFinal: any[] = [];
        productUpdatesMap.forEach((updateData, productIdStr) => {
            if (updateData.newRatingIds.length > 0) {
                const newOverallRating = updateData.ratingSum / updateData.newRatingIds.length;
                productUpdateOpsFinal.push({
                    updateOne: {
                        filter: { _id: new Types.ObjectId(productIdStr) },
                        update: {
                            $set: {
                                ratings: updateData.newRatingIds,
                                overallRating: parseFloat(newOverallRating.toFixed(2))
                            }
                        }
                    }
                });
            }
        });

        if (productUpdateOpsFinal.length > 0) {
            console.log(`Preparing to update ${productUpdateOpsFinal.length} products with ratings info...`);
            try {
                // Execute updates in batches if necessary (though bulkWrite handles large amounts well)
                // For simplicity here, doing one large bulkWrite. Consider batching if it fails.
                const bulkWriteResult = await TargetProduct.bulkWrite(productUpdateOpsFinal, { ordered: false });
                console.log(` -> Product BulkWrite result: Matched: ${bulkWriteResult.matchedCount}, Modified: ${bulkWriteResult.modifiedCount}`);
                if (bulkWriteResult.hasWriteErrors()) {
                    console.warn(' -> Encountered errors during product rating updates:');
                    bulkWriteResult.getWriteErrors().forEach((err: any) => {
                        console.warn(`  -> Index ${err.index}: ${err.errmsg}`);
                    });
                }
            } catch (error: any) {
                console.error(`Error during final product bulk update for ratings: ${error.message}`, error);
            }
        } else {
            console.log('No products needed rating updates.');
        }

        console.log('Product rating updates finished.');

        // --- Helper function for processing batches of related data ---
        const processBatch = async (
            modelName: string,
            cursor: AsyncIterable<any>,
            targetModel: Model<any>,
            mapFunction: (sourceDoc: any, userIdMap: Map<string, Types.ObjectId>) => Partial<any> | null,
            checkExistingFunction?: (batchData: Partial<any>[]) => Promise<Set<string>> // Optional: Returns set of IDs/keys that already exist
        ) => {
            console.log(`\nMigrating ${modelName}...`);
            let batchData: Partial<any>[] = [];
            let processedCount = 0;
            let migratedCount = 0;
            let skippedCount = 0;

            for await (const sourceDoc of cursor) {
                processedCount++;
                const mappedDoc = mapFunction(sourceDoc, userIdMap);

                if (mappedDoc) {
                    batchData.push(mappedDoc);
                } else {
                    skippedCount++;
                }

                if (batchData.length >= BATCH_SIZE) {
                    let docsToInsert = batchData;
                    if (checkExistingFunction) {
                        console.warn(`Skipping checkExistingFunction for ${modelName} in this batch implementation.`);
                    }

                    try {
                        const result = await targetModel.insertMany(docsToInsert, { ordered: false });
                        migratedCount += result.length;
                    } catch (error: any) {
                        migratedCount += error.result?.insertedIds?.length ?? 0;
                        console.error(`Error inserting ${modelName} batch: ${error.message}`);
                        if (error.name === 'MongoBulkWriteError' && error.writeErrors) {
                            error.writeErrors.forEach((writeError: any) => console.warn(`  -> Failed ${modelName} insert: ${writeError.errmsg}`));
                        }
                    } finally {
                        batchData = []; // Clear batch
                    }
                    console.log(` -> ${modelName}: Processed ${processedCount}, Migrated ${migratedCount}, Skipped ${skippedCount}`);
                }
                if (processedCount % (BATCH_SIZE * 10) === 0) {
                    console.log(`Processed ${processedCount} source ${modelName}...`);
                }
            }

            // Process the last batch
            if (batchData.length > 0) {
                let docsToInsert = batchData;
                if (checkExistingFunction) {
                    console.warn(`Skipping checkExistingFunction for ${modelName} in final batch.`);
                }
                try {
                    const result = await targetModel.insertMany(docsToInsert, { ordered: false });
                    migratedCount += result.length;
                } catch (error: any) {
                    migratedCount += error.result?.insertedIds?.length ?? 0;
                    console.error(`Error inserting final ${modelName} batch: ${error.message}`);
                    if (error.name === 'MongoBulkWriteError' && error.writeErrors) {
                        error.writeErrors.forEach((writeError: any) => console.warn(`  -> Failed final ${modelName} insert: ${writeError.errmsg}`));
                    }
                }
            }
            console.log(`${modelName} migration finished. Processed: ${processedCount}, Migrated: ${migratedCount}, Skipped: ${skippedCount}`);
        };


        // 2. Migrate Transactions (Batched)
        const transactionCursor = SourceTransaction.find().cursor();
        const mapTransaction = (sourceTx: ISourceTransaction, map: Map<string, Types.ObjectId>): Partial<ITargetTransaction> | null => {
            const oldUserId = sourceTx.userId?.toString();
            const newUserId = oldUserId ? map.get(oldUserId) : undefined;
            if (!newUserId) return null; // Skip if user mapping failed

            let targetType: TargetTransactionType = TargetTransactionType.FEE; // Default
            if (sourceTx.transType === 'deposit') targetType = TargetTransactionType.DEPOSIT;
            else if (sourceTx.transType === 'withdrawal') targetType = TargetTransactionType.WITHDRAWAL;

            let amountNumber: number | null = null;
            if (typeof sourceTx.amount === 'string') {
                try { amountNumber = parseFloat(sourceTx.amount); if (isNaN(amountNumber)) throw new Error(); } catch { return null; /* Skip invalid amount */ }
            } else if (typeof sourceTx.amount === 'number') { amountNumber = sourceTx.amount; }
            else return null; // Skip missing/invalid amount

            let targetStatus: TargetTransactionStatus = TargetTransactionStatus.PENDING;
            const sourceStatusLower = sourceTx.status?.toLowerCase();
            if (sourceStatusLower === 'completed' || sourceStatusLower === 'success' || sourceStatusLower === 'successful') targetStatus = TargetTransactionStatus.COMPLETED;
            else if (sourceStatusLower === 'failed' || sourceStatusLower === 'failure') targetStatus = TargetTransactionStatus.FAILED;
            else if (sourceStatusLower === 'cancelled' || sourceStatusLower === 'canceled') targetStatus = TargetTransactionStatus.CANCELLED;

            return {
                transactionId: uuidv4(), userId: newUserId, type: targetType, amount: amountNumber, currency: TargetCurrency.XAF, fee: 0, status: targetStatus,
                description: sourceTx.message || `Migrated ${targetType}`, externalTransactionId: sourceTx.transId, deleted: false,
                createdAt: sourceTx._id?.getTimestamp() ?? new Date(), // Use ObjectId timestamp
            };
        };
        await processBatch('Transactions', transactionCursor, TargetTransaction, mapTransaction);


        // 3. Migrate Subscriptions (Batched) - Make them Lifetime
        const subscriptionCursor = SourceSubscribe.find().cursor();
        const mapSubscription = (sourceSub: ISourceSubscribe, map: Map<string, Types.ObjectId>): Partial<ITargetSubscription> | null => {
            const oldUserId = sourceSub.user?.toString();
            const newUserId = oldUserId ? map.get(oldUserId) : undefined;
            if (!newUserId) {
                console.warn(`Skipping subscription for source user ${oldUserId} as they weren't mapped.`);
                return null;
            }

            let targetSubscriptionType: TargetSubscriptionType | null = null;
            if (sourceSub.plan === '1') targetSubscriptionType = TargetSubscriptionType.CLASSIQUE;
            else if (sourceSub.plan === '2' || sourceSub.plan === '3') targetSubscriptionType = TargetSubscriptionType.CIBLE;
            else {
                console.warn(`Skipping subscription for user ${newUserId} due to unknown source plan: ${sourceSub.plan}`);
                return null; // Skip unknown plan
            }

            const startDate = sourceSub._id?.getTimestamp(); // Use ObjectId timestamp for start date
            if (!startDate) {
                console.warn(`Skipping subscription for user ${newUserId} because source _id timestamp couldn't be determined.`);
                return null; // Skip missing date
            }

            // Make subscription lifetime and active
            const endDate = new Date('9999-12-31T23:59:59.999Z'); // Far future date
            const status = TargetSubscriptionStatus.ACTIVE;

            return {
                user: newUserId,
                subscriptionType: targetSubscriptionType,
                startDate: startDate,
                endDate: endDate,
                status: status,
                metadata: { migratedFromPlan: sourceSub.plan, sourceSubId: sourceSub._id.toString() },
                createdAt: startDate, // Use start date as creation date for consistency
            };
        };
        // Optional: Add checkExisting function for Subscriptions if needed
        await processBatch('Subscriptions', subscriptionCursor, TargetSubscription, mapSubscription);


        // 4. Migrate Referrals (Batched)
        const referralCursor = SourceReferral.find().cursor();
        const mapReferral = (sourceRef: ISourceReferral, map: Map<string, Types.ObjectId>): Partial<ITargetReferral> | null => {
            const oldReferrerId = sourceRef.referrer?.toString();
            const oldReferredUserId = sourceRef.referredUser?.toString();
            const newReferrerId = oldReferrerId ? map.get(oldReferrerId) : undefined;
            const newReferredUserId = oldReferredUserId ? map.get(oldReferredUserId) : undefined;

            if (!newReferrerId || !newReferredUserId || newReferrerId.equals(newReferredUserId)) return null; // Skip if mapping failed or self-referral

            const referralLevel = sourceRef.referralLevel;
            if (typeof referralLevel !== 'number' || referralLevel < 1 || referralLevel > 3) return null; // Skip invalid level

            return {
                referrer: newReferrerId, referredUser: newReferredUserId, referralLevel: referralLevel,
                archived: sourceRef.archived ?? false, archivedAt: sourceRef.archivedAt,
                createdAt: sourceRef._id?.getTimestamp() ?? new Date(), // Use ObjectId timestamp
            };
        };
        // Optional: Add checkExisting function for Referrals if needed
        await processBatch('Referrals', referralCursor, TargetReferral, mapReferral);


        console.log('\nMigration completed successfully!');

    } catch (error) {
        console.error('\nMigration failed:', error);
    } finally {
        console.log('\nClosing database connections...');
        await sourceConn?.close();
        await userConn?.close();
        await paymentConn?.close();
        await productConn?.close();
        console.log('Connections closed.');
    }
}

// --- Run the Migration ---
runMigration().catch(err => {
    console.error("Unhandled error during migration script execution:", err);
    process.exit(1);
}); 