import { Schema, model } from 'mongoose';

interface ArticleContent { title: string; summary?: string; body: string; media?: { type: 'video' | 'pdf' | 'link'; url: string; title?: string }[] }

/**
 * Knowledge-base article. `draft` is what editors change; `published` is what
 * members (and the assistant) read. Publishing copies the draft and keeps the
 * previous published content in `versions`.
 */
export interface IKbArticle {
    slug: string;
    category: string;
    tags: string[];
    audience: 'member' | 'agent';
    status: 'draft' | 'published' | 'archived';
    draft: ArticleContent;
    published?: (ArticleContent & { version: number; at: Date; by: string }) | null;
    version: number;
    versions: (ArticleContent & { version: number; at: Date; by: string })[];
    updatedBy?: string | null;
    createdAt?: Date;
    updatedAt?: Date;
}

const MediaSchema = new Schema({ type: { type: String, enum: ['video', 'pdf', 'link'] }, url: String, title: String }, { _id: false });
const ContentFields = { title: String, summary: String, body: String, media: { type: [MediaSchema], default: [] } };

const KbArticleSchema = new Schema<IKbArticle>({
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, match: /^[a-z0-9-]{3,80}$/ },
    category: { type: String, required: true },
    tags: { type: [String], default: [] },
    audience: { type: String, enum: ['member', 'agent'], default: 'member' },
    status: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft', index: true },
    draft: { type: new Schema(ContentFields, { _id: false }), required: true },
    published: { type: new Schema({ ...ContentFields, version: Number, at: Date, by: String }, { _id: false }), default: null },
    version: { type: Number, default: 0 },
    versions: { type: [new Schema({ ...ContentFields, version: Number, at: Date, by: String }, { _id: false })], default: [] },
    updatedBy: { type: String, default: null },
}, { timestamps: true });

KbArticleSchema.index(
    { 'published.title': 'text', 'published.summary': 'text', 'published.body': 'text', tags: 'text' },
    { name: 'kb_published_text', default_language: 'french', weights: { 'published.title': 10, tags: 6, 'published.summary': 4, 'published.body': 1 } },
);

export const KbArticle = model<IKbArticle>('KbArticle', KbArticleSchema, 'kbarticles');
