import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { approvalsApi } from '../api/approvals';
import { mockApi } from '../test/mockApi';
import { renderWithProviders } from '../test/render';
import { isReauthCancelled, useReauth } from './reauth';

function Sensitive() {
  const reauth = useReauth();
  const [result, setResult] = useState('');
  return (
    <>
      <button onClick={async () => {
        try {
          const token = await reauth({ title: 'Valider la demande' });
          await approvalsApi.approve('ap-1', undefined, token);
          setResult('done');
        } catch (e) {
          setResult(isReauthCancelled(e) ? 'cancelled' : 'error');
        }
      }}>Approuver</button>
      <output>{result}</output>
    </>
  );
}

describe('reauth modal', () => {
  it('asks for a TOTP code, then sends the action with x-reauth-token', async () => {
    document.cookie = 'sbc_sup_csrf=tok; path=/';
    const m = mockApi({
      'GET /auth/me': { status: 401 },
      'POST /auth/reauth': (c) => ((c.body as { code: string }).code === '111111' ? { data: { reauthToken: 'rt-xyz' } } : { status: 401, message: 'Code invalide.' }),
      'POST /approvals/ap-1/approve': { data: { id: 'ap-1' } },
    });
    renderWithProviders(<Sensitive />);
    fireEvent.click(screen.getByRole('button', { name: 'Approuver' }));
    const dialog = await screen.findByRole('dialog', { name: 'Valider la demande' });
    expect(dialog).toBeTruthy();

    // A wrong code keeps the modal open with the server's message.
    fireEvent.change(screen.getByLabelText('Code de l’application'), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }));
    expect(await screen.findByText('Code invalide.')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Code de l’application'), { target: { value: '111111' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }));
    await waitFor(() => expect(m.find('POST', '/approvals/ap-1/approve')).toHaveLength(1));
    expect(m.find('POST', '/approvals/ap-1/approve')[0].headers.get('x-reauth-token')).toBe('rt-xyz');
    await screen.findByText('done');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closing the modal cancels the action', async () => {
    const m = mockApi({ 'GET /auth/me': { status: 401 } });
    renderWithProviders(<Sensitive />);
    fireEvent.click(screen.getByRole('button', { name: 'Approuver' }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    await screen.findByText('cancelled');
    expect(m.find('POST', '/approvals/ap-1/approve')).toHaveLength(0);
  });
});
