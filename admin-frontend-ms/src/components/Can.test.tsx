import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AuthContext, type AuthContextType } from '../context/AuthContext';
import type { Permissions } from '../lib/permissions';
import { Can } from './Can';

function renderWith(permissions: Permissions | null, ui: ReactNode) {
  const value = { permissions } as AuthContextType;
  return render(<AuthContext.Provider value={value}>{ui}</AuthContext.Provider>);
}

afterEach(cleanup);

describe('<Can>', () => {
  it('shows read content on read and write access', () => {
    renderWith({ members: 'read' }, <Can module="members"><span>liste</span></Can>);
    expect(screen.queryByText('liste')).not.toBeNull();
  });

  it('hides write content on read-only access and shows the fallback', () => {
    renderWith(
      { members: 'read' },
      <Can module="members" write fallback={<span>lecture seule</span>}><button type="button">Bloquer</button></Can>,
    );
    expect(screen.queryByText('Bloquer')).toBeNull();
    expect(screen.queryByText('lecture seule')).not.toBeNull();
  });

  it('shows write content on write access', () => {
    renderWith({ members: 'write' }, <Can module="members" write><button type="button">Bloquer</button></Can>);
    expect(screen.queryByText('Bloquer')).not.toBeNull();
  });

  it('hides everything without access', () => {
    renderWith({ finance: 'write' }, <Can module="members"><span>liste</span></Can>);
    expect(screen.queryByText('liste')).toBeNull();
    renderWith(null, <Can module="members"><span>rien</span></Can>);
    expect(screen.queryByText('rien')).toBeNull();
  });
});
