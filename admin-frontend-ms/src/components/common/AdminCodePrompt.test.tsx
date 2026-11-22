import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import apiClient from '../../api/apiClient';
import AdminCodePrompt from './AdminCodePrompt';

/**
 * Security plan Phase 3 item 6: a money action refused with ADMIN_CODE_REQUIRED opens the code
 * prompt; the same request is sent again with the code; a cancel leaves the error to the page.
 */
describe('admin code before a money action', () => {
  type Body = Record<string, unknown>;
  type Refused = { response: { status: number } };
  const sent: { url?: string; data: Body }[] = [];
  let answers: Array<{ status: number; data: Body }> = [];
  const realAdapter = apiClient.defaults.adapter;

  beforeEach(() => {
    sent.length = 0;
    apiClient.defaults.adapter = (async (config: InternalAxiosRequestConfig) => {
      sent.push({ url: config.url, data: typeof config.data === 'string' ? JSON.parse(config.data) : config.data });
      const a = answers.shift() ?? { status: 200, data: { success: true } };
      const response = { data: a.data, status: a.status, statusText: '', headers: {}, config };
      if (a.status >= 400) throw Object.assign(new Error(`status ${a.status}`), { response, config, isAxiosError: true });
      return response;
    }) as AxiosAdapter;
    render(<AdminCodePrompt />);
  });
  afterEach(() => { cleanup(); apiClient.defaults.adapter = realAdapter; answers = []; });

  it('asks for the code, then sends the same request again with it', async () => {
    answers = [{ status: 403, data: { success: false, code: 'ADMIN_CODE_REQUIRED', message: 'Confirmez…' } }, { status: 200, data: { success: true, data: { approved: 2 } } }];
    let result: unknown;
    const call = apiClient.post('/payments/admin/withdrawals/bulk-approve', { transactionIds: ['a', 'b'] }).then(r => { result = r.data; });
    const input = await screen.findByLabelText('Code à 6 chiffres');
    fireEvent.change(input, { target: { value: '123 456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }));
    await act(async () => { await call; });
    expect(sent).toHaveLength(2);
    expect(sent[1].data).toEqual({ transactionIds: ['a', 'b'], adminCode: '123456' });
    expect(result).toEqual({ success: true, data: { approved: 2 } });
  });

  it('a wrong code shows the server message and asks again; a backup code can be used', async () => {
    answers = [
      { status: 403, data: { code: 'ADMIN_CODE_REQUIRED' } },
      { status: 403, data: { code: 'ADMIN_CODE_INVALID', message: 'Code incorrect ou déjà utilisé.' } },
      { status: 200, data: { success: true } },
    ];
    const call = apiClient.post('/payments/admin/withdrawals/t1/approve', {});
    fireEvent.change(await screen.findByLabelText('Code à 6 chiffres'), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Code incorrect ou déjà utilisé.');
    fireEvent.click(screen.getByText('Utiliser un code de secours'));
    fireEvent.change(await screen.findByLabelText('Code de secours'), { target: { value: 'abcd-efgh' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }));
    await act(async () => { await call; });
    expect(sent.map(s => s.data)).toEqual([{}, { adminCode: '000000' }, { adminBackupCode: 'abcd-efgh' }]);
  });

  it('cancel: the request fails with the server’s answer, nothing is resent', async () => {
    answers = [{ status: 403, data: { code: 'ADMIN_CODE_REQUIRED', message: 'Confirmez avec le code.' } }];
    const call = apiClient.post('/payments/admin/withdrawals/t1/approve', {}).catch(e => e);
    await screen.findByLabelText('Code à 6 chiffres');
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    const err = (await call) as Refused;
    expect(err.response.status).toBe(403);
    expect(sent).toHaveLength(1);
    await waitFor(() => expect(screen.queryByLabelText('Code à 6 chiffres')).toBeNull());
  });

  it('other 403s (module refused) do not open the prompt', async () => {
    answers = [{ status: 403, data: { success: false, message: 'Accès refusé' } }];
    const err = (await apiClient.post('/payments/admin/withdrawals/t1/reject', {}).catch(e => e)) as Refused;
    expect(err.response.status).toBe(403);
    expect(screen.queryByLabelText('Code à 6 chiffres')).toBeNull();
  });
});
