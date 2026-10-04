import { QueryClient } from '@tanstack/react-query';

/**
 * Admins mostly work on phones, often on mobile data: keep answers for 30 s,
 * refresh when the tab comes back, and retry a flaky request once.
 */
export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: true,
        },
    },
});
