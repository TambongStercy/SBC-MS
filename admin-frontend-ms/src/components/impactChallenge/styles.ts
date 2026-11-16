/** Same field, panel and button looks as the other admin pages (theme tokens). */
export const fieldClass =
    'w-full px-3 py-2 bg-surface border border-line-strong rounded-lg text-fg placeholder-fg-subtle focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-60';
export const labelClass = 'block text-sm text-fg-muted mb-1';
export const panelClass = 'bg-surface rounded-xl border border-line';

const BTN = 'inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors disabled:bg-surface-3 disabled:text-fg-muted disabled:cursor-not-allowed';
export const btn = {
    primary: `${BTN} px-4 py-2 bg-blue-600 text-white hover:bg-blue-700`,
    success: `${BTN} px-4 py-2 bg-green-600 text-white hover:bg-green-700`,
    warning: `${BTN} px-4 py-2 bg-yellow-500 text-gray-900 hover:bg-yellow-600`,
    danger: `${BTN} px-4 py-2 bg-red-600 text-white hover:bg-red-700`,
    secondary: `${BTN} px-4 py-2 bg-surface-2 text-fg hover:bg-surface-3`,
    smallPrimary: `${BTN} px-3 py-1.5 text-xs bg-blue-600 text-white hover:bg-blue-700`,
    smallSuccess: `${BTN} px-3 py-1.5 text-xs bg-green-600 text-white hover:bg-green-700`,
    smallDanger: `${BTN} px-3 py-1.5 text-xs bg-red-600 text-white hover:bg-red-700`,
    smallSecondary: `${BTN} px-3 py-1.5 text-xs bg-surface-2 text-fg hover:bg-surface-3`,
};
