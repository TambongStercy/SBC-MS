import { Toaster } from 'sonner';
import { Toaster as HotToaster } from 'react-hot-toast';
import { useTheme } from '../contexts/theme';

/**
 * Toasts follow the light or dark theme.
 * - sonner: the app's toaster (useToast() routes to it, new code calls `toast` from 'sonner').
 * - react-hot-toast: still called by original pages (`toast.success(...)` from
 *   'react-hot-toast'); its toaster stays mounted, drawn with the tokens,
 *   until those pages move to sonner.
 */
export function ThemedToaster() {
  const { resolved } = useTheme();
  return (
    <>
      <Toaster richColors closeButton position="top-right" duration={4000} theme={resolved} toastOptions={{ style: { fontFamily: 'var(--font-sans)' } }} />
      <HotToaster
        position="top-left"
        toastOptions={{
          style: {
            background: 'var(--surface)',
            color: 'var(--fg)',
            border: '1px solid var(--line)',
            boxShadow: 'var(--shadow-overlay)',
            fontFamily: 'var(--font-sans)',
            fontSize: '14px',
          },
          error: { duration: 5000 },
        }}
      />
    </>
  );
}
