import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import App from '../../App';
import { mockApi } from '../../test/mockApi';
import { makeAgent, renderWithProviders } from '../../test/render';

const summary = {
  currency: 'XAF',
  byStatus: [{ status: 'PENDING', count: 9, amount: 450000 }, { status: 'UNKNOWN', count: 2, amount: 80000 }],
  ageBuckets: [
    { bucket: '<24h', count: 5, amount: 250000 },
    { bucket: '24-48h', count: 3, amount: 120000 },
    { bucket: '48-72h', count: 2, amount: 90000 },
    { bucket: '>72h', count: 1, amount: 70000 },
  ],
};

describe('Finance', () => {
  it('shows the 24/48/72 h buckets from the summary', async () => {
    mockApi({ 'GET /auth/me': { data: { agent: makeAgent(['finance_agent']) } }, 'GET /finance/summary': { data: summary } });
    renderWithProviders(<App />, { path: '/finance' });
    expect(await screen.findByTestId('bucket-<24h', {}, { timeout: 4000 })).toHaveTextContent('5'); // the whole app renders first: 1 s is too short under load
    expect(screen.getByTestId('bucket-24-48h')).toHaveTextContent('3');
    expect(screen.getByTestId('bucket-48-72h')).toHaveTextContent('2');
    expect(screen.getByTestId('bucket->72h')).toHaveTextContent('1');
    expect(screen.getByText('Plus de 72 h')).toBeInTheDocument();
  });

  it('?ageBucket opens the withdrawals list filtered, and a regularization request carries the reauth token', async () => {
    document.cookie = 'sbc_sup_csrf=tok; path=/';
    const m = mockApi({
      'GET /auth/me': { data: { agent: makeAgent(['finance_agent']) } },
      'GET /finance/withdrawals': {
        data: {
          items: [{ transactionId: 'tx-42', userId: 'u1', memberName: 'Jean K.', amount: 25000, currency: 'XAF', status: 'processing', businessStatus: 'UNKNOWN', gateway: 'MoneyFusion', country: 'CM', createdAt: new Date(Date.now() - 80 * 3600e3).toISOString(), ageBucket: '>72h' }],
          total: 1, page: 1, limit: 20,
        },
      },
      'POST /auth/reauth': { data: { reauthToken: 'rt-fin' } },
      'POST /finance/withdrawals/tx-42/regularization-requests': { data: { approvalId: 'ap-9' } },
    });
    renderWithProviders(<App />, { path: '/finance?ageBucket=%3E72h' });

    const btn = (await screen.findAllByRole('button', { name: 'Demander une régularisation du retrait tx-42' }))[0];
    expect(m.find('GET', '/finance/withdrawals')[0].query.get('ageBucket')).toBe('>72h');
    fireEvent.click(btn);

    const dialog = await screen.findByRole('dialog', { name: 'Demander une régularisation' });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Marquer échoué' }));
    fireEvent.change(within(dialog).getByLabelText(/Motif/), { target: { value: 'Échec confirmé par MoneyFusion' } });
    fireEvent.change(within(dialog).getByLabelText(/Preuves/), { target: { value: 'MF-TOKEN-1\n\nhttps://exemple.test/capture.png\n' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Envoyer la demande' }));

    fireEvent.change(await screen.findByLabelText('Code de l’application'), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }));

    await waitFor(() => expect(m.find('POST', '/finance/withdrawals/tx-42/regularization-requests')).toHaveLength(1));
    const call = m.find('POST', '/finance/withdrawals/tx-42/regularization-requests')[0];
    expect(call.headers.get('x-reauth-token')).toBe('rt-fin');
    expect(call.headers.get('x-csrf-token')).toBe('tok');
    expect(call.body).toEqual({ action: 'fail', reason: 'Échec confirmé par MoneyFusion', evidence: ['MF-TOKEN-1', 'https://exemple.test/capture.png'] });
  });
});
