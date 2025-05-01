"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
var mongoose_1 = require("mongoose");
var uuid_1 = require("uuid"); // For generating unique transaction IDs if needed
// --- Configuration ---
var SOURCE_DB_URI = 'mongodb://127.0.0.1:27017/SBC'; // Your source DB
var USER_SERVICE_DB_URI = 'mongodb://localhost:27017/sbc_user_dev'; // Target User DB
var PAYMENT_SERVICE_DB_URI = 'mongodb://localhost:27017/sbc_payment_dev'; // Target Payment DB
var PRODUCT_SERVICE_DB_URI = 'mongodb://localhost:27017/sbc_product_dev'; // Target Product DB
var SALT_ROUNDS = 10; // For password hashing - Not needed if source is hashed
var BATCH_SIZE = 1000; // Process 1000 documents at a time
// --- Enums from Target Models (Redefined here for simplicity) ---
// User Service Enums
var TargetUserRole;
(function (TargetUserRole) {
    TargetUserRole["USER"] = "user";
    TargetUserRole["ADMIN"] = "admin";
})(TargetUserRole || (TargetUserRole = {}));
var TargetUserSex;
(function (TargetUserSex) {
    TargetUserSex["MALE"] = "male";
    TargetUserSex["FEMALE"] = "female";
    TargetUserSex["OTHER"] = "other";
    TargetUserSex["PREFER_NOT_TO_SAY"] = "prefer_not_to_say";
})(TargetUserSex || (TargetUserSex = {}));
var TargetSubscriptionType;
(function (TargetSubscriptionType) {
    TargetSubscriptionType["CLASSIQUE"] = "CLASSIQUE";
    TargetSubscriptionType["CIBLE"] = "CIBLE";
})(TargetSubscriptionType || (TargetSubscriptionType = {}));
var TargetSubscriptionStatus;
(function (TargetSubscriptionStatus) {
    TargetSubscriptionStatus["ACTIVE"] = "active";
    TargetSubscriptionStatus["EXPIRED"] = "expired";
    TargetSubscriptionStatus["CANCELLED"] = "cancelled";
})(TargetSubscriptionStatus || (TargetSubscriptionStatus = {}));
// Payment Service Enums
var TargetTransactionStatus;
(function (TargetTransactionStatus) {
    TargetTransactionStatus["PENDING"] = "pending";
    TargetTransactionStatus["COMPLETED"] = "completed";
    TargetTransactionStatus["FAILED"] = "failed";
    TargetTransactionStatus["CANCELLED"] = "cancelled";
    TargetTransactionStatus["REFUNDED"] = "refunded";
})(TargetTransactionStatus || (TargetTransactionStatus = {}));
var TargetTransactionType;
(function (TargetTransactionType) {
    TargetTransactionType["DEPOSIT"] = "deposit";
    TargetTransactionType["WITHDRAWAL"] = "withdrawal";
    TargetTransactionType["TRANSFER"] = "transfer";
    TargetTransactionType["PAYMENT"] = "payment";
    TargetTransactionType["REFUND"] = "refund";
    TargetTransactionType["FEE"] = "fee";
})(TargetTransactionType || (TargetTransactionType = {}));
var TargetCurrency;
(function (TargetCurrency) {
    TargetCurrency["XAF"] = "XAF";
    TargetCurrency["XOF"] = "XOF";
    TargetCurrency["USD"] = "USD";
    TargetCurrency["EUR"] = "EUR";
    TargetCurrency["GBP"] = "GBP";
})(TargetCurrency || (TargetCurrency = {}));
// Product Service Enums
var TargetProductStatus;
(function (TargetProductStatus) {
    TargetProductStatus["PENDING"] = "pending";
    TargetProductStatus["APPROVED"] = "approved";
    TargetProductStatus["REJECTED"] = "rejected";
})(TargetProductStatus || (TargetProductStatus = {}));
// --- Simplified Schemas for Source Data Fetching (Based on oldschema/*.js) ---
var SourceOtpSchema = new mongoose_1.Schema({
    code: String,
    expiration: Date,
}, { _id: false });
var SourceProductSchema = new mongoose_1.Schema({
    name: String,
    category: String,
    subcategory: String,
    description: String,
    imagesUrl: [String],
    imagesId: [String], // Not in target product model
    price: Number,
    ratings: [
        {
            user: mongoose_1.Schema.Types.ObjectId,
            rating: Number
        }
    ],
    overallRating: Number, // Source has this
    accepted: Boolean, // Maps to target 'status'
    createdAt: Date,
}, { _id: false });
var SourceUserSchema = new mongoose_1.Schema({
    _id: mongoose_1.Schema.Types.ObjectId, // Mongoose default
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
var SourceTransactionSchema = new mongoose_1.Schema({
    _id: mongoose_1.Schema.Types.ObjectId, // Mongoose default
    userId: mongoose_1.Schema.Types.ObjectId, // Source is ObjectId
    userEmail: String, // Not in target transaction model
    transType: { type: String, enum: ['withdrawal', 'deposit'] },
    status: String, // Loosely defined status string
    message: String, // Maps to description
    amount: String, // Source is STRING!
    date: Date, // Maps to createdAt
    transId: String, // Sparse string, map to externalTransactionId?
}, { strict: false, collection: 'transactions', timestamps: true }); // Source has timestamps: true
var SourceSubscribeSchema = new mongoose_1.Schema({
    _id: mongoose_1.Schema.Types.ObjectId, // Mongoose default
    date: Date, // Maps to startDate
    user: { type: mongoose_1.Schema.Types.ObjectId, ref: 'user', required: true, unique: true }, // Source user is unique
    plan: { type: String, enum: ['1', '2', '3'] } // Maps to subscriptionType
}, { strict: false, collection: 'subscribes' });
var SourceReferralSchema = new mongoose_1.Schema({
    _id: mongoose_1.Schema.Types.ObjectId, // Mongoose default
    referrer: { type: mongoose_1.Schema.Types.ObjectId, ref: 'user', required: true },
    referredUser: { type: mongoose_1.Schema.Types.ObjectId, ref: 'user', required: true },
    referralLevel: Number,
    createdAt: Date, // Source has default: Date.now
    archived: Boolean,
    archivedAt: Date,
}, { strict: false, collection: 'referrals' });
// --- Country Code Mapping ---
// Note: Prefixes are strings, numbers will be converted for checking
var countryCodePrefixes = {
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
    'EG': ['20'], // Egypt
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
    'ZA': ['27'], // South Africa
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
function getCountryFromPhoneNumber(phoneNumber, momoNumber) {
    var numbersToCheck = [phoneNumber, momoNumber];
    for (var _i = 0, numbersToCheck_1 = numbersToCheck; _i < numbersToCheck_1.length; _i++) {
        var num = numbersToCheck_1[_i];
        if (num !== undefined && num !== null) { // Check if num has a value
            var numStr = String(num); // Convert number or string to string
            for (var _a = 0, _b = Object.entries(countryCodePrefixes); _a < _b.length; _a++) {
                var _c = _b[_a], isoCode = _c[0], prefixes = _c[1];
                for (var _d = 0, prefixes_1 = prefixes; _d < prefixes_1.length; _d++) {
                    var prefix = prefixes_1[_d];
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
function runMigration() {
    return __awaiter(this, void 0, void 0, function () {
        var sourceConn, userConn, paymentConn, productConn, userIdMap, SourceUser, SourceTransaction, SourceSubscribe, SourceReferral, TargetOtpSchema, TargetUserSchema, TargetUser_1, TargetProductSchema, TargetProduct_1, TargetPaymentProviderDataSchema, TargetTransactionSchema, TargetTransaction, TargetSubscriptionSchema, TargetSubscription, TargetReferralSchema, TargetReferral, TargetRatingSchema, TargetRating, userBatch_1, productBatch_1, usersProcessed, usersMigrated_1, productsMigrated_1, ratingsMigrated, productMap_1, userCursor, pendingRatingsData_2, TARGET_USER_DEBUG_ID_1, processUserProductBatch, _loop_1, _a, userCursor_1, userCursor_1_1, e_1_1, ratingBatchInsert, productUpdatesMap, processedRatingsCount, successfullyPreparedRatings, skippedRatingsCount, _i, pendingRatingsData_1, pendingRating, newRatingUserId, productMapKey, newProductId, newRating, productIdStr, productUpdateData, ratingInsertResult, error_1, numInserted, ratingInsertResult, error_2, numInserted, productUpdateOpsFinal_1, bulkWriteResult, error_3, processBatch, transactionCursor, mapTransaction, subscriptionCursor, mapSubscription, referralCursor, mapReferral, error_4;
        var _this = this;
        var _b, e_1, _c, _d;
        var _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u;
        return __generator(this, function (_v) {
            switch (_v.label) {
                case 0:
                    console.log('Starting migration...');
                    sourceConn = null;
                    userConn = null;
                    paymentConn = null;
                    productConn = null;
                    userIdMap = new Map();
                    _v.label = 1;
                case 1:
                    _v.trys.push([1, 41, 42, 47]);
                    // --- Connect to Databases ---
                    console.log('Connecting to databases...');
                    return [4 /*yield*/, mongoose_1.default.createConnection(SOURCE_DB_URI).asPromise()];
                case 2:
                    sourceConn = _v.sent();
                    return [4 /*yield*/, mongoose_1.default.createConnection(USER_SERVICE_DB_URI).asPromise()];
                case 3:
                    userConn = _v.sent();
                    return [4 /*yield*/, mongoose_1.default.createConnection(PAYMENT_SERVICE_DB_URI).asPromise()];
                case 4:
                    paymentConn = _v.sent();
                    return [4 /*yield*/, mongoose_1.default.createConnection(PRODUCT_SERVICE_DB_URI).asPromise()];
                case 5:
                    productConn = _v.sent();
                    console.log('Database connections established.');
                    SourceUser = sourceConn.model('SourceUser', SourceUserSchema);
                    SourceTransaction = sourceConn.model('SourceTransaction', SourceTransactionSchema);
                    SourceSubscribe = sourceConn.model('SourceSubscribe', SourceSubscribeSchema);
                    SourceReferral = sourceConn.model('SourceReferral', SourceReferralSchema);
                    TargetOtpSchema = new mongoose_1.Schema({ code: String, expiration: Date }, { _id: false });
                    TargetUserSchema = new mongoose_1.Schema({
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
                    TargetUser_1 = userConn.model('User', TargetUserSchema);
                    TargetProductSchema = new mongoose_1.Schema({
                        userId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
                        name: { type: String, required: true, trim: true },
                        category: { type: String, required: true, trim: true, lowercase: true, index: true },
                        subcategory: { type: String, required: true, trim: true, lowercase: true, index: true },
                        description: { type: String, required: true, trim: true },
                        imagesUrl: [{ type: String }],
                        price: { type: Number, required: true, min: 0 },
                        ratings: [{ type: mongoose_1.Schema.Types.ObjectId, ref: 'Rating' }], // Ref to Rating model
                        overallRating: { type: Number, default: 0, min: 0, max: 5 },
                        status: { type: String, enum: Object.values(TargetProductStatus), default: TargetProductStatus.PENDING, index: true },
                        rejectionReason: { type: String, trim: true },
                        deleted: { type: Boolean, default: false, index: true },
                        deletedAt: { type: Date },
                    }, { timestamps: true, collection: 'products' });
                    TargetProduct_1 = productConn.model('Product', TargetProductSchema);
                    TargetPaymentProviderDataSchema = new mongoose_1.Schema({
                        provider: { type: String, required: true },
                        transactionId: { type: String, required: true },
                        status: { type: String, required: true },
                        metadata: { type: mongoose_1.Schema.Types.Mixed },
                    }, { _id: false });
                    TargetTransactionSchema = new mongoose_1.Schema({
                        transactionId: { type: String, required: true, unique: true, index: true }, // Needs generation
                        userId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
                        type: { type: String, enum: Object.values(TargetTransactionType), required: true, index: true },
                        amount: { type: Number, required: true },
                        currency: { type: String, enum: Object.values(TargetCurrency), required: true, default: TargetCurrency.XAF },
                        fee: { type: Number, default: 0 },
                        status: { type: String, enum: Object.values(TargetTransactionStatus), default: TargetTransactionStatus.PENDING, required: true, index: true },
                        description: { type: String, required: true },
                        metadata: { type: mongoose_1.Schema.Types.Mixed },
                        paymentProvider: TargetPaymentProviderDataSchema,
                        relatedTransactions: [{ type: mongoose_1.Schema.Types.ObjectId, ref: 'Transaction' }],
                        ipAddress: { type: String },
                        deviceInfo: { type: String },
                        deleted: { type: Boolean, default: false, index: true },
                        deletedAt: { type: Date },
                        reference: { type: String, index: true },
                        serviceProvider: { type: String, index: true },
                        paymentMethod: { type: String, index: true },
                        externalTransactionId: { type: String, index: true }, // Use source transId here
                    }, { timestamps: true, collection: 'transactions' });
                    TargetTransaction = paymentConn.model('Transaction', TargetTransactionSchema);
                    TargetSubscriptionSchema = new mongoose_1.Schema({
                        user: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
                        subscriptionType: { type: String, required: true, enum: Object.values(TargetSubscriptionType), index: true },
                        startDate: { type: Date, required: true },
                        endDate: { type: Date, required: true, index: true },
                        status: { type: String, enum: Object.values(TargetSubscriptionStatus), default: TargetSubscriptionStatus.ACTIVE, index: true },
                        metadata: { type: mongoose_1.Schema.Types.Mixed },
                    }, { timestamps: true, collection: 'subscriptions' });
                    TargetSubscription = userConn.model('Subscription', TargetSubscriptionSchema);
                    TargetReferralSchema = new mongoose_1.Schema({
                        referrer: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
                        referredUser: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
                        referralLevel: { type: Number, required: true, min: 1, max: 3, index: true },
                        archived: { type: Boolean, default: false, index: true },
                        archivedAt: { type: Date },
                    }, { timestamps: { createdAt: true, updatedAt: false }, collection: 'referrals' });
                    TargetReferral = userConn.model('Referral', TargetReferralSchema);
                    TargetRatingSchema = new mongoose_1.Schema({
                        userId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
                        productId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
                        rating: { type: Number, required: true, min: 1, max: 5 },
                        review: { type: String, trim: true },
                        helpful: { type: Number, default: 0, min: 0 },
                        helpfulVotes: [{ type: mongoose_1.Schema.Types.ObjectId, ref: 'User' }],
                        deleted: { type: Boolean, default: false, index: true },
                        deletedAt: { type: Date }
                    }, { timestamps: true, collection: 'ratings' });
                    TargetRatingSchema.index({ userId: 1, productId: 1 }, { unique: true }); // Ensure user can rate a product only once
                    TargetRating = productConn.model('Rating', TargetRatingSchema);
                    // --- Migration Steps ---
                    // 1. Migrate Users and Products (Batched)
                    console.log('Migrating users and products...');
                    userBatch_1 = [];
                    productBatch_1 = [];
                    usersProcessed = 0;
                    usersMigrated_1 = 0;
                    productsMigrated_1 = 0;
                    ratingsMigrated = 0;
                    productMap_1 = new Map();
                    userCursor = SourceUser.find().cursor();
                    pendingRatingsData_2 = [];
                    TARGET_USER_DEBUG_ID_1 = '65d073cb411f423f597c8f27';
                    processUserProductBatch = function () { return __awaiter(_this, void 0, void 0, function () {
                        var currentProductBatch, currentUserBatch, userInsertResult, error_5, numInserted, insertedIdsMap, indexStr, index, insertedId, originalSourceUser, productInsertResult, productDataToInsert, cleanProductData, error_6, numInserted, insertedIdsMap, indexStr, index, insertedId, originalProductData, mapKey;
                        var _this = this;
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0:
                                    if (userBatch_1.length === 0 && productBatch_1.length === 0)
                                        return [2 /*return*/];
                                    currentProductBatch = __spreadArray([], productBatch_1, true);
                                    productBatch_1 = []; // Clear global batch for next iteration
                                    currentUserBatch = __spreadArray([], userBatch_1, true);
                                    userBatch_1 = []; // Clear global batch
                                    if (!(currentUserBatch.length > 0)) return [3 /*break*/, 4];
                                    console.log("Processing user batch of ".concat(currentUserBatch.length, "..."));
                                    userInsertResult = void 0;
                                    _a.label = 1;
                                case 1:
                                    _a.trys.push([1, 3, , 4]);
                                    return [4 /*yield*/, TargetUser_1.insertMany(currentUserBatch, { ordered: false })];
                                case 2:
                                    userInsertResult = _a.sent();
                                    usersMigrated_1 += userInsertResult.length;
                                    console.log(" -> Inserted ".concat(userInsertResult.length, " users."));
                                    userInsertResult.forEach(function (insertedUser, index) {
                                        var originalSourceUser = currentUserBatch[index];
                                        if (originalSourceUser && originalSourceUser._id) {
                                            userIdMap.set(originalSourceUser._id.toString(), insertedUser._id);
                                        }
                                    });
                                    return [3 /*break*/, 4];
                                case 3:
                                    error_5 = _a.sent();
                                    console.error("Error inserting user batch: ".concat(error_5.message));
                                    if (error_5.name === 'MongoBulkWriteError' && error_5.result) {
                                        numInserted = error_5.result.nInserted || 0;
                                        usersMigrated_1 += numInserted;
                                        console.warn(" -> Partially inserted ".concat(numInserted, " users due to errors."));
                                        insertedIdsMap = error_5.result.insertedIds || {};
                                        for (indexStr in insertedIdsMap) {
                                            if (insertedIdsMap.hasOwnProperty(indexStr)) {
                                                index = parseInt(indexStr, 10);
                                                insertedId = insertedIdsMap[indexStr];
                                                originalSourceUser = currentUserBatch[index];
                                                if (originalSourceUser && originalSourceUser._id && insertedId) {
                                                    userIdMap.set(originalSourceUser._id.toString(), insertedId);
                                                }
                                            }
                                        }
                                        if (error_5.writeErrors) {
                                            error_5.writeErrors.forEach(function (writeError) { return __awaiter(_this, void 0, void 0, function () {
                                                var failedUserIndex, failedUser, oldUserId, conflictingKey, conflictingValue, existingUser, phoneStr, lookupError_1;
                                                var _a;
                                                return __generator(this, function (_b) {
                                                    switch (_b.label) {
                                                        case 0:
                                                            failedUserIndex = writeError.index;
                                                            failedUser = currentUserBatch[failedUserIndex];
                                                            if (!(writeError.code === 11000 && (failedUser === null || failedUser === void 0 ? void 0 : failedUser._id))) return [3 /*break*/, 8];
                                                            oldUserId = failedUser._id.toString();
                                                            conflictingKey = Object.keys(writeError.keyValue)[0];
                                                            conflictingValue = writeError.keyValue[conflictingKey];
                                                            console.log("   -> Duplicate key error for User ID ".concat(oldUserId, " on ").concat(conflictingKey, ": ").concat(conflictingValue, ". Attempting to find existing target user..."));
                                                            if (oldUserId === TARGET_USER_DEBUG_ID_1) {
                                                                console.log("[DEBUG ".concat(TARGET_USER_DEBUG_ID_1, "] Encountered duplicate key error during insertion."));
                                                            }
                                                            existingUser = null;
                                                            _b.label = 1;
                                                        case 1:
                                                            _b.trys.push([1, 7, , 8]);
                                                            return [4 /*yield*/, TargetUser_1.findOne((_a = {}, _a[conflictingKey] = conflictingValue, _a)).select('_id').lean()];
                                                        case 2:
                                                            // Try finding by the field that caused the error first
                                                            existingUser = _b.sent();
                                                            if (!!existingUser) return [3 /*break*/, 6];
                                                            if (!(conflictingKey === 'phoneNumber' && failedUser.email)) return [3 /*break*/, 4];
                                                            console.log("   -> Finding by phoneNumber failed, trying email: ".concat(failedUser.email));
                                                            return [4 /*yield*/, TargetUser_1.findOne({ email: failedUser.email.toLowerCase() }).select('_id').lean()];
                                                        case 3:
                                                            existingUser = _b.sent();
                                                            return [3 /*break*/, 6];
                                                        case 4:
                                                            if (!(conflictingKey === 'email' && failedUser.phoneNumber)) return [3 /*break*/, 6];
                                                            phoneStr = String(failedUser.phoneNumber);
                                                            console.log("   -> Finding by email failed, trying phoneNumber: ".concat(phoneStr));
                                                            return [4 /*yield*/, TargetUser_1.findOne({ phoneNumber: phoneStr }).select('_id').lean()];
                                                        case 5:
                                                            existingUser = _b.sent();
                                                            _b.label = 6;
                                                        case 6:
                                                            if (existingUser) {
                                                                // Log details before mapping duplicate
                                                                console.log("   -> Found existing user ".concat(existingUser._id, ". Mapping old user ").concat(oldUserId, " to it."));
                                                                console.log("     Old User Details: Email=".concat(failedUser.email, ", Phone=").concat(failedUser.phoneNumber));
                                                                // We can't easily log existing user details here without another query, but the ID confirms it was found.
                                                                userIdMap.set(oldUserId, existingUser._id);
                                                                console.log("   -> SUCCESS: Mapped old user ID ".concat(oldUserId, " to existing target user ").concat(existingUser._id, "."));
                                                                if (oldUserId === TARGET_USER_DEBUG_ID_1) {
                                                                    console.log("[DEBUG ".concat(TARGET_USER_DEBUG_ID_1, "] Successfully mapped to existing user ").concat(existingUser._id, " after duplicate error."));
                                                                }
                                                            }
                                                            else {
                                                                console.warn("   -> FAILURE: Could not find existing target user for duplicate check on User ID ".concat(oldUserId, ". Ratings by this user will be skipped."));
                                                                if (oldUserId === TARGET_USER_DEBUG_ID_1) {
                                                                    console.warn("[DEBUG ".concat(TARGET_USER_DEBUG_ID_1, "] FAILED to map to existing user after duplicate error. Ratings BY this user will be skipped."));
                                                                }
                                                            }
                                                            return [3 /*break*/, 8];
                                                        case 7:
                                                            lookupError_1 = _b.sent();
                                                            console.error("   -> ERROR during duplicate user lookup for ".concat(oldUserId, ": ").concat(lookupError_1.message));
                                                            if (oldUserId === TARGET_USER_DEBUG_ID_1) {
                                                                console.error("[DEBUG ".concat(TARGET_USER_DEBUG_ID_1, "] Error during duplicate lookup: ").concat(lookupError_1.message));
                                                            }
                                                            return [3 /*break*/, 8];
                                                        case 8: return [2 /*return*/];
                                                    }
                                                });
                                            }); });
                                        }
                                    }
                                    else {
                                        console.error(' -> Unhandled error during user batch insert:', error_5);
                                    }
                                    return [3 /*break*/, 4];
                                case 4:
                                    productInsertResult = [];
                                    productDataToInsert = currentProductBatch.filter(function (p) { return userIdMap.has(p._originalUserId); });
                                    if (!(productDataToInsert.length > 0)) return [3 /*break*/, 8];
                                    console.log("Processing product batch of ".concat(productDataToInsert.length, "..."));
                                    cleanProductData = productDataToInsert.map(function (_a) {
                                        var _originalUserId = _a._originalUserId, _originalProductIndex = _a._originalProductIndex, _sourceRatings = _a._sourceRatings, rest = __rest(_a, ["_originalUserId", "_originalProductIndex", "_sourceRatings"]);
                                        return (__assign(__assign({}, rest), { userId: userIdMap.get(_originalUserId) }));
                                    });
                                    _a.label = 5;
                                case 5:
                                    _a.trys.push([5, 7, , 8]);
                                    return [4 /*yield*/, TargetProduct_1.insertMany(cleanProductData, { ordered: false })];
                                case 6:
                                    productInsertResult = _a.sent();
                                    productsMigrated_1 += productInsertResult.length;
                                    console.log(" -> Inserted ".concat(productInsertResult.length, " products."));
                                    // Populate productMap for successfully inserted products
                                    productInsertResult.forEach(function (insertedProduct, index) {
                                        var originalProductData = productDataToInsert[index]; // Find corresponding original data
                                        if (originalProductData) {
                                            var mapKey = "".concat(originalProductData._originalUserId, "-").concat(originalProductData._originalProductIndex);
                                            productMap_1.set(mapKey, insertedProduct._id);
                                        }
                                    });
                                    return [3 /*break*/, 8];
                                case 7:
                                    error_6 = _a.sent();
                                    // Handle partial success for products
                                    if (error_6.name === 'MongoBulkWriteError' && error_6.result) {
                                        numInserted = error_6.result.nInserted || 0;
                                        productsMigrated_1 += numInserted;
                                        console.warn(" -> Partially inserted ".concat(numInserted, " products due to errors."));
                                        insertedIdsMap = error_6.result.insertedIds || {};
                                        // Populate map for successful inserts from the error result
                                        for (indexStr in insertedIdsMap) {
                                            if (insertedIdsMap.hasOwnProperty(indexStr)) {
                                                index = parseInt(indexStr, 10);
                                                insertedId = insertedIdsMap[indexStr];
                                                originalProductData = productDataToInsert[index];
                                                if (originalProductData) {
                                                    mapKey = "".concat(originalProductData._originalUserId, "-").concat(originalProductData._originalProductIndex);
                                                    productMap_1.set(mapKey, insertedId);
                                                }
                                            }
                                        }
                                        if (error_6.writeErrors) {
                                            error_6.writeErrors.forEach(function (writeError) {
                                                var failedProductData = productDataToInsert[writeError.index];
                                                console.warn("  -> Failed product insert (Index ".concat(writeError.index, "): ").concat(writeError.errmsg, ". Original User ID: ").concat(failedProductData === null || failedProductData === void 0 ? void 0 : failedProductData._originalUserId, ", Product Name: ").concat(failedProductData === null || failedProductData === void 0 ? void 0 : failedProductData.name));
                                            });
                                        }
                                    }
                                    else {
                                        console.error("Error inserting product batch: ".concat(error_6.message), error_6);
                                    }
                                    return [3 /*break*/, 8];
                                case 8: return [2 /*return*/];
                            }
                        });
                    }); };
                    _v.label = 6;
                case 6:
                    _v.trys.push([6, 12, 13, 18]);
                    _loop_1 = function () {
                        var sourceUser, oldUserId, mappedCountry, newUser;
                        return __generator(this, function (_w) {
                            switch (_w.label) {
                                case 0:
                                    _d = userCursor_1_1.value;
                                    _a = false;
                                    sourceUser = _d;
                                    usersProcessed++;
                                    if (!(sourceUser === null || sourceUser === void 0 ? void 0 : sourceUser._id) || !sourceUser.email) {
                                        console.warn("Skipping user record without _id or email at index ".concat(usersProcessed, ":"), sourceUser._id);
                                        return [2 /*return*/, "continue"];
                                    }
                                    oldUserId = sourceUser._id.toString();
                                    // DEBUG Log when processing the target user
                                    if (oldUserId === TARGET_USER_DEBUG_ID_1) {
                                        console.log("[DEBUG ".concat(TARGET_USER_DEBUG_ID_1, "] Processing source user ").concat(oldUserId, "..."));
                                    }
                                    mappedCountry = getCountryFromPhoneNumber(sourceUser.phoneNumber, sourceUser.momoNumber);
                                    newUser = {
                                        _id: sourceUser._id, // Store old ID temporarily 
                                        name: sourceUser.name,
                                        region: sourceUser.region,
                                        country: mappedCountry,
                                        city: sourceUser.ipCity,
                                        phoneNumber: String(sourceUser.phoneNumber), // <-- Convert to string
                                        momoNumber: sourceUser.momoNumber !== undefined && sourceUser.momoNumber !== null ? String(sourceUser.momoNumber) : undefined, // <-- Convert to string if exists
                                        momoOperator: sourceUser.momoCorrespondent,
                                        email: (_e = sourceUser.email) === null || _e === void 0 ? void 0 : _e.toLowerCase(),
                                        password: sourceUser.password, // Assign existing hash
                                        avatar: sourceUser.avatar,
                                        avatarId: sourceUser.avatarId,
                                        blocked: (_f = sourceUser.blocked) !== null && _f !== void 0 ? _f : false,
                                        debt: (_g = sourceUser.debt) !== null && _g !== void 0 ? _g : 0,
                                        flagged: (_h = sourceUser.flagged) !== null && _h !== void 0 ? _h : false,
                                        forceUnflagged: (_j = sourceUser.forceUnflagged) !== null && _j !== void 0 ? _j : false,
                                        forceFlagged: (_k = sourceUser.forceFlagged) !== null && _k !== void 0 ? _k : false,
                                        isVerified: (_l = sourceUser.isVerified) !== null && _l !== void 0 ? _l : false,
                                        role: TargetUserRole.USER,
                                        deleted: (_m = sourceUser.deleted) !== null && _m !== void 0 ? _m : false,
                                        deletedAt: sourceUser.deletedAt,
                                        deletionReason: sourceUser.deletionReason,
                                        contactsOtps: (((_o = sourceUser.contactsOtps) === null || _o === void 0 ? void 0 : _o.map(function (otp) { return ({ code: otp.code, expiration: otp.expiration }); })) || []),
                                        otps: (((_p = sourceUser.otps) === null || _p === void 0 ? void 0 : _p.map(function (otp) { return ({ code: otp.code, expiration: otp.expiration }); })) || []),
                                        ipAddress: sourceUser.ipAddress,
                                        ipCity: sourceUser.ipCity, ipRegion: sourceUser.ipRegion, ipCountry: sourceUser.ipCountry, ipLocation: sourceUser.ipLocation, ipOrg: sourceUser.ipOrg, ipLastUpdated: sourceUser.ipLastUpdated,
                                        referralCode: sourceUser.referralCode,
                                        balance: (_q = sourceUser.balance) !== null && _q !== void 0 ? _q : 0,
                                        sex: undefined, birthDate: undefined, language: [], preferenceCategories: [], interests: [], profession: undefined, shareContactInfo: true,
                                        createdAt: (_s = (_r = sourceUser._id) === null || _r === void 0 ? void 0 : _r.getTimestamp()) !== null && _s !== void 0 ? _s : new Date(), // Use ObjectId timestamp
                                    };
                                    if (!newUser.password) {
                                        // Handle users without passwords if necessary (e.g., generate one, or skip)
                                        console.warn("User ".concat(oldUserId, " (").concat(newUser.email, ") has no password hash in source. Skipping password field."));
                                    }
                                    userBatch_1.push(newUser);
                                    // Prepare Products for this user
                                    if (Array.isArray(sourceUser.product) && sourceUser.product.length > 0) {
                                        sourceUser.product.forEach(function (sourceProduct, index) {
                                            var _a, _b, _c, _d, _e;
                                            if (!sourceProduct || typeof sourceProduct !== 'object' || !sourceProduct.name)
                                                return;
                                            // DEBUG Log when processing one of the target user's products
                                            if (oldUserId === TARGET_USER_DEBUG_ID_1) {
                                                console.log("[DEBUG ".concat(TARGET_USER_DEBUG_ID_1, "] Processing OWN product at index ").concat(index, ": ").concat(sourceProduct.name));
                                            }
                                            var targetStatus = TargetProductStatus.PENDING;
                                            if (sourceProduct.accepted === true)
                                                targetStatus = TargetProductStatus.APPROVED;
                                            var productCreatedAt = (_c = (_b = (_a = sourceUser._id) === null || _a === void 0 ? void 0 : _a.getTimestamp()) !== null && _b !== void 0 ? _b : sourceProduct.createdAt) !== null && _c !== void 0 ? _c : new Date();
                                            var newProductData = {
                                                _originalUserId: oldUserId,
                                                _originalProductIndex: index, // Store the index within the user's product array
                                                // _sourceRatings: sourceProduct.ratings, // No longer needed directly here
                                                // userId will be added during batch processing after mapping
                                                name: sourceProduct.name,
                                                category: (_d = sourceProduct.category) === null || _d === void 0 ? void 0 : _d.toLowerCase(),
                                                subcategory: (_e = sourceProduct.subcategory) === null || _e === void 0 ? void 0 : _e.toLowerCase(),
                                                description: sourceProduct.description,
                                                imagesUrl: sourceProduct.imagesUrl || [],
                                                price: sourceProduct.price,
                                                ratings: [], // Initially empty, will be populated after rating migration
                                                overallRating: 0, // Initially 0, will be recalculated
                                                status: targetStatus,
                                                deleted: false,
                                                createdAt: productCreatedAt,
                                            };
                                            productBatch_1.push(newProductData);
                                            // --- Collect Pending Ratings Info ---
                                            if (Array.isArray(sourceProduct.ratings)) {
                                                for (var _i = 0, _f = sourceProduct.ratings; _i < _f.length; _i++) {
                                                    var sourceRating = _f[_i];
                                                    if (sourceRating && sourceRating.user && sourceRating.rating >= 1 && sourceRating.rating <= 5) {
                                                        pendingRatingsData_2.push({
                                                            oldRatingUserId: sourceRating.user.toString(),
                                                            oldProductOwnerId: oldUserId,
                                                            originalProductIndex: index,
                                                            ratingValue: sourceRating.rating,
                                                            createdAt: productCreatedAt // Use product creation time for rating time
                                                        });
                                                    }
                                                    else {
                                                        // Optional: Log skipped collection due to invalid source rating data
                                                        // console.warn(`Skipping collection of rating for product owner ${oldUserId}, index ${index} due to invalid source rating data:`, sourceRating);
                                                    }
                                                }
                                            }
                                        });
                                    }
                                    if (!(userBatch_1.length >= BATCH_SIZE || productBatch_1.length >= BATCH_SIZE)) return [3 /*break*/, 2];
                                    return [4 /*yield*/, processUserProductBatch()];
                                case 1:
                                    _w.sent();
                                    _w.label = 2;
                                case 2:
                                    if (usersProcessed % (BATCH_SIZE * 5) === 0) { // Log progress more frequently
                                        console.log("--- Progress: Processed ".concat(usersProcessed, " source users | Users Migrated: ").concat(usersMigrated_1, " | Products Migrated: ").concat(productsMigrated_1, " | Ratings Migrated: ").concat(ratingsMigrated, " ---"));
                                    }
                                    return [2 /*return*/];
                            }
                        });
                    };
                    _a = true, userCursor_1 = __asyncValues(userCursor);
                    _v.label = 7;
                case 7: return [4 /*yield*/, userCursor_1.next()];
                case 8:
                    if (!(userCursor_1_1 = _v.sent(), _b = userCursor_1_1.done, !_b)) return [3 /*break*/, 11];
                    return [5 /*yield**/, _loop_1()];
                case 9:
                    _v.sent();
                    _v.label = 10;
                case 10:
                    _a = true;
                    return [3 /*break*/, 7];
                case 11: return [3 /*break*/, 18];
                case 12:
                    e_1_1 = _v.sent();
                    e_1 = { error: e_1_1 };
                    return [3 /*break*/, 18];
                case 13:
                    _v.trys.push([13, , 16, 17]);
                    if (!(!_a && !_b && (_c = userCursor_1.return))) return [3 /*break*/, 15];
                    return [4 /*yield*/, _c.call(userCursor_1)];
                case 14:
                    _v.sent();
                    _v.label = 15;
                case 15: return [3 /*break*/, 17];
                case 16:
                    if (e_1) throw e_1.error;
                    return [7 /*endfinally*/];
                case 17: return [7 /*endfinally*/];
                case 18: 
                // Process any remaining users/products/ratings in the last batch
                return [4 /*yield*/, processUserProductBatch()];
                case 19:
                    // Process any remaining users/products/ratings in the last batch
                    _v.sent();
                    console.log("User/Product migration finished. Processed Users: ".concat(usersProcessed, ", Migrated Users: ").concat(usersMigrated_1, ", Migrated Products: ").concat(productsMigrated_1));
                    console.log("User ID Map size: ".concat(userIdMap.size));
                    console.log("Product Map size: ".concat(productMap_1.size));
                    console.log("Collected ".concat(pendingRatingsData_2.length, " potential ratings to process."));
                    // --- Phase 3: Process Collected Ratings ---
                    console.log('\nStarting Phase 3: Processing collected ratings...');
                    ratingBatchInsert = [];
                    productUpdatesMap = new Map();
                    processedRatingsCount = 0;
                    successfullyPreparedRatings = 0;
                    skippedRatingsCount = 0;
                    _i = 0, pendingRatingsData_1 = pendingRatingsData_2;
                    _v.label = 20;
                case 20:
                    if (!(_i < pendingRatingsData_1.length)) return [3 /*break*/, 27];
                    pendingRating = pendingRatingsData_1[_i];
                    processedRatingsCount++;
                    newRatingUserId = userIdMap.get(pendingRating.oldRatingUserId);
                    productMapKey = "".concat(pendingRating.oldProductOwnerId, "-").concat(pendingRating.originalProductIndex);
                    newProductId = productMap_1.get(productMapKey);
                    if (newRatingUserId && newProductId) {
                        newRating = {
                            _id: new mongoose_1.Types.ObjectId(),
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
                        productIdStr = newProductId.toString();
                        if (!productUpdatesMap.has(productIdStr)) {
                            productUpdatesMap.set(productIdStr, { newRatingIds: [], ratingSum: 0 });
                        }
                        productUpdateData = productUpdatesMap.get(productIdStr);
                        productUpdateData.newRatingIds.push(newRating._id);
                        productUpdateData.ratingSum += newRating.rating;
                    }
                    else {
                        // Log why it was skipped (user not mapped or product not mapped)
                        if (!newRatingUserId) {
                            // Minimal log to avoid flooding console, check previous logs for duplicate/failure details
                            // console.warn(`Skipping collected rating by ${pendingRating.oldRatingUserId}: User not mapped.`);
                        }
                        if (!newProductId) {
                            console.warn("Skipping collected rating by ".concat(pendingRating.oldRatingUserId, ": Product (Owner: ").concat(pendingRating.oldProductOwnerId, ", Index: ").concat(pendingRating.originalProductIndex, ") not mapped."));
                        }
                        skippedRatingsCount++;
                    }
                    if (!(ratingBatchInsert.length >= BATCH_SIZE)) return [3 /*break*/, 25];
                    console.log("Inserting rating batch of ".concat(ratingBatchInsert.length, "..."));
                    _v.label = 21;
                case 21:
                    _v.trys.push([21, 23, 24, 25]);
                    return [4 /*yield*/, TargetRating.insertMany(ratingBatchInsert, { ordered: false })];
                case 22:
                    ratingInsertResult = _v.sent();
                    ratingsMigrated += ratingInsertResult.length;
                    console.log(" -> Inserted ".concat(ratingInsertResult.length, " ratings."));
                    return [3 /*break*/, 25];
                case 23:
                    error_1 = _v.sent();
                    numInserted = ((_t = error_1.result) === null || _t === void 0 ? void 0 : _t.nInserted) || 0;
                    ratingsMigrated += numInserted;
                    console.error("Error inserting rating batch: ".concat(error_1.message));
                    if (error_1.name === 'MongoBulkWriteError' && error_1.writeErrors) {
                        console.warn(" -> Partially inserted ".concat(numInserted, " ratings due to errors."));
                        error_1.writeErrors.forEach(function (writeError) {
                            console.warn("  -> Failed rating insert: ".concat(writeError.errmsg));
                            // Note: Debug logs for specific user already exist here if needed
                        });
                    }
                    return [3 /*break*/, 25];
                case 24:
                    ratingBatchInsert.length = 0; // Clear the batch array
                    return [7 /*endfinally*/];
                case 25:
                    if (processedRatingsCount % (BATCH_SIZE * 10) === 0) {
                        console.log("Processed ".concat(processedRatingsCount, " collected ratings... Migrated: ").concat(ratingsMigrated, ", Skipped: ").concat(skippedRatingsCount));
                    }
                    _v.label = 26;
                case 26:
                    _i++;
                    return [3 /*break*/, 20];
                case 27:
                    if (!(ratingBatchInsert.length > 0)) return [3 /*break*/, 31];
                    console.log("Inserting final rating batch of ".concat(ratingBatchInsert.length, "..."));
                    _v.label = 28;
                case 28:
                    _v.trys.push([28, 30, , 31]);
                    return [4 /*yield*/, TargetRating.insertMany(ratingBatchInsert, { ordered: false })];
                case 29:
                    ratingInsertResult = _v.sent();
                    ratingsMigrated += ratingInsertResult.length;
                    console.log(" -> Inserted ".concat(ratingInsertResult.length, " final ratings."));
                    return [3 /*break*/, 31];
                case 30:
                    error_2 = _v.sent();
                    numInserted = ((_u = error_2.result) === null || _u === void 0 ? void 0 : _u.nInserted) || 0;
                    ratingsMigrated += numInserted;
                    console.error("Error inserting final rating batch: ".concat(error_2.message));
                    if (error_2.name === 'MongoBulkWriteError' && error_2.writeErrors) {
                        console.warn(" -> Partially inserted ".concat(numInserted, " ratings due to errors."));
                        error_2.writeErrors.forEach(function (writeError) {
                            console.warn("  -> Failed final rating insert: ".concat(writeError.errmsg));
                        });
                    }
                    return [3 /*break*/, 31];
                case 31:
                    console.log("Rating insertion finished. Total Processed: ".concat(processedRatingsCount, ", Prepared: ").concat(successfullyPreparedRatings, ", Actually Inserted: ").concat(ratingsMigrated, ", Skipped: ").concat(skippedRatingsCount));
                    // --- Phase 4: Update Products with Ratings ---
                    console.log('\nStarting Phase 4: Updating products with ratings...');
                    productUpdateOpsFinal_1 = [];
                    productUpdatesMap.forEach(function (updateData, productIdStr) {
                        if (updateData.newRatingIds.length > 0) {
                            var newOverallRating = updateData.ratingSum / updateData.newRatingIds.length;
                            productUpdateOpsFinal_1.push({
                                updateOne: {
                                    filter: { _id: new mongoose_1.Types.ObjectId(productIdStr) },
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
                    if (!(productUpdateOpsFinal_1.length > 0)) return [3 /*break*/, 36];
                    console.log("Preparing to update ".concat(productUpdateOpsFinal_1.length, " products with ratings info..."));
                    _v.label = 32;
                case 32:
                    _v.trys.push([32, 34, , 35]);
                    return [4 /*yield*/, TargetProduct_1.bulkWrite(productUpdateOpsFinal_1, { ordered: false })];
                case 33:
                    bulkWriteResult = _v.sent();
                    console.log(" -> Product BulkWrite result: Matched: ".concat(bulkWriteResult.matchedCount, ", Modified: ").concat(bulkWriteResult.modifiedCount));
                    if (bulkWriteResult.hasWriteErrors()) {
                        console.warn(' -> Encountered errors during product rating updates:');
                        bulkWriteResult.getWriteErrors().forEach(function (err) {
                            console.warn("  -> Index ".concat(err.index, ": ").concat(err.errmsg));
                        });
                    }
                    return [3 /*break*/, 35];
                case 34:
                    error_3 = _v.sent();
                    console.error("Error during final product bulk update for ratings: ".concat(error_3.message), error_3);
                    return [3 /*break*/, 35];
                case 35: return [3 /*break*/, 37];
                case 36:
                    console.log('No products needed rating updates.');
                    _v.label = 37;
                case 37:
                    console.log('Product rating updates finished.');
                    processBatch = function (modelName, cursor, targetModel, mapFunction, checkExistingFunction // Optional: Returns set of IDs/keys that already exist
                    ) { return __awaiter(_this, void 0, void 0, function () {
                        var batchData, processedCount, migratedCount, skippedCount, sourceDoc, mappedDoc, docsToInsert, result, error_7, e_2_1, docsToInsert, result, error_8;
                        var _a, cursor_1, cursor_1_1;
                        var _b, e_2, _c, _d;
                        var _e, _f, _g, _h, _j, _k;
                        return __generator(this, function (_l) {
                            switch (_l.label) {
                                case 0:
                                    console.log("\nMigrating ".concat(modelName, "..."));
                                    batchData = [];
                                    processedCount = 0;
                                    migratedCount = 0;
                                    skippedCount = 0;
                                    _l.label = 1;
                                case 1:
                                    _l.trys.push([1, 12, 13, 18]);
                                    _a = true, cursor_1 = __asyncValues(cursor);
                                    _l.label = 2;
                                case 2: return [4 /*yield*/, cursor_1.next()];
                                case 3:
                                    if (!(cursor_1_1 = _l.sent(), _b = cursor_1_1.done, !_b)) return [3 /*break*/, 11];
                                    _d = cursor_1_1.value;
                                    _a = false;
                                    sourceDoc = _d;
                                    processedCount++;
                                    mappedDoc = mapFunction(sourceDoc, userIdMap);
                                    if (mappedDoc) {
                                        batchData.push(mappedDoc);
                                    }
                                    else {
                                        skippedCount++;
                                    }
                                    if (!(batchData.length >= BATCH_SIZE)) return [3 /*break*/, 9];
                                    docsToInsert = batchData;
                                    if (checkExistingFunction) {
                                        console.warn("Skipping checkExistingFunction for ".concat(modelName, " in this batch implementation."));
                                    }
                                    _l.label = 4;
                                case 4:
                                    _l.trys.push([4, 6, 7, 8]);
                                    return [4 /*yield*/, targetModel.insertMany(docsToInsert, { ordered: false })];
                                case 5:
                                    result = _l.sent();
                                    migratedCount += result.length;
                                    return [3 /*break*/, 8];
                                case 6:
                                    error_7 = _l.sent();
                                    migratedCount += (_g = (_f = (_e = error_7.result) === null || _e === void 0 ? void 0 : _e.insertedIds) === null || _f === void 0 ? void 0 : _f.length) !== null && _g !== void 0 ? _g : 0;
                                    console.error("Error inserting ".concat(modelName, " batch: ").concat(error_7.message));
                                    if (error_7.name === 'MongoBulkWriteError' && error_7.writeErrors) {
                                        error_7.writeErrors.forEach(function (writeError) { return console.warn("  -> Failed ".concat(modelName, " insert: ").concat(writeError.errmsg)); });
                                    }
                                    return [3 /*break*/, 8];
                                case 7:
                                    batchData = []; // Clear batch
                                    return [7 /*endfinally*/];
                                case 8:
                                    console.log(" -> ".concat(modelName, ": Processed ").concat(processedCount, ", Migrated ").concat(migratedCount, ", Skipped ").concat(skippedCount));
                                    _l.label = 9;
                                case 9:
                                    if (processedCount % (BATCH_SIZE * 10) === 0) {
                                        console.log("Processed ".concat(processedCount, " source ").concat(modelName, "..."));
                                    }
                                    _l.label = 10;
                                case 10:
                                    _a = true;
                                    return [3 /*break*/, 2];
                                case 11: return [3 /*break*/, 18];
                                case 12:
                                    e_2_1 = _l.sent();
                                    e_2 = { error: e_2_1 };
                                    return [3 /*break*/, 18];
                                case 13:
                                    _l.trys.push([13, , 16, 17]);
                                    if (!(!_a && !_b && (_c = cursor_1.return))) return [3 /*break*/, 15];
                                    return [4 /*yield*/, _c.call(cursor_1)];
                                case 14:
                                    _l.sent();
                                    _l.label = 15;
                                case 15: return [3 /*break*/, 17];
                                case 16:
                                    if (e_2) throw e_2.error;
                                    return [7 /*endfinally*/];
                                case 17: return [7 /*endfinally*/];
                                case 18:
                                    if (!(batchData.length > 0)) return [3 /*break*/, 22];
                                    docsToInsert = batchData;
                                    if (checkExistingFunction) {
                                        console.warn("Skipping checkExistingFunction for ".concat(modelName, " in final batch."));
                                    }
                                    _l.label = 19;
                                case 19:
                                    _l.trys.push([19, 21, , 22]);
                                    return [4 /*yield*/, targetModel.insertMany(docsToInsert, { ordered: false })];
                                case 20:
                                    result = _l.sent();
                                    migratedCount += result.length;
                                    return [3 /*break*/, 22];
                                case 21:
                                    error_8 = _l.sent();
                                    migratedCount += (_k = (_j = (_h = error_8.result) === null || _h === void 0 ? void 0 : _h.insertedIds) === null || _j === void 0 ? void 0 : _j.length) !== null && _k !== void 0 ? _k : 0;
                                    console.error("Error inserting final ".concat(modelName, " batch: ").concat(error_8.message));
                                    if (error_8.name === 'MongoBulkWriteError' && error_8.writeErrors) {
                                        error_8.writeErrors.forEach(function (writeError) { return console.warn("  -> Failed final ".concat(modelName, " insert: ").concat(writeError.errmsg)); });
                                    }
                                    return [3 /*break*/, 22];
                                case 22:
                                    console.log("".concat(modelName, " migration finished. Processed: ").concat(processedCount, ", Migrated: ").concat(migratedCount, ", Skipped: ").concat(skippedCount));
                                    return [2 /*return*/];
                            }
                        });
                    }); };
                    transactionCursor = SourceTransaction.find().cursor();
                    mapTransaction = function (sourceTx, map) {
                        var _a, _b, _c, _d;
                        var oldUserId = (_a = sourceTx.userId) === null || _a === void 0 ? void 0 : _a.toString();
                        var newUserId = oldUserId ? map.get(oldUserId) : undefined;
                        if (!newUserId)
                            return null; // Skip if user mapping failed
                        var targetType = TargetTransactionType.FEE; // Default
                        if (sourceTx.transType === 'deposit')
                            targetType = TargetTransactionType.DEPOSIT;
                        else if (sourceTx.transType === 'withdrawal')
                            targetType = TargetTransactionType.WITHDRAWAL;
                        var amountNumber = null;
                        if (typeof sourceTx.amount === 'string') {
                            try {
                                amountNumber = parseFloat(sourceTx.amount);
                                if (isNaN(amountNumber))
                                    throw new Error();
                            }
                            catch (_e) {
                                return null; /* Skip invalid amount */
                            }
                        }
                        else if (typeof sourceTx.amount === 'number') {
                            amountNumber = sourceTx.amount;
                        }
                        else
                            return null; // Skip missing/invalid amount
                        var targetStatus = TargetTransactionStatus.PENDING;
                        var sourceStatusLower = (_b = sourceTx.status) === null || _b === void 0 ? void 0 : _b.toLowerCase();
                        if (sourceStatusLower === 'completed' || sourceStatusLower === 'success' || sourceStatusLower === 'successful')
                            targetStatus = TargetTransactionStatus.COMPLETED;
                        else if (sourceStatusLower === 'failed' || sourceStatusLower === 'failure')
                            targetStatus = TargetTransactionStatus.FAILED;
                        else if (sourceStatusLower === 'cancelled' || sourceStatusLower === 'canceled')
                            targetStatus = TargetTransactionStatus.CANCELLED;
                        return {
                            transactionId: (0, uuid_1.v4)(), userId: newUserId, type: targetType, amount: amountNumber, currency: TargetCurrency.XAF, fee: 0, status: targetStatus,
                            description: sourceTx.message || "Migrated ".concat(targetType), externalTransactionId: sourceTx.transId, deleted: false,
                            createdAt: (_d = (_c = sourceTx._id) === null || _c === void 0 ? void 0 : _c.getTimestamp()) !== null && _d !== void 0 ? _d : new Date(), // Use ObjectId timestamp
                        };
                    };
                    return [4 /*yield*/, processBatch('Transactions', transactionCursor, TargetTransaction, mapTransaction)];
                case 38:
                    _v.sent();
                    subscriptionCursor = SourceSubscribe.find().cursor();
                    mapSubscription = function (sourceSub, map) {
                        var _a, _b;
                        var oldUserId = (_a = sourceSub.user) === null || _a === void 0 ? void 0 : _a.toString();
                        var newUserId = oldUserId ? map.get(oldUserId) : undefined;
                        if (!newUserId) {
                            console.warn("Skipping subscription for source user ".concat(oldUserId, " as they weren't mapped."));
                            return null;
                        }
                        var targetSubscriptionType = null;
                        if (sourceSub.plan === '1')
                            targetSubscriptionType = TargetSubscriptionType.CLASSIQUE;
                        else if (sourceSub.plan === '2' || sourceSub.plan === '3')
                            targetSubscriptionType = TargetSubscriptionType.CIBLE;
                        else {
                            console.warn("Skipping subscription for user ".concat(newUserId, " due to unknown source plan: ").concat(sourceSub.plan));
                            return null; // Skip unknown plan
                        }
                        var startDate = (_b = sourceSub._id) === null || _b === void 0 ? void 0 : _b.getTimestamp(); // Use ObjectId timestamp for start date
                        if (!startDate) {
                            console.warn("Skipping subscription for user ".concat(newUserId, " because source _id timestamp couldn't be determined."));
                            return null; // Skip missing date
                        }
                        // Make subscription lifetime and active
                        var endDate = new Date('9999-12-31T23:59:59.999Z'); // Far future date
                        var status = TargetSubscriptionStatus.ACTIVE;
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
                    return [4 /*yield*/, processBatch('Subscriptions', subscriptionCursor, TargetSubscription, mapSubscription)];
                case 39:
                    // Optional: Add checkExisting function for Subscriptions if needed
                    _v.sent();
                    referralCursor = SourceReferral.find().cursor();
                    mapReferral = function (sourceRef, map) {
                        var _a, _b, _c, _d, _e;
                        var oldReferrerId = (_a = sourceRef.referrer) === null || _a === void 0 ? void 0 : _a.toString();
                        var oldReferredUserId = (_b = sourceRef.referredUser) === null || _b === void 0 ? void 0 : _b.toString();
                        var newReferrerId = oldReferrerId ? map.get(oldReferrerId) : undefined;
                        var newReferredUserId = oldReferredUserId ? map.get(oldReferredUserId) : undefined;
                        if (!newReferrerId || !newReferredUserId || newReferrerId.equals(newReferredUserId))
                            return null; // Skip if mapping failed or self-referral
                        var referralLevel = sourceRef.referralLevel;
                        if (typeof referralLevel !== 'number' || referralLevel < 1 || referralLevel > 3)
                            return null; // Skip invalid level
                        return {
                            referrer: newReferrerId, referredUser: newReferredUserId, referralLevel: referralLevel,
                            archived: (_c = sourceRef.archived) !== null && _c !== void 0 ? _c : false, archivedAt: sourceRef.archivedAt,
                            createdAt: (_e = (_d = sourceRef._id) === null || _d === void 0 ? void 0 : _d.getTimestamp()) !== null && _e !== void 0 ? _e : new Date(), // Use ObjectId timestamp
                        };
                    };
                    // Optional: Add checkExisting function for Referrals if needed
                    return [4 /*yield*/, processBatch('Referrals', referralCursor, TargetReferral, mapReferral)];
                case 40:
                    // Optional: Add checkExisting function for Referrals if needed
                    _v.sent();
                    console.log('\nMigration completed successfully!');
                    return [3 /*break*/, 47];
                case 41:
                    error_4 = _v.sent();
                    console.error('\nMigration failed:', error_4);
                    return [3 /*break*/, 47];
                case 42:
                    console.log('\nClosing database connections...');
                    return [4 /*yield*/, (sourceConn === null || sourceConn === void 0 ? void 0 : sourceConn.close())];
                case 43:
                    _v.sent();
                    return [4 /*yield*/, (userConn === null || userConn === void 0 ? void 0 : userConn.close())];
                case 44:
                    _v.sent();
                    return [4 /*yield*/, (paymentConn === null || paymentConn === void 0 ? void 0 : paymentConn.close())];
                case 45:
                    _v.sent();
                    return [4 /*yield*/, (productConn === null || productConn === void 0 ? void 0 : productConn.close())];
                case 46:
                    _v.sent();
                    console.log('Connections closed.');
                    return [7 /*endfinally*/];
                case 47: return [2 /*return*/];
            }
        });
    });
}
// --- Run the Migration ---
runMigration().catch(function (err) {
    console.error("Unhandled error during migration script execution:", err);
    process.exit(1);
});
