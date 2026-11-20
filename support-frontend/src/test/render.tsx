import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../auth/AuthProvider';
import { ReauthProvider } from '../auth/reauth';
import { Toaster } from '../components/toast';
import { TooltipProvider } from '../components/ui/tooltip';
import { ThemeProvider } from '../contexts/ThemeContext';
import { permissionsForRoles, type Role } from '../lib/permissions';
import type { Agent } from '../api/types';

export function makeAgent(roles: Role[], over: Partial<Agent> = {}): Agent {
  return { id: 'agent-1', name: 'Awa Diallo', email: 'awa@sbc.test', roles, permissions: permissionsForRoles(roles), ...over };
}

/** Renders `ui` with every provider of the app, at `path`. */
export function renderWithProviders(ui: ReactElement, { path = '/' }: { path?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return render(
    <ThemeProvider>
      <TooltipProvider>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={[path]}>
            <AuthProvider>
              <ReauthProvider>{ui}</ReauthProvider>
            </AuthProvider>
          </MemoryRouter>
          <Toaster />
        </QueryClientProvider>
      </TooltipProvider>
    </ThemeProvider>,
  );
}
