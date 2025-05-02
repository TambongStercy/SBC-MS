import { IUser } from '../database/models/user.model';

/**
 * Escapes special characters in vCard fields according to RFC 6350
 * @param value The string to escape
 * @returns The escaped string
 */
export const escapeVCardField = (value: string | number | undefined): string => {
    if (value === undefined) return '';
    const strValue = String(value);
    return strValue
        .replace(/,/g, '\\,')
        .replace(/;/g, '\\;')
        .replace(/\\/g, '\\\\')
        .replace(/\n/g, '\\n');
};

/**
 * Generates a vCard (VCF) format string for a single user
 * @param user The user object to convert to vCard format
 * @returns A vCard formatted string
 */
export const generateVCard = (user: IUser): string => {
    const { name, email, phoneNumber, region } = user;

    // Format the vCard according to the RFC 6350 specification
    const vCardLines = [
        'BEGIN:VCARD',
        'VERSION:3.0',
        `FN:${escapeVCardField(name)}`,
        `N:${escapeVCardField(name)};;;`,
        email ? `EMAIL:${escapeVCardField(email)}` : '',
        phoneNumber ? `TEL;TYPE=CELL:${escapeVCardField(phoneNumber)}` : '',
        region ? `ADR;TYPE=HOME:;;${escapeVCardField(region)};;;` : '',
        `REV:${new Date().toISOString()}`,
        'END:VCARD'
    ];

    // Filter out empty lines and join with CRLF as required by the spec
    return vCardLines.filter(line => line).join('\r\n') + '\r\n';
};

/**
 * Generates a VCF file buffer from a list of users
 * @param users The array of user objects to convert to VCF format
 * @returns A Buffer containing the VCF file content
 */
export const generateVCFFile = (users: Array<{
    name: string;
    email: string;
    phoneNumber?: string;
    region?: string;
    shareContactInfo?: boolean;
}>): Buffer => {
    const vcfContent = users
        .filter(user => user.shareContactInfo !== false)
        .map(user => generateVCard(user as IUser))
        .join('\r\n');

    return Buffer.from(vcfContent, 'utf8');
}; 