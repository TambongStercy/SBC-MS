import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import App from '../../App';
import type { Approval } from '../../api/types';
import { mockApi } from '../../test/mockApi';
import { makeAgent, renderWithProviders } from '../../test/render';

const manager = makeAgent(['finance_manager'], { id: 'agent-1' });

const approval = (id: string, requester: { id: string; name: string }, summary: string): Approval => ({
  id,
  type: 'regularization',
  status: 'pending',
  summary,
  reason: 'Payé côté MoneyFusion, capture jointe.',
  payload: { transactionId: `tx-${id}`, action: 'complete', evidence: ['MF-123'] },
  requestedBy: requester,
  requestedAt: new Date().toISOString(),
});

describe('Approbations', () => {
  it('an agent cannot approve their own request; another one goes through reauth', async () => {
    document.cookie = 'sbc_sup_csrf=tok; path=/';
    const m = mockApi({
      'GET /auth/me': { data: { agent: manager } },
      'GET /approvals': c => (c.query.get('status') === 'pending'
        ? { data: [approval('own', { id: 'agent-1', name: 'Awa Diallo' }, 'Régularisation de mon retrait'), approval('other', { id: 'agent-2', name: 'Paul Mbida' }, 'Régularisation du retrait de Paul')] }
        : { data: [] }),
      'POST /auth/reauth': { data: { reauthToken: 'rt-77' } },
      'POST /approvals/other/approve': { data: { id: 'other' } },
    });
    renderWithProviders(<App />, { path: '/approbations' });

    const own = await screen.findByRole('article', { name: /Régularisation de mon retrait/ });
    expect(within(own).getByText('Vous avez fait cette demande : une autre personne doit la valider.')).toBeInTheDocument();
    expect(within(own).getByRole('button', { name: 'Valider' })).toBeDisabled();
    expect(within(own).getByRole('button', { name: 'Refuser' })).toBeDisabled();

    const other = screen.getByRole('article', { name: /Régularisation du retrait de Paul/ });
    expect(within(other).queryByText(/Vous avez fait cette demande/)).toBeNull();
    const approve = within(other).getByRole('button', { name: 'Valider' });
    expect(approve).toBeEnabled();
    expect(within(other).getByRole('button', { name: 'Refuser' })).toBeEnabled();

    fireEvent.click(approve);
    const confirm = await screen.findByRole('dialog', { name: 'Valider la demande' });
    fireEvent.change(within(confirm).getByLabelText('Note (facultative)'), { target: { value: 'Vu sur le tableau MF' } });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Valider' }));

    const code = await screen.findByLabelText('Code de l’application');
    fireEvent.change(code, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }));

    await waitFor(() => expect(m.find('POST', '/approvals/other/approve')).toHaveLength(1));
    const call = m.find('POST', '/approvals/other/approve')[0];
    expect(call.headers.get('x-reauth-token')).toBe('rt-77');
    expect(call.body).toEqual({ note: 'Vu sur le tableau MF' });
    expect(m.find('POST', '/approvals/own/approve')).toHaveLength(0);
    expect(await screen.findByText('Demande validée.')).toBeInTheDocument();
  });

  it('a requester without approve rights only sees their own requests', async () => {
    mockApi({
      'GET /auth/me': { data: { agent: makeAgent(['support_agent'], { id: 'agent-9' }) } },
      'GET /approvals': c => (c.query.get('mine') === '1' ? { data: [approval('x', { id: 'agent-9', name: 'Awa Diallo' }, 'Changement de téléphone')] } : { data: [] }),
    });
    renderWithProviders(<App />, { path: '/approbations' });
    expect(await screen.findByRole('article', { name: /Changement de téléphone/ })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'À valider' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Valider' })).toBeNull();
  });
});
