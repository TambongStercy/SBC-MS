/**
 * Type declarations for optional dependencies that may not be installed.
 * These are used for NSFW content moderation which is optional.
 */

declare module '@tensorflow/tfjs-node' {
    export const node: {
        decodeImage(buffer: Buffer, channels?: number): Promise<any>;
    };
    export function dispose(): void;
}

declare module 'nsfwjs' {
    export interface NSFWModel {
        classify(image: any): Promise<Array<{ className: string; probability: number }>>;
    }
    export function load(modelPath?: string): Promise<NSFWModel>;
}
