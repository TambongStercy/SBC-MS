import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { MemberPicker } from '../../members/MemberPicker';
import type { Member } from '../../members/api';
import { Badge, DataList, EmptyState, Page, Pagination, SearchInput, Select, StatusBadge, Tabs, type Column } from '../../../ui';
import { formatDateTime, formatMoney, formatNumber, thumbnailUrl } from '../../../lib/format';
import { useDebounced, useParamState } from '../../../lib/hooks';
import { FLASH_STATUS, categoryLabel, getProduct, listFlashSales, listProducts, type FlashSale, type FlashStatus, type Product, type View } from './api';
import { ProductSheet } from './ProductSheet';
import { Img } from './Img';

const PAGE = 20;

function Thumb({ p }: { p: Pick<Product, 'images'> }) {
    const id = p.images[0]?.fileId;
    return id ? <Img key={id} src={thumbnailUrl(id, 96)} className="size-11 rounded-tile object-cover shrink-0" /> : <span className="size-11 rounded-tile bg-surface-2 shrink-0" />;
}

function ProductsTab() {
    const [search, setSearch] = useState('');
    const term = useDebounced(search.trim());
    const [view, setView] = useParamState('vue', 'online');
    const [flash, setFlash] = useState(false);
    const [seller, setSeller] = useState<Member | null>(null);
    const [page, setPage] = useState(1);
    const [open, setOpen] = useState<Product | null>(null);
    useEffect(() => setPage(1), [term]);
    const q = useQuery({
        queryKey: ['boutique', 'products', term, view, flash, seller?._id, page],
        queryFn: () => listProducts({ page, limit: PAGE, searchTerm: term, userId: seller?._id, view: view as View, flash }),
        placeholderData: keepPreviousData,
    });
    // Keep the open sheet in step with the list after an edit.
    const current = open ? q.data?.data.find(p => p._id === open._id) ?? open : null;
    const cols: Column<Product>[] = [
        { key: 'n', header: 'Produit', cell: p => <span className="flex items-center gap-3 min-w-0"><Thumb p={p} /><span className="min-w-0"><span className="block font-semibold truncate">{p.name}</span><span className="block text-xs text-ink-2 truncate">{categoryLabel(p.category)}</span></span></span> },
        { key: 'p', header: 'Prix', align: 'right', cell: p => <span className="font-semibold tabular">{formatMoney(p.price)}</span> },
        { key: 's', header: '', cell: p => p.deleted ? <Badge tone="danger">Retiré</Badge> : p.hasActiveFlashSale ? <Badge tone="accent">Vente flash</Badge> : null },
    ];
    return (
        <div className="space-y-3">
            <SearchInput value={search} onChange={setSearch} placeholder="Nom, description ou catégorie" />
            <div className="grid grid-cols-2 lg:grid-cols-[12rem_12rem_1fr] gap-2">
                <Select aria-label="Produits" value={view} onChange={e => { setView(e.target.value); setPage(1); }}>
                    <option value="online">En ligne</option><option value="removed">Retirés</option><option value="all">Tous</option>
                </Select>
                <Select aria-label="Ventes flash" value={flash ? 'oui' : ''} onChange={e => { setFlash(e.target.value === 'oui'); setPage(1); }}>
                    <option value="">Tous les prix</option><option value="oui">En vente flash</option>
                </Select>
                <div className="col-span-2 lg:col-span-1"><MemberPicker value={seller} onChange={m => { setSeller(m); setPage(1); }} /></div>
            </div>
            <DataList rows={q.data?.data} columns={cols} rowKey={p => p._id} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()}
                onRowClick={setOpen} empty={<EmptyState title="Aucun produit">{term || seller || flash ? 'Rien ne correspond à ces filtres.' : null}</EmptyState>}
                card={p => (
                    <span className="flex items-center gap-3">
                        <Thumb p={p} />
                        <span className="min-w-0 flex-1"><span className="block font-semibold truncate">{p.name}</span>
                            <span className="block text-xs text-ink-2 truncate">{formatMoney(p.price)} · {categoryLabel(p.category)}</span></span>
                        {p.deleted ? <Badge tone="danger">Retiré</Badge> : p.hasActiveFlashSale ? <Badge tone="accent">Flash</Badge> : null}
                    </span>
                )} />
            {q.data && <Pagination page={page} totalPages={Math.max(1, q.data.pagination.totalPages)} total={q.data.pagination.totalCount} onChange={setPage} />}
            {current && <ProductSheet p={current} onClose={() => setOpen(null)} />}
        </div>
    );
}

