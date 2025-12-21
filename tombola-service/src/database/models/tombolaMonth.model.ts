import mongoose, { Schema, Document, Types } from 'mongoose';

// Enum for Tombola Status
export enum TombolaStatus {
    OPEN = 'open',         // Accepting ticket purchases
    DRAWING = 'drawing',   // Draw in progress (or ready to be drawn)
    CLOSED = 'closed',     // Draw complete, winners announced
}

// Interface for Winner subdocument
export interface IWinner extends Document {
    userId: Types.ObjectId; // Reference to the User model (in user-service)
    prize: string;          // e.g., 'Bike', 'Phone', '100k'
    rank: number;           // 1, 2, or 3
    winningTicketNumber: number; // Add the winning ticket number
}

// Interface defining the TombolaMonth document structure
export interface ITombolaMonth extends Document {
    _id: Types.ObjectId;
    month: number;          // e.g., 4 for April
    year: number;           // e.g., 2025
    status: TombolaStatus;  // Current status
    startDate: Date;        // When ticket sales opened
    endDate?: Date;         // When ticket sales closed (optional)
    drawDate?: Date;        // When the draw was performed
    winners: Types.DocumentArray<IWinner>; // Array of winners
    lastTicketNumber: number; // Counter for sequential ticket numbers

    // NEW FIELDS for Impact Challenge integration
    previousMonthWinners: Types.ObjectId[]; // User IDs excluded from this month's draw (anti-consecutive-win rule)
    linkedChallengeId?: Types.ObjectId;     // Link to ImpactChallenge if this tombola is for a challenge

    createdAt: Date;
    updatedAt: Date;
}

// Schema for Winner
const WinnerSchema = new Schema<IWinner>(
    {
        userId: {
            type: Schema.Types.ObjectId,
            required: true,
            // ref: 'User' // We won't populate directly across services usually
            index: true,
        },
        prize: {
            type: String,
            required: true,
        },
        rank: {
            type: Number,
            required: true,
            min: 1,
            max: 3,
        },
        winningTicketNumber: { // Add schema definition for the ticket number
            type: Number,
            required: true,
        }
    },
    { _id: false } // Don't create separate _id for subdocuments
);

// Schema for TombolaMonth
const TombolaMonthSchema = new Schema<ITombolaMonth>(
    {
        month: {
            type: Number,
            required: true,
            min: 1,
            max: 12,
        },
        year: {
            type: Number,
            required: true,
        },
        status: {
            type: String,
            enum: Object.values(TombolaStatus),
            required: true,
            default: TombolaStatus.OPEN,
            index: true,
        },
        startDate: {
            type: Date,
            required: true,
            default: Date.now,
        },
        endDate: {
            type: Date,
        },
        drawDate: {
            type: Date,
        },
        winners: [WinnerSchema], // Embed the WinnerSchema
        lastTicketNumber: {     // Add the field to the schema
            type: Number,
            required: true,
            default: 0,
        },
        // NEW FIELDS for Impact Challenge
        previousMonthWinners: [{
            type: Schema.Types.ObjectId,
            index: true,
        }],
        linkedChallengeId: {
            type: Schema.Types.ObjectId,
            index: true,
        },
    },
    {
        timestamps: true, // Adds createdAt and updatedAt
    }
);

// Create a compound index for unique month/year combination
TombolaMonthSchema.index({ year: 1, month: 1 }, { unique: true });

// Create and export the Mongoose model
const TombolaMonthModel = mongoose.model<ITombolaMonth>('TombolaMonth', TombolaMonthSchema);

export default TombolaMonthModel; 