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

// Simple map for country codes to dialing codes relevant to the User model
const countryDialingCodesMap: { [key: string]: string } = {
    CM: '237', // Cameroon
    BJ: '229', // Benin
    CG: '242', // Congo
    GH: '233', // Ghana
    CI: '225', // Cote d'Ivoire
    SN: '221', // Senegal
    TG: '228', // Togo
    BF: '226', // Burkina Faso
    GN: '224', // Guinea
    ML: '223', // Mali
    NE: '227', // Niger
    GA: '241', // Gabon
    CD: '243', // DRC
    KE: '254', // Kenya
    // Add other countries supported by your application
};

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
    passwordResetToken?: string | null;
    passwordResetTokenExpiration?: Date | null;

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
        referralCode: { type: String, unique: true, sparse: true, index: true, lowercase: true },
        balance: { type: Number, default: 0, required: true },
        sex: {
            type: String,
            enum: Object.values(UserSex),
            index: true,
            lowercase: true
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
        updatedAt: { type: Date, default: Date.now },
        passwordResetToken: { type: String, default: null },
        passwordResetTokenExpiration: { type: Date, default: null },
    },
    {
        timestamps: true,
        toJSON: { virtuals: true },
    }
);

// --- Middleware --- 

// Consolidated pre('save') hook for password hashing and sex normalization
UserSchema.pre<IUser>('save', async function (next: any) {
    // Phone Number Normalization Logic
    if (this.isModified('phoneNumber') && this.phoneNumber) {
        let originalPhone = this.phoneNumber;
        let cleanedPhone = this.phoneNumber.replace(/\D/g, ''); // Remove all non-digits
        const userCountry = this.country?.toUpperCase(); // Get user's selected country
        let expectedDialingCode = userCountry ? countryDialingCodesMap[userCountry] : null;

        console.log(`[DEBUG] Phone Normalization: Original: ${originalPhone}, Cleaned: ${cleanedPhone}, Country: ${userCountry}, Expected Code: ${expectedDialingCode}`);

        if (expectedDialingCode) {
            // Case 1: Cleaned phone starts with the correct dialing code
            if (cleanedPhone.startsWith(expectedDialingCode)) {
                // Check for double dialing code (e.g., 237237...)
                const doubleCode = expectedDialingCode + expectedDialingCode;
                if (cleanedPhone.startsWith(doubleCode)) {
                    this.phoneNumber = cleanedPhone.substring(expectedDialingCode.length);
                    console.log(`[DEBUG] Phone Normalization: Removed duplicate country code. New: ${this.phoneNumber}`);
                } else {
                    // Already correctly prefixed, ensure it's just the code + national number
                    this.phoneNumber = cleanedPhone;
                    console.log(`[DEBUG] Phone Normalization: Already prefixed correctly. New: ${this.phoneNumber}`);
                }
            }
            // Case 2: Cleaned phone does NOT start with the correct dialing code, so prepend it
            else {
                // Before prepending, check if it starts with *any other* known dialing code and remove it
                // This avoids issues like 229... for CM where user entered Benin number but selected Cameroon
                for (const code in countryDialingCodesMap) {
                    const otherDialingCode = countryDialingCodesMap[code];
                    if (cleanedPhone.startsWith(otherDialingCode) && otherDialingCode !== expectedDialingCode) {
                        cleanedPhone = cleanedPhone.substring(otherDialingCode.length);
                        console.log(`[DEBUG] Phone Normalization: Removed incorrect prefix ${otherDialingCode}. Intermediate: ${cleanedPhone}`);
                        break;
                    }
                }
                this.phoneNumber = expectedDialingCode + cleanedPhone;
                console.log(`[DEBUG] Phone Normalization: Prepended country code. New: ${this.phoneNumber}`);
            }
        } else {
            // No country selected or country not in map - cannot reliably determine dialing code.
            // Save cleaned version or implement more complex logic (e.g., try to guess from number).
            // For now, just save the cleaned version. This might lead to numbers without country codes.
            this.phoneNumber = cleanedPhone;
            console.log(`[DEBUG] Phone Normalization: No expected country code. Saved cleaned: ${this.phoneNumber}`);
        }

        // Final check: ensure it's not empty if original wasn't (though unlikely with replace non-digits)
        if (originalPhone && !this.phoneNumber) {
            this.phoneNumber = cleanedPhone; // Fallback to cleaned if somehow became empty
        }
    }

    // Restore Password Hashing Logic
    if (this.isModified('password') && this.password) {
        try {
            const salt = await bcrypt.genSalt(10);
            this.password = await bcrypt.hash(this.password, salt);
        } catch (err: any) {
            return next(err);
        }
    }

    next();
});

// Hash password on update if modified
UserSchema.pre<Query<any, IUser>>('findOneAndUpdate', async function (next: any) {
    const update = this.getUpdate() as any; // Get the update operations

    // Check if password is being updated and is a string
    if (update && update.password && typeof update.password === 'string') {
        try {
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(update.password, salt);
            // Update the password in the $set operator or directly if not using $set
            if (update.$set && update.$set.password) {
                update.$set.password = hashedPassword;
            } else {
                update.password = hashedPassword;
            }
            this.setUpdate(update); // Apply the modified update
            next();
        } catch (err: any) {
            return next(err);
        }
    } else {
        next(); // No password update or not a string, proceed
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