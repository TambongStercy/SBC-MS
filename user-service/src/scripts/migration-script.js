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
var url_1 = require("url"); // For parsing URLs
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
// Add partner pack enum
var TargetPartnerPack;
(function (TargetPartnerPack) {
    TargetPartnerPack["SILVER"] = "silver";
    TargetPartnerPack["GOLD"] = "gold";
})(TargetPartnerPack || (TargetPartnerPack = {}));
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
    TargetTransactionType["PARTNER_EARNINGS"] = "partner_earnings";
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
    imagesUrl: [String], // Old field
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
    avatar: String, // Source avatar URL
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
// Add SourcePartnerSchema
var SourcePartnerSchema = new mongoose_1.Schema({
    _id: mongoose_1.Schema.Types.ObjectId,
    user: { type: mongoose_1.Schema.Types.ObjectId, ref: 'user' },
    pack: String,
    amount: Number,
    isActive: Boolean,
    createdAt: Date,
    updatedAt: Date
}, { strict: false, collection: 'partners' });
// Add SourcePartnerTransactionSchema
var SourcePartnerTransactionSchema = new mongoose_1.Schema({
    _id: mongoose_1.Schema.Types.ObjectId,
    partnerId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'partner' },
    user: { type: mongoose_1.Schema.Types.ObjectId, ref: 'user' },
    pack: String,
    transType: String,
    message: String,
    amount: String,
    date: Date,
    createdAt: Date,
    updatedAt: Date
}, { strict: false, collection: 'partnertransactions' });
// --- Country Code Mapping ---
// Note: Prefixes are strings, numbers will be converted for checking
var countryCodePrefixes = {
    'DZ': ['213'], 'AO': ['244'], 'BJ': ['229'], 'BW': ['267'], 'BF': ['226'], 'BI': ['257'], 'CV': ['238'], 'CM': ['237'], 'CF': ['236'], 'TD': ['235'], 'KM': ['269'], 'CD': ['243'], 'CG': ['242'], 'CI': ['225'], 'DJ': ['253'], 'EG': ['20'], 'GQ': ['240'], 'ER': ['291'], 'SZ': ['268'], 'ET': ['251'], 'GA': ['241'], 'GM': ['220'], 'GH': ['233'], 'GN': ['224'], 'GW': ['245'], 'KE': ['254'], 'LS': ['266'], 'LR': ['231'], 'LY': ['218'], 'MG': ['261'], 'MW': ['265'], 'ML': ['223'], 'MR': ['222'], 'MU': ['230'], 'MA': ['212'], 'MZ': ['258'], 'NA': ['264'], 'NE': ['227'], 'NG': ['234'], 'RW': ['250'], 'ST': ['239'], 'SN': ['221'], 'SC': ['248'], 'SL': ['232'], 'SO': ['252'], 'ZA': ['27'], 'SS': ['211'], 'SD': ['249'], 'TZ': ['255'], 'TG': ['228'], 'TN': ['216'], 'UG': ['256'], 'ZM': ['260'], 'ZW': ['263'],
};
// Helper function to get country ISO code from phone number (handles number or string type from source)
function getCountryFromPhoneNumber(phoneNumber, momoNumber) {
    var numbersToCheck = [phoneNumber, momoNumber];
    for (var _i = 0, numbersToCheck_1 = numbersToCheck; _i < numbersToCheck_1.length; _i++) {
        var num = numbersToCheck_1[_i];
        if (num !== undefined && num !== null) {
            var numStr = String(num);
            for (var _a = 0, _b = Object.entries(countryCodePrefixes); _a < _b.length; _a++) {
                var _c = _b[_a], isoCode = _c[0], prefixes = _c[1];
                for (var _d = 0, prefixes_1 = prefixes; _d < prefixes_1.length; _d++) {
                    var prefix = prefixes_1[_d];
                    if (numStr.startsWith(prefix)) {
                        return isoCode;
                    }
                }
            }
        }
    }
    return undefined;
}
// Helper function to parse old image URL and extract file ID
function parseLegacyUrl(imageUrl) {
    try {
        // Check if it's the expected legacy URL format
        if (!imageUrl.includes('onrender.com/image?id=')) {
            return null; // Not the format we need to parse
        }
        var parsed = new url_1.URL(imageUrl);
        if (parsed.searchParams.has('id')) {
            return parsed.searchParams.get('id');
        }
    }
    catch (e) {
        // console.warn(`Could not parse URL: ${imageUrl}`, e); // Optional: more verbose logging
    }
    return null;
}
// --- Main Migration Function ---
function runMigration() {
    return __awaiter(this, void 0, void 0, function () {
        var sourceConn, userConn, paymentConn, productConn, userIdMap, partnerIdMap, SourceUser, SourceTransaction, SourceSubscribe, SourceReferral, SourcePartner, SourcePartnerTransaction, TargetOtpSchema, TargetUserSchema, TargetUser_1, TargetProductImageSchema, TargetProductSchema, TargetProduct_1, TargetPaymentProviderDataSchema, TargetTransactionSchema, TargetTransaction, TargetSubscriptionSchema, TargetSubscription, TargetReferralSchema, TargetReferral, TargetPartnerSchema, TargetPartner, TargetPartnerTransactionSchema, TargetPartnerTransaction, TargetRatingSchema, TargetRating, userBatch_1, productBatch_1, usersProcessed, usersMigrated_1, productsMigrated_1, ratingsMigrated, productMap_1, userCursor, pendingRatingsData_2, TARGET_USER_DEBUG_ID_1, processUserProductBatch, _loop_1, _a, userCursor_1, userCursor_1_1, e_1_1, ratingBatchInsert, productUpdatesMap, processedRatingsCount, successfullyPreparedRatings, skippedRatingsCount, _i, pendingRatingsData_1, pendingRating, newRatingUserId, productMapKey, newProductId, newRating, productIdStr, productUpdateData, ratingInsertResult, error_1, numInserted, ratingInsertResult, error_2, numInserted, productUpdateOpsFinal_1, bulkWriteResult, error_3, processBatch, transactionCursor, mapTransaction, subscriptionCursor, mapSubscription, referralCursor, mapReferral, partnerCursor, partnersProcessed, partnersMigrated, usersWithPartnerStatus, PACK_PERCENTAGE_RATES, partnerTxCursor, partnerTransactions, _b, partnerTxCursor_1, partnerTxCursor_1_1, sourceTx, oldPartnerId, amountNumber, packValue, percentageRate, recalculatedAmount, partnerTxData, e_2_1, _c, partnerCursor_1, partnerCursor_1_1, sourcePartner, oldPartnerId, oldUserId, newUserId, packValue, partnerPack, partnerTxData, correctedTotalAmount, newPartner, error_4, e_3_1, partnerTxProcessed, partnerTxMigrated, partnerSpecificTxMigrated, partnerIds, _d, partnerIds_1, oldPartnerId, partnerTxData, newPartnerId, _e, _f, txData, oldUserId, newUserId, error_5, error_6;
        var _this = this;
        var _g, e_1, _h, _j, _k, e_2, _l, _m, _o, e_3, _p, _q;
        var _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6, _7, _8, _9, _10, _11, _12, _13, _14;
        return __generator(this, function (_15) {
            switch (_15.label) {
                case 0:
                    console.log('Starting migration...');
                    sourceConn = null;
                    userConn = null;
                    paymentConn = null;
                    productConn = null;
                    userIdMap = new Map();
                    partnerIdMap = new Map();
                    _15.label = 1;
                case 1:
                    _15.trys.push([1, 78, 79, 84]);
                    // --- Connect to Databases ---
                    console.log('Connecting to databases...');
                    return [4 /*yield*/, mongoose_1.default.createConnection(SOURCE_DB_URI).asPromise()];
                case 2:
                    sourceConn = _15.sent();
                    return [4 /*yield*/, mongoose_1.default.createConnection(USER_SERVICE_DB_URI).asPromise()];
                case 3:
                    userConn = _15.sent();
                    return [4 /*yield*/, mongoose_1.default.createConnection(PAYMENT_SERVICE_DB_URI).asPromise()];
                case 4:
                    paymentConn = _15.sent();
                    return [4 /*yield*/, mongoose_1.default.createConnection(PRODUCT_SERVICE_DB_URI).asPromise()];
                case 5:
                    productConn = _15.sent();
                    console.log('Database connections established.');
                    SourceUser = sourceConn.model('SourceUser', SourceUserSchema);
                    SourceTransaction = sourceConn.model('SourceTransaction', SourceTransactionSchema);
                    SourceSubscribe = sourceConn.model('SourceSubscribe', SourceSubscribeSchema);
                    SourceReferral = sourceConn.model('SourceReferral', SourceReferralSchema);
                    SourcePartner = sourceConn.model('SourcePartner', SourcePartnerSchema);
                    SourcePartnerTransaction = sourceConn.model('SourcePartnerTransaction', SourcePartnerTransactionSchema);
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
                        avatar: { type: String }, // Will store new format: /settings/files/FILE_ID
                        avatarId: { type: String }, // Will store extracted FILE_ID
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
                        createdAt: Date,
                        updatedAt: Date,
                        partnerPack: { type: String, enum: Object.values(TargetPartnerPack), index: true }, // Add partner pack field
                    }, { timestamps: true, collection: 'users' });
                    TargetUser_1 = userConn.model('User', TargetUserSchema);
                    TargetProductImageSchema = new mongoose_1.Schema({
                        url: { type: String, required: true },
                        fileId: { type: String, required: true },
                    }, { _id: false });
                    TargetProductSchema = new mongoose_1.Schema({
                        userId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
                        name: { type: String, required: true, trim: true },
                        category: { type: String, required: true, trim: true, lowercase: true, index: true },
                        subcategory: { type: String, required: true, trim: true, lowercase: true, index: true },
                        description: { type: String, required: true, trim: true },
                        images: [TargetProductImageSchema], // New field for structured image data
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
                    TargetPartnerSchema = new mongoose_1.Schema({
                        user: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
                        pack: { type: String, enum: Object.values(TargetPartnerPack), required: true },
                        amount: { type: Number, default: 0 },
                        isActive: { type: Boolean, default: true },
                    }, { timestamps: true, collection: 'partners' });
                    TargetPartner = userConn.model('Partner', TargetPartnerSchema);
                    TargetPartnerTransactionSchema = new mongoose_1.Schema({
                        partnerId: {
                            type: mongoose_1.Schema.Types.ObjectId,
                            ref: 'Partner',
                            required: true,
                            index: true,
                        },
                        user: {
                            type: mongoose_1.Schema.Types.ObjectId,
                            ref: 'User',
                            required: true,
                            index: true,
                        },
                        pack: {
                            type: String,
                            enum: ['silver', 'gold'],
                            required: true,
                        },
                        transType: {
                            type: String,
                            enum: ['deposit', 'withdrawal'],
                            required: true,
                        },
                        message: {
                            type: String,
                            required: true,
                        },
                        amount: {
                            type: Number,
                            required: true,
                        },
                        sourcePaymentSessionId: {
                            type: String,
                            required: false,
                        },
                        sourceSubscriptionType: {
                            type: String,
                            enum: Object.values(TargetSubscriptionType),
                            required: false,
                        },
                        referralLevelInvolved: {
                            type: Number,
                            enum: [1, 2, 3],
                            required: false,
                        },
                    }, { timestamps: true, collection: 'partnertransactions' });
                    TargetPartnerTransaction = userConn.model('PartnerTransaction', TargetPartnerTransactionSchema);
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
                        var currentUserBatch, userInsertResult, error_7, numInserted, insertedIdsMap, indexStr, index, insertedId, originalSourceUser, productInsertResult, productDataToInsert, cleanProductData, error_8, numInserted, insertedIdsMap, indexStr, index, insertedId, originalProductData, mapKey;
                        var _this = this;
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0:
                                    if (userBatch_1.length === 0 && productBatch_1.length === 0)
                                        return [2 /*return*/];
                                    currentUserBatch = __spreadArray([], userBatch_1, true);
                                    userBatch_1 = [];
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
                                    error_7 = _a.sent();
                                    console.error("Error inserting user batch: ".concat(error_7.message));
                                    if (error_7.name === 'MongoBulkWriteError' && error_7.result) {
                                        numInserted = error_7.result.nInserted || 0;
                                        usersMigrated_1 += numInserted;
                                        console.warn(" -> Partially inserted ".concat(numInserted, " users due to errors."));
                                        insertedIdsMap = error_7.result.insertedIds || {};
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
                                        if (error_7.writeErrors) {
                                            error_7.writeErrors.forEach(function (writeError) { return __awaiter(_this, void 0, void 0, function () {
                                                var failedUserIndex, failedUser, oldUserId, conflictingKey, conflictingValue, existingUser, lookupError_1;
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
                                                            existingUser = _b.sent();
                                                            if (!!existingUser) return [3 /*break*/, 6];
                                                            if (!(conflictingKey === 'phoneNumber' && failedUser.email)) return [3 /*break*/, 4];
                                                            return [4 /*yield*/, TargetUser_1.findOne({ email: failedUser.email.toLowerCase() }).select('_id').lean()];
                                                        case 3:
                                                            existingUser = _b.sent();
                                                            return [3 /*break*/, 6];
                                                        case 4:
                                                            if (!(conflictingKey === 'email' && failedUser.phoneNumber)) return [3 /*break*/, 6];
                                                            return [4 /*yield*/, TargetUser_1.findOne({ phoneNumber: String(failedUser.phoneNumber) }).select('_id').lean()];
                                                        case 5:
                                                            existingUser = _b.sent();
                                                            _b.label = 6;
                                                        case 6:
                                                            if (existingUser) {
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
                                        console.error(' -> Unhandled error during user batch insert:', error_7);
                                    }
                                    return [3 /*break*/, 4];
                                case 4:
                                    productInsertResult = [];
                                    productDataToInsert = productBatch_1.filter(function (p) { return userIdMap.has(p._originalUserId); });
                                    productBatch_1 = []; // Clear global product batch for next iteration
                                    if (!(productDataToInsert.length > 0)) return [3 /*break*/, 8];
                                    console.log("Processing product batch of ".concat(productDataToInsert.length, "..."));
                                    cleanProductData = productDataToInsert.map(function (_a) {
                                        var _originalUserId = _a._originalUserId, _originalProductIndex = _a._originalProductIndex, rest = __rest(_a, ["_originalUserId", "_originalProductIndex"]);
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
                                    productInsertResult.forEach(function (insertedProduct, index) {
                                        var originalProductData = productDataToInsert[index];
                                        if (originalProductData) {
                                            var mapKey = "".concat(originalProductData._originalUserId, "-").concat(originalProductData._originalProductIndex);
                                            productMap_1.set(mapKey, insertedProduct._id);
                                        }
                                    });
                                    return [3 /*break*/, 8];
                                case 7:
                                    error_8 = _a.sent();
                                    if (error_8.name === 'MongoBulkWriteError' && error_8.result) {
                                        numInserted = error_8.result.nInserted || 0;
                                        productsMigrated_1 += numInserted;
                                        console.warn(" -> Partially inserted ".concat(numInserted, " products due to errors."));
                                        insertedIdsMap = error_8.result.insertedIds || {};
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
                                        if (error_8.writeErrors) {
                                            error_8.writeErrors.forEach(function (writeError) {
                                                var failedProductData = productDataToInsert[writeError.index];
                                                console.warn("  -> Failed product insert (Index ".concat(writeError.index, "): ").concat(writeError.errmsg, ". Original User ID: ").concat(failedProductData === null || failedProductData === void 0 ? void 0 : failedProductData._originalUserId, ", Product Name: ").concat(failedProductData === null || failedProductData === void 0 ? void 0 : failedProductData.name));
                                            });
                                        }
                                    }
                                    else {
                                        console.error("Error inserting product batch: ".concat(error_8.message), error_8);
                                    }
                                    return [3 /*break*/, 8];
                                case 8: return [2 /*return*/];
                            }
                        });
                    }); };
                    _15.label = 6;
                case 6:
                    _15.trys.push([6, 12, 13, 18]);
                    _loop_1 = function () {
                        var sourceUser, oldUserId, mappedCountry, newAvatarUrl, newAvatarId, fileId, newUser;
                        return __generator(this, function (_17) {
                            switch (_17.label) {
                                case 0:
                                    _j = userCursor_1_1.value;
                                    _a = false;
                                    sourceUser = _j;
                                    usersProcessed++;
                                    if (!(sourceUser === null || sourceUser === void 0 ? void 0 : sourceUser._id) || !sourceUser.email) {
                                        console.warn("Skipping user record without _id or email at index ".concat(usersProcessed, ":"), sourceUser._id);
                                        return [2 /*return*/, "continue"];
                                    }
                                    oldUserId = sourceUser._id.toString();
                                    if (oldUserId === TARGET_USER_DEBUG_ID_1) {
                                        console.log("[DEBUG ".concat(TARGET_USER_DEBUG_ID_1, "] Processing source user ").concat(oldUserId, "..."));
                                    }
                                    mappedCountry = getCountryFromPhoneNumber(sourceUser.phoneNumber, sourceUser.momoNumber);
                                    newAvatarUrl = undefined;
                                    newAvatarId = undefined;
                                    if (sourceUser.avatar && typeof sourceUser.avatar === 'string') {
                                        fileId = parseLegacyUrl(sourceUser.avatar);
                                        if (fileId) {
                                            newAvatarUrl = "/settings/files/".concat(fileId);
                                            newAvatarId = fileId;
                                        }
                                        else {
                                            newAvatarUrl = sourceUser.avatar; // Keep original if parsing fails or not a legacy URL
                                            newAvatarId = sourceUser.avatarId; // Keep original avatarId
                                            // Only log warning if it looked like a legacy URL but failed parsing
                                            if (sourceUser.avatar.includes('onrender.com/image?id=')) {
                                                console.warn("Could not parse legacy avatar URL for user ".concat(oldUserId, ": ").concat(sourceUser.avatar, ". Using original."));
                                            }
                                        }
                                    }
                                    else {
                                        newAvatarUrl = sourceUser.avatar; // Handles undefined or non-string types gracefully
                                        newAvatarId = sourceUser.avatarId;
                                    }
                                    newUser = {
                                        _id: sourceUser._id, // Will be replaced by mongoose upon insertion if not using old IDs
                                        name: sourceUser.name,
                                        region: sourceUser.region,
                                        country: mappedCountry,
                                        city: sourceUser.ipCity,
                                        phoneNumber: String(sourceUser.phoneNumber),
                                        momoNumber: sourceUser.momoNumber !== undefined && sourceUser.momoNumber !== null ? String(sourceUser.momoNumber) : undefined,
                                        momoOperator: sourceUser.momoCorrespondent,
                                        email: (_r = sourceUser.email) === null || _r === void 0 ? void 0 : _r.toLowerCase(),
                                        password: sourceUser.password,
                                        avatar: newAvatarUrl, // Use migrated URL
                                        avatarId: newAvatarId, // Use extracted fileId
                                        blocked: (_s = sourceUser.blocked) !== null && _s !== void 0 ? _s : false,
                                        debt: (_t = sourceUser.debt) !== null && _t !== void 0 ? _t : 0,
                                        flagged: (_u = sourceUser.flagged) !== null && _u !== void 0 ? _u : false,
                                        forceUnflagged: (_v = sourceUser.forceUnflagged) !== null && _v !== void 0 ? _v : false,
                                        forceFlagged: (_w = sourceUser.forceFlagged) !== null && _w !== void 0 ? _w : false,
                                        isVerified: (_x = sourceUser.isVerified) !== null && _x !== void 0 ? _x : false,
                                        role: TargetUserRole.USER,
                                        deleted: (_y = sourceUser.deleted) !== null && _y !== void 0 ? _y : false,
                                        deletedAt: sourceUser.deletedAt,
                                        deletionReason: sourceUser.deletionReason,
                                        contactsOtps: (((_z = sourceUser.contactsOtps) === null || _z === void 0 ? void 0 : _z.map(function (otp) { return ({ code: otp.code, expiration: otp.expiration }); })) || []),
                                        otps: (((_0 = sourceUser.otps) === null || _0 === void 0 ? void 0 : _0.map(function (otp) { return ({ code: otp.code, expiration: otp.expiration }); })) || []),
                                        ipAddress: sourceUser.ipAddress,
                                        ipCity: sourceUser.ipCity, ipRegion: sourceUser.ipRegion, ipCountry: sourceUser.ipCountry, ipLocation: sourceUser.ipLocation, ipOrg: sourceUser.ipOrg, ipLastUpdated: sourceUser.ipLastUpdated,
                                        referralCode: sourceUser.referralCode,
                                        balance: (_1 = sourceUser.balance) !== null && _1 !== void 0 ? _1 : 0,
                                        sex: undefined, birthDate: undefined, language: [], preferenceCategories: [], interests: [], profession: undefined, shareContactInfo: true,
                                        createdAt: (_3 = (_2 = sourceUser._id) === null || _2 === void 0 ? void 0 : _2.getTimestamp()) !== null && _3 !== void 0 ? _3 : new Date(), // Use ObjectId timestamp
                                    };
                                    if (!newUser.password) {
                                        console.warn("User ".concat(oldUserId, " (").concat(newUser.email, ") has no password hash in source. Skipping password field."));
                                    }
                                    userBatch_1.push(newUser);
                                    // Prepare Products for this user, integrating image migration logic
                                    if (Array.isArray(sourceUser.product) && sourceUser.product.length > 0) {
                                        sourceUser.product.forEach(function (sourceProduct, index) {
                                            var _a, _b, _c, _d, _e;
                                            if (!sourceProduct || typeof sourceProduct !== 'object' || !sourceProduct.name)
                                                return;
                                            if (oldUserId === TARGET_USER_DEBUG_ID_1) {
                                                console.log("[DEBUG ".concat(TARGET_USER_DEBUG_ID_1, "] Processing OWN product at index ").concat(index, ": ").concat(sourceProduct.name));
                                            }
                                            var newProductImages = [];
                                            var productStatus = TargetProductStatus.PENDING; // Default status
                                            var migratedLegacyImages = false; // Flag to track if legacy URLs were processed
                                            // Set initial status based on 'accepted' from source
                                            if (sourceProduct.accepted === true) {
                                                productStatus = TargetProductStatus.APPROVED;
                                            }
                                            // Migrate imagesUrl to new images structure
                                            if (Array.isArray(sourceProduct.imagesUrl) && sourceProduct.imagesUrl.length > 0) {
                                                for (var _i = 0, _f = sourceProduct.imagesUrl; _i < _f.length; _i++) {
                                                    var imageUrl = _f[_i];
                                                    if (typeof imageUrl === 'string') {
                                                        var fileId = parseLegacyUrl(imageUrl);
                                                        if (fileId) {
                                                            newProductImages.push({
                                                                fileId: fileId,
                                                                url: "/settings/files/".concat(fileId)
                                                            });
                                                            migratedLegacyImages = true; // Mark that we processed at least one legacy URL
                                                        }
                                                        else {
                                                            // Only log warning if it looked like a legacy URL but failed parsing
                                                            if (imageUrl.includes('onrender.com/image?id=')) {
                                                                console.warn("Could not extract fileId from product image URL: ".concat(imageUrl, " for product of user ").concat(oldUserId));
                                                            }
                                                        }
                                                    }
                                                }
                                                // If images were successfully migrated from legacy format, set status to APPROVED
                                                // This overrides the status set by `sourceProduct.accepted`.
                                                if (migratedLegacyImages) {
                                                    productStatus = TargetProductStatus.APPROVED;
                                                }
                                            }
                                            var productCreatedAt = (_c = (_b = (_a = sourceUser._id) === null || _a === void 0 ? void 0 : _a.getTimestamp()) !== null && _b !== void 0 ? _b : sourceProduct.createdAt) !== null && _c !== void 0 ? _c : new Date();
                                            var newProductData = {
                                                _originalUserId: oldUserId,
                                                _originalProductIndex: index,
                                                name: sourceProduct.name,
                                                category: (_d = sourceProduct.category) === null || _d === void 0 ? void 0 : _d.toLowerCase(),
                                                subcategory: (_e = sourceProduct.subcategory) === null || _e === void 0 ? void 0 : _e.toLowerCase(),
                                                description: sourceProduct.description,
                                                images: newProductImages, // Use new images array
                                                price: sourceProduct.price,
                                                ratings: [], // Ratings will be populated in a later phase
                                                overallRating: 0, // Overall rating will be recalculated later
                                                status: productStatus, // Use determined status
                                                deleted: false,
                                                createdAt: productCreatedAt,
                                            };
                                            productBatch_1.push(newProductData); // Cast as any to satisfy batch type temporarily
                                            // Collect rating info for later processing
                                            if (Array.isArray(sourceProduct.ratings)) {
                                                for (var _g = 0, _h = sourceProduct.ratings; _g < _h.length; _g++) {
                                                    var sourceRating = _h[_g];
                                                    if (sourceRating && sourceRating.user && sourceRating.rating >= 1 && sourceRating.rating <= 5) {
                                                        pendingRatingsData_2.push({
                                                            oldRatingUserId: sourceRating.user.toString(),
                                                            oldProductOwnerId: oldUserId,
                                                            originalProductIndex: index,
                                                            ratingValue: sourceRating.rating,
                                                            createdAt: productCreatedAt // Use product creation time for rating time
                                                        });
                                                    }
                                                }
                                            }
                                        });
                                    }
                                    if (!(userBatch_1.length >= BATCH_SIZE || productBatch_1.length >= BATCH_SIZE * 2)) return [3 /*break*/, 2];
                                    return [4 /*yield*/, processUserProductBatch()];
                                case 1:
                                    _17.sent();
                                    _17.label = 2;
                                case 2:
                                    if (usersProcessed % (BATCH_SIZE * 5) === 0) {
                                        console.log("--- Progress: Processed ".concat(usersProcessed, " source users | Users Migrated: ").concat(usersMigrated_1, " | Products Migrated: ").concat(productsMigrated_1, " | Ratings Migrated: ").concat(ratingsMigrated, " ---"));
                                    }
                                    return [2 /*return*/];
                            }
                        });
                    };
                    _a = true, userCursor_1 = __asyncValues(userCursor);
                    _15.label = 7;
                case 7: return [4 /*yield*/, userCursor_1.next()];
                case 8:
                    if (!(userCursor_1_1 = _15.sent(), _g = userCursor_1_1.done, !_g)) return [3 /*break*/, 11];
                    return [5 /*yield**/, _loop_1()];
                case 9:
                    _15.sent();
                    _15.label = 10;
                case 10:
                    _a = true;
                    return [3 /*break*/, 7];
                case 11: return [3 /*break*/, 18];
                case 12:
                    e_1_1 = _15.sent();
                    e_1 = { error: e_1_1 };
                    return [3 /*break*/, 18];
                case 13:
                    _15.trys.push([13, , 16, 17]);
                    if (!(!_a && !_g && (_h = userCursor_1.return))) return [3 /*break*/, 15];
                    return [4 /*yield*/, _h.call(userCursor_1)];
                case 14:
                    _15.sent();
                    _15.label = 15;
                case 15: return [3 /*break*/, 17];
                case 16:
                    if (e_1) throw e_1.error;
                    return [7 /*endfinally*/];
                case 17: return [7 /*endfinally*/];
                case 18: return [4 /*yield*/, processUserProductBatch()];
                case 19:
                    _15.sent(); // Process any remaining users/products in the last batch
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
                    _15.label = 20;
                case 20:
                    if (!(_i < pendingRatingsData_1.length)) return [3 /*break*/, 27];
                    pendingRating = pendingRatingsData_1[_i];
                    processedRatingsCount++;
                    newRatingUserId = userIdMap.get(pendingRating.oldRatingUserId);
                    productMapKey = "".concat(pendingRating.oldProductOwnerId, "-").concat(pendingRating.originalProductIndex);
                    newProductId = productMap_1.get(productMapKey);
                    if (newRatingUserId && newProductId) {
                        newRating = {
                            _id: new mongoose_1.Types.ObjectId(), // Generate new ID for the rating
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
                        productUpdateData.newRatingIds.push(newRating._id); // Add the new rating ID
                        productUpdateData.ratingSum += newRating.rating;
                    }
                    else {
                        // Log why it was skipped (user not mapped or product not mapped)
                        // if (!newRatingUserId) { console.warn(`Skipping collected rating by ${pendingRating.oldRatingUserId}: User not mapped.`); }
                        // if (!newProductId) { console.warn(`Skipping collected rating for product (Owner: ${pendingRating.oldProductOwnerId}, Index: ${pendingRating.originalProductIndex}): Product not mapped.`); }
                        skippedRatingsCount++;
                    }
                    if (!(ratingBatchInsert.length >= BATCH_SIZE)) return [3 /*break*/, 25];
                    console.log("Inserting rating batch of ".concat(ratingBatchInsert.length, "..."));
                    _15.label = 21;
                case 21:
                    _15.trys.push([21, 23, 24, 25]);
                    return [4 /*yield*/, TargetRating.insertMany(ratingBatchInsert, { ordered: false })];
                case 22:
                    ratingInsertResult = _15.sent();
                    ratingsMigrated += ratingInsertResult.length;
                    console.log(" -> Inserted ".concat(ratingInsertResult.length, " ratings."));
                    return [3 /*break*/, 25];
                case 23:
                    error_1 = _15.sent();
                    numInserted = ((_4 = error_1.result) === null || _4 === void 0 ? void 0 : _4.nInserted) || 0;
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
                    _15.label = 26;
                case 26:
                    _i++;
                    return [3 /*break*/, 20];
                case 27:
                    if (!(ratingBatchInsert.length > 0)) return [3 /*break*/, 31];
                    console.log("Inserting final rating batch of ".concat(ratingBatchInsert.length, "..."));
                    _15.label = 28;
                case 28:
                    _15.trys.push([28, 30, , 31]);
                    return [4 /*yield*/, TargetRating.insertMany(ratingBatchInsert, { ordered: false })];
                case 29:
                    ratingInsertResult = _15.sent();
                    ratingsMigrated += ratingInsertResult.length;
                    console.log(" -> Inserted ".concat(ratingInsertResult.length, " final ratings."));
                    return [3 /*break*/, 31];
                case 30:
                    error_2 = _15.sent();
                    numInserted = ((_5 = error_2.result) === null || _5 === void 0 ? void 0 : _5.nInserted) || 0;
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
                                    update: { $set: { ratings: updateData.newRatingIds, overallRating: parseFloat(newOverallRating.toFixed(2)) } }
                                }
                            });
                        }
                    });
                    if (!(productUpdateOpsFinal_1.length > 0)) return [3 /*break*/, 36];
                    console.log("Preparing to update ".concat(productUpdateOpsFinal_1.length, " products with ratings info..."));
                    _15.label = 32;
                case 32:
                    _15.trys.push([32, 34, , 35]);
                    return [4 /*yield*/, TargetProduct_1.bulkWrite(productUpdateOpsFinal_1, { ordered: false })];
                case 33:
                    bulkWriteResult = _15.sent();
                    console.log(" -> Product BulkWrite result: Matched: ".concat(bulkWriteResult.matchedCount, ", Modified: ").concat(bulkWriteResult.modifiedCount));
                    if (bulkWriteResult.hasWriteErrors()) {
                        console.warn(' -> Encountered errors during product rating updates:');
                        bulkWriteResult.getWriteErrors().forEach(function (err) {
                            console.warn("  -> Index ".concat(err.index, ": ").concat(err.errmsg));
                        });
                    }
                    return [3 /*break*/, 35];
                case 34:
                    error_3 = _15.sent();
                    console.error("Error during final product bulk update for ratings: ".concat(error_3.message), error_3);
                    return [3 /*break*/, 35];
                case 35: return [3 /*break*/, 37];
                case 36:
                    console.log('No products needed rating updates.');
                    _15.label = 37;
                case 37:
                    console.log('Product rating updates finished.');
                    processBatch = function (modelName, cursor, targetModel, mapFunction, checkExistingFunction // Optional: Returns set of IDs/keys that already exist
                    ) { return __awaiter(_this, void 0, void 0, function () {
                        var batchData, processedCount, migratedCount, skippedCount, sourceDoc, mappedDoc, docsToInsert, result, error_9, e_4_1, docsToInsert, result, error_10;
                        var _a, cursor_1, cursor_1_1;
                        var _b, e_4, _c, _d;
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
                                        // const existingIds = await checkExistingFunction(docsToInsert);
                                        // docsToInsert = docsToInsert.filter(doc => !existingIds.has(doc._id!.toString())); // Example check
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
                                    error_9 = _l.sent();
                                    migratedCount += (_g = (_f = (_e = error_9.result) === null || _e === void 0 ? void 0 : _e.insertedIds) === null || _f === void 0 ? void 0 : _f.length) !== null && _g !== void 0 ? _g : 0; // Add successfully inserted before error
                                    console.error("Error inserting ".concat(modelName, " batch: ").concat(error_9.message));
                                    if (error_9.name === 'MongoBulkWriteError' && error_9.writeErrors) {
                                        error_9.writeErrors.forEach(function (writeError) { return console.warn("  -> Failed ".concat(modelName, " insert: ").concat(writeError.errmsg)); });
                                    }
                                    return [3 /*break*/, 8];
                                case 7:
                                    batchData = []; // Clear batch
                                    return [7 /*endfinally*/];
                                case 8:
                                    console.log(" -> ".concat(modelName, ": Processed ").concat(processedCount, ", Migrated ").concat(migratedCount, ", Skipped ").concat(skippedCount));
                                    _l.label = 9;
                                case 9:
                                    if (processedCount % (BATCH_SIZE * 10) === 0) { // Log progress more frequently
                                        console.log("Processed ".concat(processedCount, " source ").concat(modelName, "..."));
                                    }
                                    _l.label = 10;
                                case 10:
                                    _a = true;
                                    return [3 /*break*/, 2];
                                case 11: return [3 /*break*/, 18];
                                case 12:
                                    e_4_1 = _l.sent();
                                    e_4 = { error: e_4_1 };
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
                                    if (e_4) throw e_4.error;
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
                                    error_10 = _l.sent();
                                    migratedCount += (_k = (_j = (_h = error_10.result) === null || _h === void 0 ? void 0 : _h.insertedIds) === null || _j === void 0 ? void 0 : _j.length) !== null && _k !== void 0 ? _k : 0;
                                    console.error("Error inserting final ".concat(modelName, " batch: ").concat(error_10.message));
                                    if (error_10.name === 'MongoBulkWriteError' && error_10.writeErrors) {
                                        error_10.writeErrors.forEach(function (writeError) { return console.warn("  -> Failed final ".concat(modelName, " insert: ").concat(writeError.errmsg)); });
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
                        var targetStatus = TargetTransactionStatus.COMPLETED; // Default to COMPLETED
                        var sourceStatusLower = (_b = sourceTx.status) === null || _b === void 0 ? void 0 : _b.toLowerCase();
                        // Explicitly set to FAILED or CANCELLED if source indicates, otherwise it remains COMPLETED
                        if (sourceStatusLower === 'failed' || sourceStatusLower === 'failure')
                            targetStatus = TargetTransactionStatus.FAILED;
                        else if (sourceStatusLower === 'cancelled' || sourceStatusLower === 'canceled')
                            targetStatus = TargetTransactionStatus.CANCELLED;
                        // No need for an explicit 'completed' check if it's the default
                        return {
                            transactionId: (0, uuid_1.v4)(), userId: newUserId, type: targetType, amount: amountNumber, currency: TargetCurrency.XAF, fee: 0, status: targetStatus,
                            description: sourceTx.message || "Migrated ".concat(targetType), externalTransactionId: sourceTx.transId, deleted: false,
                            createdAt: (_d = (_c = sourceTx._id) === null || _c === void 0 ? void 0 : _c.getTimestamp()) !== null && _d !== void 0 ? _d : new Date(), // Use ObjectId timestamp
                        };
                    };
                    return [4 /*yield*/, processBatch('Transactions', transactionCursor, TargetTransaction, mapTransaction)];
                case 38:
                    _15.sent();
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
                    _15.sent();
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
                    _15.sent();
                    // --- Add Partner migration ---
                    console.log('\nMigrating partners...');
                    partnerCursor = SourcePartner.find().cursor();
                    partnersProcessed = 0;
                    partnersMigrated = 0;
                    usersWithPartnerStatus = 0;
                    PACK_PERCENTAGE_RATES = {
                        'silver': 0.10, // 10% for silver partners
                        'gold': 0.18, // 18% for gold partners
                    };
                    // Collect all partner transactions first to recalculate partner balances
                    console.log('Collecting partner transactions for balance recalculation...');
                    partnerTxCursor = SourcePartnerTransaction.find().cursor();
                    partnerTransactions = new Map();
                    _15.label = 41;
                case 41:
                    _15.trys.push([41, 46, 47, 52]);
                    _b = true, partnerTxCursor_1 = __asyncValues(partnerTxCursor);
                    _15.label = 42;
                case 42: return [4 /*yield*/, partnerTxCursor_1.next()];
                case 43:
                    if (!(partnerTxCursor_1_1 = _15.sent(), _k = partnerTxCursor_1_1.done, !_k)) return [3 /*break*/, 45];
                    _m = partnerTxCursor_1_1.value;
                    _b = false;
                    sourceTx = _m;
                    oldPartnerId = (_6 = sourceTx.partnerId) === null || _6 === void 0 ? void 0 : _6.toString();
                    if (!oldPartnerId) {
                        return [3 /*break*/, 44];
                    }
                    amountNumber = null;
                    if (typeof sourceTx.amount === 'string') {
                        try {
                            amountNumber = parseFloat(sourceTx.amount);
                            if (isNaN(amountNumber))
                                return [3 /*break*/, 44];
                        }
                        catch (_16) {
                            return [3 /*break*/, 44];
                        }
                    }
                    else if (typeof sourceTx.amount === 'number') {
                        amountNumber = sourceTx.amount;
                    }
                    else {
                        return [3 /*break*/, 44];
                    }
                    packValue = (_7 = sourceTx.pack) === null || _7 === void 0 ? void 0 : _7.toLowerCase();
                    if (packValue !== 'silver' && packValue !== 'gold') {
                        return [3 /*break*/, 44];
                    }
                    percentageRate = PACK_PERCENTAGE_RATES[packValue];
                    recalculatedAmount = amountNumber * percentageRate;
                    // Store the transaction with recalculated amount by partnerId
                    if (!partnerTransactions.has(oldPartnerId)) {
                        partnerTransactions.set(oldPartnerId, { totalAmount: 0, transactions: [] });
                    }
                    partnerTxData = partnerTransactions.get(oldPartnerId);
                    partnerTxData.totalAmount += recalculatedAmount;
                    partnerTxData.transactions.push(__assign(__assign({}, sourceTx.toObject()), { recalculatedAmount: recalculatedAmount, originalAmount: amountNumber }));
                    _15.label = 44;
                case 44:
                    _b = true;
                    return [3 /*break*/, 42];
                case 45: return [3 /*break*/, 52];
                case 46:
                    e_2_1 = _15.sent();
                    e_2 = { error: e_2_1 };
                    return [3 /*break*/, 52];
                case 47:
                    _15.trys.push([47, , 50, 51]);
                    if (!(!_b && !_k && (_l = partnerTxCursor_1.return))) return [3 /*break*/, 49];
                    return [4 /*yield*/, _l.call(partnerTxCursor_1)];
                case 48:
                    _15.sent();
                    _15.label = 49;
                case 49: return [3 /*break*/, 51];
                case 50:
                    if (e_2) throw e_2.error;
                    return [7 /*endfinally*/];
                case 51: return [7 /*endfinally*/];
                case 52:
                    console.log("Collected and recalculated transactions for ".concat(partnerTransactions.size, " partners"));
                    _15.label = 53;
                case 53:
                    _15.trys.push([53, 62, 63, 68]);
                    _c = true, partnerCursor_1 = __asyncValues(partnerCursor);
                    _15.label = 54;
                case 54: return [4 /*yield*/, partnerCursor_1.next()];
                case 55:
                    if (!(partnerCursor_1_1 = _15.sent(), _o = partnerCursor_1_1.done, !_o)) return [3 /*break*/, 61];
                    _q = partnerCursor_1_1.value;
                    _c = false;
                    sourcePartner = _q;
                    partnersProcessed++;
                    oldPartnerId = (_8 = sourcePartner._id) === null || _8 === void 0 ? void 0 : _8.toString();
                    oldUserId = (_9 = sourcePartner.user) === null || _9 === void 0 ? void 0 : _9.toString();
                    if (!oldUserId || !oldPartnerId) {
                        console.warn("Skipping partner without user or _id");
                        return [3 /*break*/, 60];
                    }
                    newUserId = userIdMap.get(oldUserId);
                    if (!newUserId) {
                        console.warn("Skipping partner for user ".concat(oldUserId, " - User not found in userIdMap"));
                        return [3 /*break*/, 60];
                    }
                    packValue = (_10 = sourcePartner.pack) === null || _10 === void 0 ? void 0 : _10.toLowerCase();
                    if (packValue !== 'silver' && packValue !== 'gold') {
                        console.warn("Skipping partner with invalid pack: ".concat(packValue));
                        return [3 /*break*/, 60];
                    }
                    partnerPack = packValue === 'silver' ? TargetPartnerPack.SILVER : TargetPartnerPack.GOLD;
                    partnerTxData = partnerTransactions.get(oldPartnerId);
                    correctedTotalAmount = (partnerTxData === null || partnerTxData === void 0 ? void 0 : partnerTxData.totalAmount) || 0;
                    _15.label = 56;
                case 56:
                    _15.trys.push([56, 59, , 60]);
                    return [4 /*yield*/, TargetPartner.create({
                            user: newUserId,
                            pack: partnerPack,
                            amount: correctedTotalAmount, // Use the recalculated sum of transactions
                            isActive: (_11 = sourcePartner.isActive) !== null && _11 !== void 0 ? _11 : true,
                            createdAt: sourcePartner.createdAt || sourcePartner._id.getTimestamp(),
                            updatedAt: sourcePartner.updatedAt || new Date()
                        })];
                case 57:
                    newPartner = _15.sent();
                    partnerIdMap.set(oldPartnerId, newPartner._id);
                    partnersMigrated++;
                    // 2. Update user with partner pack
                    return [4 /*yield*/, TargetUser_1.updateOne({ _id: newUserId }, { $set: { partnerPack: partnerPack } })];
                case 58:
                    // 2. Update user with partner pack
                    _15.sent();
                    usersWithPartnerStatus++;
                    console.log("Migrated partner ".concat(oldPartnerId, " with corrected amount ").concat(correctedTotalAmount, " (original amount was ").concat(sourcePartner.amount || 0, ")"));
                    if (partnersProcessed % 100 === 0) {
                        console.log("Processed ".concat(partnersProcessed, " partners, migrated ").concat(partnersMigrated));
                    }
                    return [3 /*break*/, 60];
                case 59:
                    error_4 = _15.sent();
                    console.error("Error migrating partner ".concat(oldPartnerId, ": ").concat(error_4.message));
                    return [3 /*break*/, 60];
                case 60:
                    _c = true;
                    return [3 /*break*/, 54];
                case 61: return [3 /*break*/, 68];
                case 62:
                    e_3_1 = _15.sent();
                    e_3 = { error: e_3_1 };
                    return [3 /*break*/, 68];
                case 63:
                    _15.trys.push([63, , 66, 67]);
                    if (!(!_c && !_o && (_p = partnerCursor_1.return))) return [3 /*break*/, 65];
                    return [4 /*yield*/, _p.call(partnerCursor_1)];
                case 64:
                    _15.sent();
                    _15.label = 65;
                case 65: return [3 /*break*/, 67];
                case 66:
                    if (e_3) throw e_3.error;
                    return [7 /*endfinally*/];
                case 67: return [7 /*endfinally*/];
                case 68:
                    console.log("Partner migration finished. Processed: ".concat(partnersProcessed, ", Migrated: ").concat(partnersMigrated, ", Users updated: ").concat(usersWithPartnerStatus));
                    // --- Migrate Partner Transactions with corrected amounts ---
                    console.log('\nMigrating partner transactions with corrected amounts...');
                    partnerTxProcessed = 0;
                    partnerTxMigrated = 0;
                    partnerSpecificTxMigrated = 0;
                    partnerIds = Array.from(partnerTransactions.keys());
                    _d = 0, partnerIds_1 = partnerIds;
                    _15.label = 69;
                case 69:
                    if (!(_d < partnerIds_1.length)) return [3 /*break*/, 77];
                    oldPartnerId = partnerIds_1[_d];
                    partnerTxData = partnerTransactions.get(oldPartnerId);
                    newPartnerId = partnerIdMap.get(oldPartnerId);
                    if (!newPartnerId) {
                        console.warn("Skipping transactions for partner ".concat(oldPartnerId, " - Partner not found in partnerIdMap"));
                        return [3 /*break*/, 76];
                    }
                    _e = 0, _f = partnerTxData.transactions;
                    _15.label = 70;
                case 70:
                    if (!(_e < _f.length)) return [3 /*break*/, 76];
                    txData = _f[_e];
                    partnerTxProcessed++;
                    oldUserId = (_12 = txData.user) === null || _12 === void 0 ? void 0 : _12.toString();
                    if (!oldUserId) {
                        console.warn("Skipping partner transaction without user");
                        return [3 /*break*/, 75];
                    }
                    newUserId = userIdMap.get(oldUserId);
                    if (!newUserId) {
                        console.warn("Skipping partner transaction for user ".concat(oldUserId, " - User not found in userIdMap"));
                        return [3 /*break*/, 75];
                    }
                    _15.label = 71;
                case 71:
                    _15.trys.push([71, 74, , 75]);
                    // Create transaction for partner earnings with recalculated amount
                    return [4 /*yield*/, TargetTransaction.create({
                            transactionId: (0, uuid_1.v4)(),
                            userId: newUserId,
                            type: TargetTransactionType.PARTNER_EARNINGS,
                            amount: txData.recalculatedAmount, // Use the recalculated amount
                            currency: TargetCurrency.XAF,
                            fee: 0,
                            status: TargetTransactionStatus.COMPLETED,
                            description: txData.message || 'Partner earnings (recalculated)',
                            metadata: {
                                sourceTransactionId: txData._id.toString(),
                                partnerId: newPartnerId.toString(),
                                pack: txData.pack,
                                sourceType: txData.transType,
                                originalAmount: txData.originalAmount,
                                recalculated: true
                            },
                            createdAt: txData.date || txData.createdAt || txData._id.getTimestamp(),
                        })];
                case 72:
                    // Create transaction for partner earnings with recalculated amount
                    _15.sent();
                    // Also create a partner-specific transaction record
                    return [4 /*yield*/, TargetPartnerTransaction.create({
                            partnerId: newPartnerId,
                            user: newUserId,
                            pack: ((_13 = txData.pack) === null || _13 === void 0 ? void 0 : _13.toLowerCase()) === 'silver' ? 'silver' : 'gold',
                            transType: ((_14 = txData.transType) === null || _14 === void 0 ? void 0 : _14.toLowerCase()) === 'withdrawal' ? 'withdrawal' : 'deposit',
                            message: txData.message || 'Migrated partner transaction',
                            amount: txData.recalculatedAmount, // Use the recalculated amount
                            // Optional fields - set if available in source data
                            sourcePaymentSessionId: txData.sourcePaymentSessionId,
                            sourceSubscriptionType: txData.sourceSubscriptionType,
                            referralLevelInvolved: txData.referralLevelInvolved,
                            createdAt: txData.date || txData.createdAt || txData._id.getTimestamp(),
                            updatedAt: txData.updatedAt || new Date()
                        })];
                case 73:
                    // Also create a partner-specific transaction record
                    _15.sent();
                    partnerSpecificTxMigrated++;
                    partnerTxMigrated++;
                    if (partnerTxProcessed % 100 === 0) {
                        console.log("Processed ".concat(partnerTxProcessed, " partner transactions, migrated ").concat(partnerTxMigrated, " regular transactions, ").concat(partnerSpecificTxMigrated, " partner-specific transactions"));
                    }
                    return [3 /*break*/, 75];
                case 74:
                    error_5 = _15.sent();
                    console.error("Error migrating partner transaction ".concat(txData._id, ": ").concat(error_5.message));
                    return [3 /*break*/, 75];
                case 75:
                    _e++;
                    return [3 /*break*/, 70];
                case 76:
                    _d++;
                    return [3 /*break*/, 69];
                case 77:
                    console.log("Partner transaction migration finished. Processed: ".concat(partnerTxProcessed, ", Migrated: ").concat(partnerTxMigrated, " regular transactions, ").concat(partnerSpecificTxMigrated, " partner-specific transactions"));
                    console.log('\nMigration completed successfully!');
                    return [3 /*break*/, 84];
                case 78:
                    error_6 = _15.sent();
                    console.error('\nMigration failed:', error_6);
                    return [3 /*break*/, 84];
                case 79:
                    console.log('\nClosing database connections...');
                    return [4 /*yield*/, (sourceConn === null || sourceConn === void 0 ? void 0 : sourceConn.close())];
                case 80:
                    _15.sent();
                    return [4 /*yield*/, (userConn === null || userConn === void 0 ? void 0 : userConn.close())];
                case 81:
                    _15.sent();
                    return [4 /*yield*/, (paymentConn === null || paymentConn === void 0 ? void 0 : paymentConn.close())];
                case 82:
                    _15.sent();
                    return [4 /*yield*/, (productConn === null || productConn === void 0 ? void 0 : productConn.close())];
                case 83:
                    _15.sent();
                    console.log('Connections closed.');
                    return [7 /*endfinally*/];
                case 84: return [2 /*return*/];
            }
        });
    });
}
// --- Run the Migration ---
runMigration().catch(function (err) {
    console.error("Unhandled error during migration script execution:", err);
    process.exit(1);
});
