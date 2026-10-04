import toast, { Toaster } from 'react-hot-toast';

/** One toast system, one place, French messages. */
export const notify = {
    success: (m: string) => toast.success(m),
    error: (m: string) => toast.error(m, { duration: 6000 }),
    info: (m: string) => toast(m),
};

export function AppToaster() {
    return (
        <Toaster position="top-center" gutter={8} containerStyle={{ top: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
            toastOptions={{
                className: '!bg-surface !text-ink !border !border-border !rounded-tile !text-sm !font-medium !shadow-none',
                success: { iconTheme: { primary: 'rgb(var(--c-success))', secondary: 'white' } },
                error: { iconTheme: { primary: 'rgb(var(--c-danger))', secondary: 'white' } },
            }} />
    );
}
