import mongoose, { Schema, Document, Types } from 'mongoose';
import { IFileReference, FileReferenceSchema } from './settings.model'; // Import shared file reference parts

// Interface for Event Items
export interface IEvent extends Document {
    _id: Types.ObjectId;
    title: string;
    description: string;
    timestamp: Date;
    image: IFileReference;     // Reference to the event image file
    video?: IFileReference;    // Optional reference to the event video file
    createdAt: Date;
    updatedAt: Date;
}

// Schema for Event Item
const EventSchema: Schema = new Schema(
    {
        title: { type: String, required: true, trim: true },
        description: { type: String, required: true, trim: true },
        timestamp: { type: Date, default: Date.now, required: true, index: true }, // Index timestamp for sorting/querying
        image: { type: FileReferenceSchema, required: true }, // Embed image file reference
        video: { type: FileReferenceSchema, required: false }, // Embed optional video file reference
    },
    {
        timestamps: true, // Automatically adds createdAt and updatedAt
        versionKey: false,
        collection: 'events' // Explicitly name the collection
    }
);

// Export the model
const EventModel = mongoose.model<IEvent>('Event', EventSchema);

export default EventModel; 