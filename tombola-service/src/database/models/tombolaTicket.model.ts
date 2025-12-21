import mongoose, { Schema, Document, Types } from 'mongoose';

// Interface defining the TombolaTicket document structure
export interface ITombolaTicket extends Document {
    _id: Types.ObjectId;
    userId: Types.ObjectId;         // Reference to the User (in user-service)
    tombolaMonthId: Types.ObjectId; // Reference to the TombolaMonth
    ticketId: string;               // Unique identifier for this specific ticket (could be nanoid or uuid)
    purchaseTimestamp: Date;      // When the ticket was purchased
    paymentIntentId?: string;      // Optional: link to payment intent for tracking
    ticketNumber: number;           // Sequential number within the TombolaMonth

    // NEW FIELDS for weighted lottery (Impact Challenge)
    weight: number;                 // Probability weight: 1.0, 0.6, or 0.3
    userTicketIndex: number;        // This user's Nth ticket in this month (1-25)
    sourceType: 'direct_purchase' | 'challenge_vote'; // Source of ticket
    challengeVoteId?: Types.ObjectId; // Link to ChallengeVote if from Impact Challenge

    createdAt: Date;
    updatedAt: Date;
}

// Schema for TombolaTicket
const TombolaTicketSchema = new Schema<ITombolaTicket>(
    {
        userId: {
            type: Schema.Types.ObjectId,
            required: true,
            index: true, // Index for finding user's tickets
        },
        tombolaMonthId: {
            type: Schema.Types.ObjectId,
            ref: 'TombolaMonth', // Reference to the TombolaMonth model
            required: true,
            index: true, // Index for finding tickets for a specific month
        },
        ticketId: {
            type: String,
            required: true,
            unique: true, // Ensure each ticket ID is globally unique
            index: true,
        },
        purchaseTimestamp: {
            type: Date,
            required: true,
            default: Date.now,
        },
        paymentIntentId: {
            type: String,
            index: true, // Index if needed for payment lookups
        },
        ticketNumber: {             // Add the field to the schema
            type: Number,
            required: true,
            // We will index this together with tombolaMonthId
        },
        // NEW FIELDS for weighted lottery
        weight: {
            type: Number,
            required: true,
            default: 1.0, // Default weight for backward compatibility
        },
        userTicketIndex: {
            type: Number,
            required: true,
            default: 1,
        },
        sourceType: {
            type: String,
            enum: ['direct_purchase', 'challenge_vote'],
            required: true,
            default: 'direct_purchase', // Default for existing tickets
        },
        challengeVoteId: {
            type: Schema.Types.ObjectId,
            index: true,
        },
    },
    {
        timestamps: true, // Adds createdAt and updatedAt
    }
);

// Add compound index for finding ticket by number within a month
TombolaTicketSchema.index({ tombolaMonthId: 1, ticketNumber: 1 }, { unique: true });

// Create and export the Mongoose model
const TombolaTicketModel = mongoose.model<ITombolaTicket>('TombolaTicket', TombolaTicketSchema);

export default TombolaTicketModel; 