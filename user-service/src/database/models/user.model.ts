import { Schema, Document, Types, model, Query } from 'mongoose';
import bcrypt from 'bcrypt';

// Define User Roles
export enum UserRole {
    USER = 'user',
    ADMIN = 'admin', // Consider if admin users are stored here or in a separate AdminModel
}

// Define User Sex options
export enum UserSex {
    MALE = 'male',
    FEMALE = 'female',
    OTHER = 'other',
    PREFER_NOT_TO_SAY = 'prefer_not_to_say',
}

// Interface for OTP subdocument
interface IOtp extends Document {
    code: string;
    expiration: Date;
}

// Interface defining the User document structure (FIELDS ONLY)
export interface IUser extends Document {
    _id: Types.ObjectId;
    name: string;
    region: string;
    country?: string;
    city?: string;
    phoneNumber: string;
    momoNumber?: string;
    momoOperator?: string;
    email: string;
    password?: string; // Exists in DB but often excluded from responses
    token?: string;
    avatar?: string;
    avatarId?: string;
    blocked: boolean;
    debt: number;
    flagged: boolean;
    forceUnflagged: boolean;
    forceFlagged: boolean;
    isVerified: boolean;
    role: UserRole;
    deleted: boolean;
    deletedAt?: Date;
    deletionReason?: string;
    contactsOtps: Types.DocumentArray<IOtp>;
    otps: Types.DocumentArray<IOtp>;
    ipAddress?: string;
    ipCity?: string;
    ipRegion?: string;
    ipCountry?: string;
    ipLocation?: string;
    ipOrg?: string;
    ipLastUpdated?: Date;
    referralCode?: string;
    balance: number;
    sex?: UserSex;
    birthDate?: Date;
    language?: string[];
    preferenceCategories?: string[];
    interests?: string[];
    profession?: string;
    shareContactInfo: boolean;
    createdAt: Date;
    updatedAt: Date;

    // NO METHODS DEFINED HERE - Moved to Repository/Service
}

// --- Schemas ---

const otpSchema = new Schema<IOtp>({
    code: { type: String, required: true },
    expiration: { type: Date, required: true },
}, { _id: false });

const UserSchema = new Schema<IUser>(
    {
        name: { type: String, required: true, trim: true },
        region: { type: String, required: true, trim: true },
        country: {
            type: String,
            trim: true,
            index: true
        },
        city: {
            type: String,
            trim: true,
            index: true
        },
        phoneNumber: { type: String, required: true, unique: true, index: true },
        momoNumber: { type: String },
        momoOperator: { type: String },
        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true,
            index: true,
        },
        password: { type: String, required: true, select: false },
        token: { type: String, select: false },
        avatar: { type: String },
        avatarId: { type: String },
        blocked: { type: Boolean, default: false },
        debt: { type: Number, default: 0 },
        flagged: { type: Boolean, default: false },
        forceUnflagged: { type: Boolean, default: false },
        forceFlagged: { type: Boolean, default: false },
        isVerified: { type: Boolean, default: false },
        role: {
            type: String,
            enum: Object.values(UserRole),
            default: UserRole.USER,
            required: true
        },
        deleted: { type: Boolean, default: false, index: true },
        deletedAt: { type: Date },
        deletionReason: { type: String },
        contactsOtps: [otpSchema],
        otps: [otpSchema],
        ipAddress: { type: String },
        ipCity: { type: String, index: true },
        ipRegion: { type: String },
        ipCountry: { type: String, index: true },
        ipLocation: { type: String },
        ipOrg: { type: String },
        ipLastUpdated: { type: Date },
        referralCode: { type: String, unique: true, sparse: true, index: true },
        balance: { type: Number, default: 0, required: true },
        sex: {
            type: String,
            enum: Object.values(UserSex),
            index: true
        },
        birthDate: {
            type: Date,
            index: true
        },
        language: [{
            type: String,
            trim: true,
            index: true
        }],
        preferenceCategories: [{
            type: String,
            trim: true,
        }],
        interests: [{
            type: String,
            trim: true,
            index: true
        }],
        profession: {
            type: String,
            trim: true,
            index: true
        },
        shareContactInfo: { type: Boolean, default: true },
    },
    {
        timestamps: true,
    }
);

// --- Middleware --- 

// Password Hashing
UserSchema.pre<IUser>('save', async function (next: any) {
    if (!this.isModified('password') || !this.password) {
        return next();
    }
    try {
        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);
        next();
    } catch (err: any) {
        next(err);
    }
});

// --- Soft Delete Query Middleware --- 
// Middleware to automatically filter out soft-deleted documents for find operations
const softDeleteMiddleware = function (this: Query<any, IUser>, next: any) {
    // Check if the query is explicitly looking for deleted documents
    // Mongoose types might be tricky here, using `_conditions` is less safe but common
    const conditions = this.getFilter();
    if (!(conditions.deleted === true || conditions.deleted?.$eq === true)) {
        // If not explicitly searching for deleted, add the filter
        this.where({ deleted: { $ne: true } });
    }
    next();
};


UserSchema.pre('find', softDeleteMiddleware);
UserSchema.pre('findOne', softDeleteMiddleware);
UserSchema.pre('countDocuments', softDeleteMiddleware);
UserSchema.pre('findOneAndUpdate', softDeleteMiddleware);
UserSchema.pre('updateMany', softDeleteMiddleware); // Be careful with updateMany, ensure it doesn't bypass logic
UserSchema.pre('updateOne', softDeleteMiddleware); // Be careful with updateOne

// Aggregate pipelines might need manual filtering for deleted status
// UserSchema.pre('aggregate', function(next) { ... });

// --- Soft Delete Operation Middleware (Interception) --- 
// Intercept delete operations to perform soft delete instead
// Note: These might not be triggered by repository methods like findByIdAndUpdate used for soft delete.
// They are more for direct model calls like user.remove() or UserModel.deleteOne()

// UserSchema.pre<IUser>('remove', function(next) { ... }); // For document.remove()
// UserSchema.pre<Query<any, IUser>>('findOneAndDelete', function(next) { ... });
// UserSchema.pre<Query<any, IUser>>('deleteOne', function(next) { ... });
// UserSchema.pre<Query<any, IUser>>('deleteMany', function(next) { ... });


// --- Model Export ---
const UserModel = model<IUser>('User', UserSchema);

export default UserModel; 