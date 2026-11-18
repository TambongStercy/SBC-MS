import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import App from '../../App';
import type { SupportCase } from '../../api/types';
import { mockApi } from '../../test/mockApi';
import { makeAgent, renderWithProviders } from '../../test/render';

const kase: SupportCase = {
  id: 'case-1',
  type: 'unknown_status',
  status: 'open',
  severity: 'critical',
  subject: { userId: 'u-7', memberName: 'Jean K.', transactionId: 'tx-7', gateway: 'MoneyFusion' },
  summary: 'Retrait sans réponse finale après 72 h',
  details: { tokenPay: 'MF-abc' },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  checks: [],
  comments: [],
};

describe('finance case sheet', () => {
  it('opens from the Dossiers tab, rechecks and links to the member', async () => {
    document.cookie = 'sbc_sup_csrf=tok; path=/';
    const m = mockApi({
      'GET /auth/me': { data: { agent: makeAgent(['finance_agent']) } },
      'GET /cases': { data: { items: [kase], total: 1, page: 1, limit: 20 } },
      'GET /cases/case-1': { data: kase },
      'POST /cases/case-1/recheck': { data: { result: 'pending', provider: 'MoneyFusion', providerStatus: 'pending', providerRef: 'MF-abc', checkedAt: new Date().toISOString(), requestId: 'r-1' } },
    });
    renderWithProviders(<App />, { path: '/finance?tab=dossiers' });
    // The finance page loads several lists first: under a full parallel run that takes over 1 s.
    fireEvent.click((await screen.findAllByText('Retrait sans réponse finale après 72 h', {}, { timeout: 5000 }))[0]);
    const sheet = await screen.findByRole('dialog');
    expect(await within(sheet).findByRole('link', { name: 'Jean K.' })).toHaveAttribute('href', '/membres/u-7');
    expect(m.find('GET', '/cases')[0].query.get('type')).toBe('finance');
    // members.read: link; finance_agent may request a regularization from the case
    expect(within(sheet).getByRole('button', { name: 'Demander une régularisation' })).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: /Revérifier/ }));
    await waitFor(() => expect(m.find('POST', '/cases/case-1/recheck')).toHaveLength(1));
    expect(await within(sheet).findByText('En attente')).toBeInTheDocument();
  }, 12000);
});
