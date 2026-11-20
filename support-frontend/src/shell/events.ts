/** Opens the command palette from anywhere (header search button…). */
export const OPEN_COMMAND_EVENT = 'sbc-support:command';
export const openCommandPalette = () => window.dispatchEvent(new Event(OPEN_COMMAND_EVENT));
