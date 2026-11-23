import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import JuryPanel from './JuryPanel';
import * as api from '../../services/impactV2Api';
import { conflict, finalEdition, juryOverview, renderWithClient } from './finaleTestUtils';

vi.mock('../../services/impactV2Api', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../services/impactV2Api')>()),
    getJury: vi.fn(),
    lookupMember: vi.fn(),
    addJuror: vi.fn(),
    removeJuror: vi.fn(),
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const openAdd = async () => {
    fireEvent.click(await screen.findByRole('button', { name: /Ajouter un juré/ }));
    return screen.findByRole('dialog', { name: 'Ajouter un juré' });
};
const search = (d: HTMLElement, contact: string) => {
    fireEvent.change(within(d).getByLabelText(/E-mail ou numéro/), { target: { value: contact } });
    fireEvent.click(within(d).getByRole('button', { name: /Rechercher/ }));
};

describe('JuryPanel', () => {
    it('shows each juror’s progress, the removed one struck through', async () => {
        vi.mocked(api.getJury).mockResolvedValue(juryOverview());
        renderWithClient(<JuryPanel edition={finalEdition()} canWrite onChanged={vi.fn()} />);
        const active = await screen.findByTestId('juror-j1');
        expect(within(active).getByText('2/3 finalistes notés')).toBeTruthy();
        expect(within(screen.getByTestId('juror-j2')).getByText('Juré Retiré').className).toMatch(/line-through/);
        expect(within(screen.getByTestId('juror-j2')).queryByRole('button', { name: 'Retirer' })).toBeNull();
    });

    it('finds the member by contact (name + masked contact), then adds them', async () => {
        vi.mocked(api.getJury).mockResolvedValue(juryOverview());
        vi.mocked(api.lookupMember).mockResolvedValueOnce({ found: true, userId: 'u9', name: 'Mme Jurée', contactHint: 'j***@g***.com' });
        vi.mocked(api.addJuror).mockResolvedValueOnce({ _id: 'j9', userId: 'u9', name: 'Mme Jurée' });
        const onChanged = vi.fn();
        renderWithClient(<JuryPanel edition={finalEdition()} canWrite onChanged={onChanged} />);
        const d = await openAdd();
        const add = within(d).getByRole('button', { name: 'Ajouter au jury' }) as HTMLButtonElement;
        expect(add.disabled).toBe(true);
        search(d, 'jury@gmail.com');
        await waitFor(() => expect(api.lookupMember).toHaveBeenCalledWith('jury@gmail.com'));
        expect(await within(d).findByText('Mme Jurée')).toBeTruthy();
        expect(within(d).getByText('j***@g***.com')).toBeTruthy();
        fireEvent.click(add);
        await waitFor(() => expect(api.addJuror).toHaveBeenCalledWith('e1', 'u9'));
        expect(onChanged).toHaveBeenCalled();
    });

    it('says when nobody matches, or when the number is shared', async () => {
        vi.mocked(api.getJury).mockResolvedValue(juryOverview());
        vi.mocked(api.lookupMember)
            .mockResolvedValueOnce({ found: false })
            .mockResolvedValueOnce({ found: false, ambiguous: true });
        renderWithClient(<JuryPanel edition={finalEdition()} canWrite onChanged={vi.fn()} />);
        const d = await openAdd();
        search(d, 'inconnu@gmail.com');
        expect(await within(d).findByText(/Aucun compte SBC ne correspond/)).toBeTruthy();
        search(d, '670000000');
        expect(await within(d).findByText(/Plusieurs comptes correspondent à ce numéro/)).toBeTruthy();
    });

    it.each([
        ['CONFLICT_OF_INTEREST', 'Un finaliste ne peut pas faire partie du jury.'],
        ['ALREADY_JUROR', 'Ce membre fait déjà partie du jury.'],
        ['TOO_MANY_JURORS', '15 jurés au plus.'],
    ])('shows the server’s refusal %s in the dialog', async (code, message) => {
        vi.mocked(api.getJury).mockResolvedValue(juryOverview());
        vi.mocked(api.lookupMember).mockResolvedValueOnce({ found: true, userId: 'u9', name: 'Awa', contactHint: '+237 6** ** ** 12' });
        vi.mocked(api.addJuror).mockRejectedValueOnce(conflict(code, message));
        renderWithClient(<JuryPanel edition={finalEdition()} canWrite onChanged={vi.fn()} />);
        const d = await openAdd();
        search(d, '+237670000012');
        await within(d).findByText('Awa');
        fireEvent.click(within(d).getByRole('button', { name: 'Ajouter au jury' }));
        expect(await within(d).findByText(message)).toBeTruthy();
    });

    it('removes a juror with a reason of 5 characters, saying their marks stop counting', async () => {
        vi.mocked(api.getJury).mockResolvedValue(juryOverview());
        vi.mocked(api.removeJuror).mockResolvedValueOnce({});
        renderWithClient(<JuryPanel edition={finalEdition()} canWrite onChanged={vi.fn()} />);
        fireEvent.click(within(await screen.findByTestId('juror-j1')).getByRole('button', { name: 'Retirer' }));
        const d = await screen.findByRole('dialog', { name: /Retirer Juré Un du jury/ });
        expect(within(d).getByText(/Ses notes ne compteront plus/)).toBeTruthy();
        const confirm = within(d).getByRole('button', { name: 'Retirer du jury' }) as HTMLButtonElement;
        fireEvent.change(within(d).getByLabelText(/Raison/), { target: { value: 'abc' } });
        expect(confirm.disabled).toBe(true);
        fireEvent.change(within(d).getByLabelText(/Raison/), { target: { value: 'Lien avec un finaliste' } });
        fireEvent.click(confirm);
        await waitFor(() => expect(api.removeJuror).toHaveBeenCalledWith('e1', 'j1', 'Lien avec un finaliste'));
    });

    it('changes nothing once the marks are locked', async () => {
        vi.mocked(api.getJury).mockResolvedValue(juryOverview({ lockedAt: '2026-12-21T12:00:00.000Z' }));
        renderWithClient(<JuryPanel edition={finalEdition({ jury: { lockedAt: '2026-12-21T12:00:00.000Z' } })} canWrite onChanged={vi.fn()} />);
        await screen.findByTestId('juror-j1');
        expect(screen.queryByRole('button', { name: /Ajouter un juré/ })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Retirer' })).toBeNull();
        expect(screen.getByText('Notes verrouillées')).toBeTruthy();
    });
});
