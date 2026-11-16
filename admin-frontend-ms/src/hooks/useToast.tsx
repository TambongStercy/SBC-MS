import { toast } from 'sonner';
import type { ToastMessage } from '../components/common/ToastContainer';

/*
 * The original useToast API, now shown by sonner (the themed <Toaster> mounted
 * once in main.tsx). Pages keep calling showSuccess/showError/… and keep
 * rendering <ToastContainer toasts={toasts} onRemove={removeToast} />: `toasts`
 * stays empty, so ToastContainer draws nothing and each message appears once,
 * in the shared toaster. New code can import `toast` from 'sonner' directly.
 *
 * Module-level functions: stable across renders, like the useCallback-wrapped
 * originals, so pages listing them in effect dependencies behave the same.
 */
const NO_TOASTS: ToastMessage[] = [];
// sonner closes its own toasts
const removeToast: (id: string) => void = () => {};
const showSuccess = (message: string) => { toast.success(message); };
const showError = (message: string) => { toast.error(message, { duration: 5000 }); };
const showWarning = (message: string) => { toast.warning(message); };
const showInfo = (message: string) => { toast.info(message); };

export const useToast = () => ({
  toasts: NO_TOASTS,
  removeToast,
  showSuccess,
  showError,
  showWarning,
  showInfo,
});
