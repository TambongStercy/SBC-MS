import mongoose, { Schema, Document, Types } from 'mongoose';

// Interface defining the TombolaTicket document structure
export interface ITombolaTicket extends Document {
    _id: Types.ObjectId;
    userId: Types.ObjectId;         // Reference to the User (in user-service)
    tombolaMonthId: Types.ObjectId; // Reference to the TombolaMonth
    ticketId: string;               // Unique identifier for this specific ticket (could be nanoid or uuid)
    purchaseTimestamp: Date;      // When the ticket was purchased
    paymentIntentId?: string;      // Optional: link to payment intent for tracking
    // Add any other relevant ticket details if needed
    createdAt: Date;
    updatedAt: Date;
    ticketNumber: number;           // Sequential number within the TombolaMonth
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