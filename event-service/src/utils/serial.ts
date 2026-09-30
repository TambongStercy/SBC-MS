import { customAlphabet } from 'nanoid';

// SBC-XXXXXX — 6 uppercase alphanumeric chars, avoiding lookalikes (0/O, 1/I).
const nano = customAlphabet('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', 6);

export const generateTicketSerial = (): string => `SBC-${nano()}`;

// Shorter friendly code for events used in shareable slugs when the title is empty.
const slugNano = customAlphabet('abcdefghijkmnpqrstuvwxyz23456789', 6);
export const generateEventSlugSuffix = (): string => slugNano();
