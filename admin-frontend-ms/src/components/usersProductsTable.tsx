import React, { useState } from 'react';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { Delete02Icon, ShoppingBag01Icon } from '@hugeicons/core-free-icons';
import { deleteProduct } from '../api';
import { Can } from './Can';
import { Button, EmptyState, Panel, PanelHeader, ResponsiveList, type ListColumn } from './ui';
import { ConfirmDialog, Money, errorText, type ConfirmOptions } from './moduleKit';
import { ProductThumb } from './products/ProductList';

interface UserProductsProps {
  data: {
    id: string;
    name: string;
    town: string;
    phone: string;
    email: string;
    product: Array<ProductsProps>;
  };
}

interface ProductsProps {
  id: string;
  name: string;
  category: string;
  subcategory: string;
  description: string;
  imagesUrl: Array<string>;
  price: number;
  overallRating: number;
}

/** A member's products and services (member page), with removal behind a confirmation. */
const UserProductsTable: React.FC<UserProductsProps> = ({ data }) => {
  const [products, setProducts] = useState(data.product ?? []);
  const [confirm, setConfirm] = useState<ConfirmOptions | null>(null);

  const askDelete = (p: ProductsProps) => setConfirm({
    title: 'Supprimer ce produit ?',
    description: `« ${p.name} » disparaît de la boutique. C’est définitif.`,
    confirmLabel: 'Supprimer',
    onConfirm: async () => {
      try {
        await deleteProduct(p.id);
      } catch (err) {
        throw new Error(errorText(err, 'Échec de la suppression du produit ou service.'));
      }
      setProducts(prev => prev.filter(x => x.id !== p.id));
      toast.success('Produit ou service supprimé.');
    },
  });

  const columns: ListColumn<ProductsProps>[] = [
    {
      key: 'name', header: 'Produit ou service', cell: p => (
        <div className="flex min-w-0 items-center gap-3">
          <ProductThumb src={p.imagesUrl?.[0]} alt={p.name} className="h-8 w-8" />
          <span className="truncate text-fg">{p.name}</span>
        </div>
      ),
    },
    { key: 'price', header: 'Prix', numeric: true, cell: p => (p.price != null ? <Money value={p.price} /> : '—') },
    { key: 'town', header: 'Ville', cell: () => data.town },
    { key: 'contact', header: 'Contact', cell: () => <span className="text-fg-muted">{[data.phone, data.email].filter(Boolean).join(' · ')}</span> },
    {
      key: 'actions', header: <span className="sr-only">Actions</span>, className: 'text-right', hideOnCard: true, cell: p => (
        <Can module="boutique" write>
          <Button variant="danger-ghost" size="sm" className="h-11 sm:h-8" onClick={() => askDelete(p)}>
            <HugeiconsIcon icon={Delete02Icon} size={16} aria-hidden="true" />Supprimer
          </Button>
        </Can>
      ),
    },
  ];

  return (
    <Panel className="mb-8 mt-2">
      <PanelHeader title="Produits et services" />
      <ResponsiveList
        rows={products}
        columns={columns}
        rowKey={p => p.id}
        className="border-t border-line"
        card={p => (
          <div className="space-y-2">
            {columns[0].cell(p)}
            <p className="text-xs text-fg-muted">{data.town} · {[data.phone, data.email].filter(Boolean).join(' · ')}</p>
            {columns[4].cell(p)}
          </div>
        )}
        empty={<EmptyState icon={ShoppingBag01Icon} title="Aucun produit ou service" description="Ce membre n’a rien publié dans la boutique." />}
      />
      <ConfirmDialog options={confirm} onClose={() => setConfirm(null)} />
    </Panel>
  );
};

export default UserProductsTable;
