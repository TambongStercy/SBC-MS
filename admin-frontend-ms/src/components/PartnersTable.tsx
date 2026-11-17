import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge, Button, EmptyState, Panel, PanelHeader, ResponsiveList, type ListColumn } from './ui';
import { MemberIdentity, SearchInput } from './members/shared';
import Pagination from './Pagination';

interface Partner {
    id: string;
    name: string;
    email: string;
    phoneNumber: string;
    pack: string;
    avatar?: string;
}

const PAGE_SIZE = 50;

/**
 * Legacy partner list filtered in the browser. Not used by any screen today
 * (the Partenaires page lists from the API); kept on the kit with its props.
 */
const PartnersTable = ({ partners }: { partners: Partner[] }) => {
    const navigate = useNavigate();
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);

    const filtered = useMemo(() => {
        const term = search.toLowerCase();
        return term
            ? partners.filter(p => p.name.toLowerCase().includes(term) || p.email.toLowerCase().includes(term) || p.phoneNumber.includes(term))
            : partners;
    }, [partners, search]);
    const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    const columns: ListColumn<Partner>[] = [
        { key: 'who', header: 'Partenaire', cell: p => <MemberIdentity name={p.name} email={p.email} avatar={p.avatar} /> },
        { key: 'phone', header: 'Téléphone', cell: p => <span className="tabular-nums">{p.phoneNumber || '—'}</span> },
        { key: 'pack', header: 'Pack', cell: p => <Badge tone={p.pack?.toLowerCase() === 'gold' ? 'warning' : 'neutral'}>{p.pack}</Badge> },
        {
            key: 'payout', header: <span className="sr-only">Retrait</span>, hideOnCard: true, className: 'text-right',
            cell: p => (
                <Button asChild variant="ghost" size="sm" onClick={e => e.stopPropagation()}>
                    <Link to="/retraitPartenaire" state={{ user: p }}>Retrait</Link>
                </Button>
            ),
        },
    ];

    return (
        <Panel>
            <PanelHeader
                title="Liste des partenaires"
                actions={<SearchInput value={search} onChange={v => { setSearch(v); setPage(1); }} placeholder="Rechercher" />}
            />
            <ResponsiveList
                rows={rows}
                columns={columns}
                rowKey={p => p.id}
                onRowClick={p => navigate(`/userpage/${p.id}`)}
                empty={<EmptyState title="Aucun partenaire" />}
            />
            <Pagination postsPerPage={PAGE_SIZE} totalPosts={filtered.length} currentPage={page} setCurrentPage={setPage} />
        </Panel>
    );
};

export default PartnersTable;
