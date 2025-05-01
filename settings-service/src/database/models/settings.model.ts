import mongoose, { Schema, Document, Types } from 'mongoose';

// Reusable Interface for File References (stored in Drive)
// Export this so EventModel can use it
export interface IFileReference {
    fileId: string;     // Google Drive File ID
    url?: string;        // Dynamically generated proxy URL (not stored)
    fileName?: string;   // Original filename
    mimeType?: string;   // File MIME type
    size?: number;       // File size in bytes
}

// Remove IEventItem interface - moved to event.model.ts
// export interface IEventItem extends Document { ... }

// Interface for the Settings document
export interface ISettings extends Document {
    // Social Group Links
    whatsappGroupUrl?: string;
    telegramGroupUrl?: string;
    discordGroupUrl?: string;

    // File Links (using IFileReference)
    companyLogo?: IFileReference;
    termsAndConditionsPdf?: IFileReference;
    presentationVideo?: IFileReference;
    presentationPdf?: IFileReference;

    // Remove Events array - moved to separate EventModel
    // events: Types.DocumentArray<IEventItem>;

    createdAt: Date;
    updatedAt: Date;
}

// Schema for File Reference
// Export this so EventModel can use it
export const FileReferenceSchema: Schema = new Schema({
    fileId: { type: String, required: true },
    fileName: { type: String },
    mimeType: { type: String },
    size: { type: Number },
}, { _id: false });

// Remove EventItemSchema - moved to event.model.ts
// const EventItemSchema: Schema = new Schema({ ... });

const SettingsSchema: Schema = new Schema(
    {
        // Social Group Links
        whatsappGroupUrl: { type: String, trim: true },
        telegramGroupUrl: { type: String, trim: true },
        discordGroupUrl: { type: String, trim: true },

        // File Links
        companyLogo: { type: FileReferenceSchema, required: false },
        termsAndConditionsPdf: { type: FileReferenceSchema, required: false },
        presentationVideo: { type: FileReferenceSchema, required: false },
        presentationPdf: { type: FileReferenceSchema, required: false },

        // Remove Events array
        // events: [EventItemSchema],
    },
    {
        timestamps: true, // Automatically adds createdAt and updatedAt
        versionKey: false, // Disable the __v version key
        collection: 'settings' // Explicitly name the collection
    }
);

// Ensure only one settings document can exist (optional, but common for settings)
// SettingsSchema.index({ /* a unique field if needed */ }, { unique: true });

// Export the model
const SettingsModel = mongoose.model<ISettings>('Settings', SettingsSchema);

export default SettingsModel; 