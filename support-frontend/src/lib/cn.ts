import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Class names, conditionally joined, later Tailwind utilities winning over earlier ones. */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
