/** Same field, panel and button looks as the other admin pages (dark greys, frosted panels). */
export const fieldClass =
    'w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-60';
export const labelClass = 'block text-sm text-gray-300 mb-1';
export const panelClass = 'bg-gray-800 bg-opacity-50 backdrop-blur-md shadow-lg rounded-xl border border-gray-700';

const BTN = 'inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors disabled:bg-gray-600 disabled:text-gray-300 disabled:cursor-not-allowed';
export const btn = {
    primary: `${BTN} px-4 py-2 bg-blue-600 text-white hover:bg-blue-700`,
    success: `${BTN} px-4 py-2 bg-green-600 text-white hover:bg-green-700`,
    warning: `${BTN} px-4 py-2 bg-yellow-500 text-gray-900 hover:bg-yellow-600`,
    danger: `${BTN} px-4 py-2 bg-red-600 text-white hover:bg-red-700`,
    secondary: `${BTN} px-4 py-2 bg-gray-700 text-gray-200 hover:bg-gray-600`,
    smallPrimary: `${BTN} px-3 py-1.5 text-xs bg-blue-600 text-white hover:bg-blue-700`,
    smallSuccess: `${BTN} px-3 py-1.5 text-xs bg-green-600 text-white hover:bg-green-700`,
    smallDanger: `${BTN} px-3 py-1.5 text-xs bg-red-600 text-white hover:bg-red-700`,
    smallSecondary: `${BTN} px-3 py-1.5 text-xs bg-gray-700 text-gray-200 hover:bg-gray-600`,
};
