import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchUsers } from '../api';
import Pagination from './Pagination';
import { ErrorState } from './common/DataStates';
import { formatMoney } from './common/format';
import { Badge, EmptyState, Panel, PanelHeader, ResponsiveList, type ListColumn } from './ui';
import { MemberIdentity, SearchInput } from './members/shared';

interface LegacyUser {
  _id: string;
  name?: string;
  email?: string;
  avatar?: string;
  phoneNumber?: string | number;
  balance?: number;
  usdBalance?: number;
  referralCode?: string;
  isSubscribed?: boolean;
}

const PAGE_SIZE = 30;

/**
 * Legacy member list (GET /users, search by name). Not used by any screen
 * today — the Membres page uses the admin list — kept on the kit for reuse.
 */
function UserTable() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [users, setUsers] = useState<LegacyUser[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchUsers(search, page, PAGE_SIZE, controller.signal)
      .then(res => { setUsers(res.users ?? []); setTotal(res.total ?? 0); setLoading(false); })
      .catch(err => {
        if (err?.code === 'ERR_CANCELED') return;
        setError('Impossible de charger les données');
        setLoading(false);
      });
    return () => controller.abort();
  }, [search, page, attempt]);

  const columns: ListColumn<LegacyUser>[] = [
    { key: 'who', header: 'Membre', cell: u => <MemberIdentity name={u.name} email={u.email} avatar={u.avatar} /> },
    { key: 'phone', header: 'Téléphone', cell: u => <span className="tabular-nums">{u.phoneNumber || '—'}</span> },
    { key: 'code', header: 'Code', cell: u => <span className="font-mono text-xs">{u.referralCode || '—'}</span> },
    { key: 'balance', header: 'Solde', numeric: true, cell: u => formatMoney(u.balance ?? 0, 'XAF') },
    { key: 'usd', header: 'Solde $', numeric: true, cell: u => formatMoney(u.usdBalance ?? 0, 'USD') },
    { key: 'sub', header: 'Statut', cell: u => (u.isSubscribed ? <Badge tone="success">Abonné</Badge> : <Badge tone="outline">Non abonné</Badge>) },
  ];

  return (
    <Panel>
      <PanelHeader
        title="Liste des membres"
        actions={<SearchInput value={search} onChange={v => { setSearch(v); setPage(1); }} placeholder="Rechercher un nom" />}
      />
      <ResponsiveList
        rows={users}
        columns={columns}
        rowKey={u => u._id}
        onRowClick={u => navigate(`/userpage/${u._id}`)}
        loading={loading}
        empty={error
          ? <ErrorState description={error} onRetry={() => setAttempt(a => a + 1)} />
          : <EmptyState title="Aucun membre" />}
      />
      <Pagination postsPerPage={PAGE_SIZE} totalPosts={total} currentPage={page} setCurrentPage={setPage} />
    </Panel>
  );
}

export default UserTable;
