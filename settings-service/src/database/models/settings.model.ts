import mongoose, { Schema, Document, Types } from 'mongoose';

// Reusable Interface for File References (supports both Drive and Cloud Storage)
// Export this so EventModel can use it
export interface IFileReference {
    fileId: string;         // Google Drive File ID or Cloud Storage filename
    url?: string;           // CDN URL for Cloud Storage or proxy URL for Drive
    fileName?: string;      // Original filename
    mimeType?: string;      // File MIME type
    size?: number;          // File size in bytes
    storageType?: 'drive' | 'gcs'; // Storage backend type
}

// New Interface for Formations
export interface IFormation extends Types.Subdocument { // Use Subdocument for array elements
    _id: Types.ObjectId; // Mongoose adds _id by default to subdocuments
    title: string;
    link: string;
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

    // New Formations field
    formations: Types.DocumentArray<IFormation>; // Array of formation objects

    // Remove Events array - moved to separate EventModel
    // events: Types.DocumentArray<IEventItem>;

    createdAt: Date;
    updatedAt: Date;
}

// Schema for File Reference (supports both Drive and Cloud Storage)
// Export this so EventModel can use it
export const FileReferenceSchema: Schema = new Schema({
    fileId: { type: String, required: true },
    url: { type: String }, // CDN URL for new files, proxy URL for legacy files
    fileName: { type: String },
    mimeType: { type: String },
    size: { type: Number },
    storageType: { type: String, enum: ['drive', 'gcs'], default: 'drive' },
}, { _id: false });

// Remove EventItemSchema - moved to event.model.ts
// const EventItemSchema: Schema = new Schema({ ... });

// New Schema for Formation
export const FormationSchema: Schema = new Schema({
    title: { type: String, required: true, trim: true },
    link: { type: String, required: true, trim: true },
}, { _id: true }); // Mongoose adds _id by default, but explicitly setting it to true for clarity

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

        // New Formations array
        formations: [FormationSchema], // Array of FormationSchema subdocuments
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