import React from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Download04Icon } from '@hugeicons/core-free-icons';
import UsersOverViewCahrt from './charts/usersOverViewCahrt';
import { formatMoney } from './common/format';
import { Button, EmptyState, Panel, PanelHeader, ResponsiveList, type ListColumn } from './ui';
import { MemberIdentity } from './members/shared';

interface User {
  id: string;
  name: string;
  email: string;
  phoneNumber: string;
  balance: number;
  usdBalance?: number;
  avatar: string;
}

interface MonthlyUserSubData {
  monthLabel: string;
  Users: number;
  Classique: number;
  Cible: number;
  Relance: number;
}

interface UnsubcribedUsersTableProps {
  users: User[];
  monthlyData: MonthlyUserSubData[];
}

const openInNewTab = (url: string) => { window.open(url, '_blank', 'noreferrer'); };

/**
 * Legacy "last members without a pack" list with its two downloads. Not used
 * by any screen today; kept on the kit with its props.
 */
const UnsubcribedUsersTable: React.FC<UnsubcribedUsersTableProps> = ({ users, monthlyData }) => {
  const columns: ListColumn<User>[] = [
    { key: 'who', header: 'Membre', cell: u => <MemberIdentity name={u.name} email={u.email} avatar={u.avatar} /> },
    { key: 'phone', header: 'Téléphone', cell: u => <span className="tabular-nums">{u.phoneNumber || '—'}</span> },
    { key: 'balance', header: 'Solde', numeric: true, cell: u => formatMoney(u.balance ?? 0, 'XAF') },
    { key: 'usd', header: 'Solde $', numeric: true, cell: u => formatMoney(u.usdBalance ?? 0, 'USD') },
  ];
  return (
    <div className="space-y-6">
      <Panel>
        <PanelHeader
          title="Derniers membres sans abonnement"
          actions={(
            <>
              <Button size="sm" onClick={() => openInNewTab(import.meta.env.VITE_API_URL + '/download-nonsub')}>
                <HugeiconsIcon icon={Download04Icon} size={16} aria-hidden="true" /> Télécharger
              </Button>
              <Button size="sm" onClick={() => openInNewTab(import.meta.env.VITE_API_URL + '/download-nonsub-csv')}>
                <HugeiconsIcon icon={Download04Icon} size={16} aria-hidden="true" /> CSV
              </Button>
            </>
          )}
        />
        <ResponsiveList rows={users} columns={columns} rowKey={u => u.id} empty={<EmptyState title="Aucun membre sans abonnement" />} />
      </Panel>
      <UsersOverViewCahrt data={monthlyData} />
    </div>
  );
};

export default UnsubcribedUsersTable;
