import React, { useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Delete02Icon, Edit02Icon, FlashIcon, Image01Icon } from '@hugeicons/core-free-icons';
import type { Product } from '../../pages/ProductsManagementPage';
import { getFileUrl } from '../../utils/fileUtils';
import { cn } from '../../lib/cn';
import { Badge, Button, MenuItem, ResponsiveList, type ListColumn } from '../ui';
import { Can } from '../Can';
import { Money, RowMenu, StatusBadge, type StatusMap } from '../moduleKit';

/** Product status in words. Note: it changes nothing in the member app (products are listed whatever their status). */
export const PRODUCT_STATUS: StatusMap = {
    pending: ['En attente', 'warning'],
    approved: ['Approuvé', 'success'],
    rejected: ['Rejeté', 'danger'],
    deleted: ['Supprimé', 'neutral'],
};

/** A product photo (file id or URL), or a neutral placeholder when there is none or it fails. */
export function ProductThumb({ src, alt, className }: { src?: string; alt: string; className?: string }) {
    const [failed, setFailed] = useState(false);
    if (!src || failed) {
        return (
            <span className={cn('flex shrink-0 items-center justify-center rounded-md bg-surface-3 text-fg-subtle', className)} aria-label="Pas d’image">
                <HugeiconsIcon icon={Image01Icon} size={16} aria-hidden="true" />
            </span>
        );
    }
    return <img src={getFileUrl(src)} alt={alt} loading="lazy" onError={() => setFailed(true)} className={cn('shrink-0 rounded-md object-cover', className)} />;
}

interface ProductListProps {
    products: Product[];
    isLoading: boolean;
    empty?: React.ReactNode;
    onOpen: (product: Product) => void;
    onEdit: (product: Product) => void;
    onDelete: (productId: string, productName?: string) => void;
    onManageFlashSale: (product: Product) => void;
}

const FlashBadge = ({ on }: { on?: boolean }) =>
    on ? <Badge tone="warning"><HugeiconsIcon icon={FlashIcon} size={12} aria-hidden="true" />Vente flash</Badge> : <span className="text-fg-subtle">—</span>;

/** Products: table on desktop, cards on phones. Row → details; Modifier visible; vente flash and Supprimer in ⋯. */
const ProductList: React.FC<ProductListProps> = ({ products, isLoading, empty, onOpen, onEdit, onDelete, onManageFlashSale }) => {
    const actions = (p: Product) => (
        <Can module="boutique" write>
            <div className="flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
                <Button variant="ghost" size="sm" className="h-11 sm:h-8" onClick={() => onEdit(p)}>
                    <HugeiconsIcon icon={Edit02Icon} size={16} aria-hidden="true" />Modifier
                </Button>
                <RowMenu>
                    <MenuItem onSelect={() => onManageFlashSale(p)}><HugeiconsIcon icon={FlashIcon} size={16} aria-hidden="true" />Gérer la vente flash</MenuItem>
                    <MenuItem destructive onSelect={() => onDelete(p._id, p.name)}><HugeiconsIcon icon={Delete02Icon} size={16} aria-hidden="true" />Supprimer le produit</MenuItem>
                </RowMenu>
            </div>
        </Can>
    );

    const identity = (p: Product) => (
        <div className="flex min-w-0 items-center gap-3">
            <ProductThumb src={p.imagesUrl?.[0]} alt={p.name} className="h-10 w-10" />
            <div className="min-w-0">
                <p className="truncate font-medium text-fg">{p.name}</p>
                <p className="truncate text-xs text-fg-muted">{p.category}{p.subcategory ? ` › ${p.subcategory}` : ''}</p>
            </div>
        </div>
    );

    const columns: ListColumn<Product>[] = [
        { key: 'product', header: 'Produit', cell: identity, className: 'max-w-[28rem]' },
        { key: 'price', header: 'Prix', numeric: true, cell: p => <Money value={p.price} /> },
        { key: 'status', header: 'Statut', cell: p => <StatusBadge status={p.status} map={PRODUCT_STATUS} /> },
        { key: 'flash', header: 'Vente flash', cell: p => <FlashBadge on={p.hasActiveFlashSale} /> },
        { key: 'actions', header: <span className="sr-only">Actions</span>, className: 'text-right', hideOnCard: true, cell: actions },
    ];

    const card = (p: Product) => (
        <div className="space-y-2">
            <div className="flex items-start justify-between gap-3">
                {identity(p)}
                <Money value={p.price} className="text-sm font-medium text-fg" />
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={p.status} map={PRODUCT_STATUS} />
                {p.hasActiveFlashSale && <FlashBadge on />}
            </div>
            {actions(p)}
        </div>
    );

    return (
        <ResponsiveList
            rows={products}
            columns={columns}
            card={card}
            rowKey={p => p._id}
            onRowClick={onOpen}
            loading={isLoading}
            empty={empty}
            className="border-t border-line"
        />
    );
};

export default ProductList;