function ProductName({ id, onOpen }: { id: string; onOpen: (p: Product) => void }) {
    const q = useQuery({ queryKey: ['boutique', 'product', id], queryFn: () => getProduct(id), staleTime: 300_000, retry: false });
    if (q.isLoading) return <span className="text-ink-3">…</span>;
    if (!q.data) return <span className="text-ink-3">Produit retiré</span>;
    return <button type="button" className="font-semibold text-left hover:underline truncate max-w-full" onClick={e => { e.stopPropagation(); onOpen(q.data!); }}>{q.data.name}</button>;
}

function FlashTab() {
    const [status, setStatus] = useState<FlashStatus | ''>('');
    const [page, setPage] = useState(1);
    const [open, setOpen] = useState<Product | null>(null);
    const q = useQuery({ queryKey: ['boutique', 'flash', status, page], queryFn: () => listFlashSales({ page, limit: PAGE, status }), placeholderData: keepPreviousData });
    const cols: Column<FlashSale>[] = [
        { key: 'p', header: 'Produit', cell: s => <ProductName id={s.productId} onOpen={setOpen} /> },
        { key: 'x', header: 'Prix', align: 'right', cell: s => <span className="tabular"><b>{formatMoney(s.discountedPrice)}</b> <span className="text-ink-3 line-through">{formatMoney(s.originalPrice)}</span></span> },
        { key: 'd', header: 'Période', cell: s => <span className="text-ink-2 whitespace-nowrap">{formatDateTime(s.startTime)} → {formatDateTime(s.endTime)}</span> },
        { key: 'v', header: 'Vues', align: 'right', cell: s => formatNumber(s.viewCount ?? 0) },
        { key: 'w', header: 'Clics WhatsApp', align: 'right', cell: s => formatNumber(s.whatsappClickCount ?? 0) },
        { key: 's', header: 'Statut', cell: s => <StatusBadge status={s.status} labels={FLASH_STATUS} /> },
    ];
    return (
        <div className="space-y-3">
            <div className="sm:w-64"><Select aria-label="Statut" value={status} onChange={e => { setStatus(e.target.value as FlashStatus | ''); setPage(1); }}>
                <option value="">Toutes</option>{Object.entries(FLASH_STATUS).map(([v, [l]]) => <option key={v} value={v}>{l}</option>)}
            </Select></div>
            <DataList rows={q.data?.sales} columns={cols} rowKey={s => s._id} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()}
                empty={<EmptyState title="Aucune vente flash">Programme-en une depuis la fiche d’un produit.</EmptyState>}
                card={s => (
                    <span className="block min-w-0 space-y-1">
                        <span className="flex items-center justify-between gap-2"><ProductName id={s.productId} onOpen={setOpen} /><StatusBadge status={s.status} labels={FLASH_STATUS} /></span>
                        <span className="block text-xs text-ink-2">{formatMoney(s.discountedPrice)} au lieu de {formatMoney(s.originalPrice)} · jusqu’au {formatDateTime(s.endTime)}</span>
                    </span>
                )} />
            {q.data && q.data.totalCount > PAGE && <Pagination page={page} totalPages={q.data.totalPages} total={q.data.totalCount} onChange={setPage} />}
            {open && <ProductSheet p={open} onClose={() => setOpen(null)} />}
        </div>
    );
}

/** The Boutique: members' products and flash sales. */
export default function BoutiqueModule() {
    const [tab, setTab] = useParamState('onglet', 'produits');
    return (
        <Page title="Boutique" back="/modules" width="wide">
            <div className="space-y-4">
                <Tabs value={tab} onChange={setTab} items={[{ value: 'produits', label: 'Produits' }, { value: 'flash', label: 'Ventes flash' }]} />
                {tab === 'flash' ? <FlashTab /> : <ProductsTab />}
            </div>
        </Page>
    );
}
