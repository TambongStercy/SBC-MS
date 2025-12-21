import mongoose, { Schema, Document, Types } from 'mongoose';

// Interface for multilingual project description
export interface IProjectDescription {
    fr: string;
    en: string;
}

// Interface defining the Entrepreneur document structure
export interface IEntrepreneur extends Document {
    _id: Types.ObjectId;
    challengeId: Types.ObjectId;

    // Entrepreneur details
    userId?: Types.ObjectId; // Optional SBC account link
    name: string;
    email: string;
    phoneNumber: string;
    country: string;
    city: string;

    // Project details
    projectName: string;
    projectDescription: IProjectDescription;
    businessCategory: string;

    // Video pitch (Google Cloud Storage)
    videoUrl: string;
    videoFilename: string;
    videoDuration?: number; // seconds
    videoThumbnailUrl?: string;

    // Voting metrics (denormalized for leaderboard performance)
    voteCount: number; // Total votes from both VOTE and SUPPORT
    totalAmount: number; // Total CFA collected (voteCount * 200)

    // Ranking
    rank?: number; // 1, 2, or 3
    isWinner: boolean;

    // Admin approval
    approved: boolean;
    approvedBy?: Types.ObjectId;
    approvedAt?: Date;

    createdAt: Date;
    updatedAt: Date;
}

// Schema for Entrepreneur
const EntrepreneurSchema = new Schema<IEntrepreneur>(
    {
        challengeId: {
            type: Schema.Types.ObjectId,
            ref: 'ImpactChallenge',
            required: true,
            index: true,
        },
        userId: {
            type: Schema.Types.ObjectId,
            index: true,
        },
        name: {
            type: String,
            required: true,
            trim: true,
        },
        email: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
        },
        phoneNumber: {
            type: String,
            required: true,
            trim: true,
        },
        country: {
            type: String,
            required: true,
            trim: true,
        },
        city: {
            type: String,
            required: true,
            trim: true,
        },
        projectName: {
            type: String,
            required: true,
            trim: true,
        },
        projectDescription: {
            fr: {
                type: String,
                required: true,
            },
            en: {
                type: String,
                required: true,
            },
        },
        businessCategory: {
            type: String,
            required: true,
            trim: true,
        },
        videoUrl: {
            type: String,
            required: true,
        },
        videoFilename: {
            type: String,
            required: true,
        },
        videoDuration: {
            type: Number,
            min: 0,
            max: 90, // Max 90 seconds
        },
        videoThumbnailUrl: {
            type: String,
        },
        voteCount: {
            type: Number,
            required: true,
            default: 0,
            min: 0,
        },
        totalAmount: {
            type: Number,
            required: true,
            default: 0,
            min: 0,
        },
        rank: {
            type: Number,
            min: 1,
            max: 3,
        },
        isWinner: {
            type: Boolean,
            required: true,
            default: false,
        },
        approved: {
            type: Boolean,
            required: true,
            default: false,
        },
        approvedBy: {
            type: Schema.Types.ObjectId,
        },
        approvedAt: {
            type: Date,
        },
    },
    {
        timestamps: true,
    }
);

// Indexes
EntrepreneurSchema.index({ challengeId: 1, voteCount: -1 }); // For leaderboard queries
EntrepreneurSchema.index({ challengeId: 1, approved: 1 });

// Create and export the Mongoose model
const EntrepreneurModel = mongoose.model<IEntrepreneur>('Entrepreneur', EntrepreneurSchema);

export default EntrepreneurModel;
