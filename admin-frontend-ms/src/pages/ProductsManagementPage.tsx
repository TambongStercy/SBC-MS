import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { Delete02Icon, Edit02Icon, FlashIcon, PlusSignIcon, ShoppingBag01Icon } from '@hugeicons/core-free-icons';
import ProductList, { PRODUCT_STATUS, ProductThumb } from '../components/products/ProductList';
import ProductEditForm from '../components/products/ProductEditForm';
import FlashSaleModal from '../components/products/FlashSaleModal';
import { Can } from '../components/Can';
import { usePageFilters } from '../hooks/usePageFilters';
import { PageFilters } from '../components/filters/PageFilters';
import { countryOnly, fetchProducts, type AdminFilterParams, type ProductQuery } from '../components/products/api';
import { Button, Dialog, EmptyState, Metric, PageHeader, Pagination, Panel, PanelHeader, SheetContent, Skeleton } from '../components/ui';
import {
    ConfirmDialog, CopyId, DateText, DetailList, ErrorState, FilterBar, FilterSelect, Money, Notice, SearchInput, SheetSection, StatusBadge,
    TodoAction, TodoPanel, formatNumber, plural, useUrlFilters, type ConfirmOptions,
} from '../components/moduleKit';
import {
    createProduct,
    updateProduct,
    deleteProduct,
    createFlashSale,
    deleteFlashSaleById,
    getProductFlashSales,
} from '../services/adminProductApi';

// Define interfaces for Product and FlashSale (move to types file later?)
export interface FlashSale {
    _id: string; // Add ID for specific flash sales
    productId: string; // Keep reference to product
    discountPercentage?: number; // Made optional as backend might use discountedPrice
    discountedPrice?: number; // Added based on backend likely structure
    startTime: Date | string; // <-- Corrected from startDate
    endTime: Date | string;   // <-- Corrected from endDate
    isActive?: boolean; // Status of this specific sale (consider backend enum)
    status?: string; // Added based on backend enum (e.g., 'scheduled', 'active')
    createdAt?: Date | string; // Optional timestamp
    // Add other fields from backend if needed for display/logic
    sellerUserId?: string;
    originalPrice?: number;
    feePaymentStatus?: string;
    viewCount?: number;
    whatsappClickCount?: number;
}

export interface Product {
    _id: string;
    name: string;
    description: string;
    price: number;
    category: string;
    subcategory?: string;
    imagesUrl?: string[];
    stock?: number;
    isActive?: boolean; // Ensure isActive is an optional boolean property
    // flashSales?: FlashSale[]; // Array of flash sales (Potentially replaced by hasActiveFlashSale)
    hasActiveFlashSale?: boolean; // <-- Added: Indicates if product has an active flash sale
    createdAt?: string;
    updatedAt?: string;
    // Add other fields returned by the backend if needed, e.g., status
    status?: string; // Example: Assuming backend returns status
    userId?: string; // Example: Assuming backend returns userId
}

// Define the payload type for the backend API call
interface BackendFlashSaleCreatePayload {
    productId: string;
    discountedPrice: number;
    startTime: string | Date;
    endTime: string | Date;
}


const LIMIT = 10;
const KEY = ['admin-products'] as const;
const FILTER_KEYS = ['q', 'status', 'flash'] as const;
const msg = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);
const countOf = (q: ProductQuery, f: AdminFilterParams) => fetchProducts({ ...q, page: 1, limit: 1 }, f).then(r => r.pagination.totalCount);

/**
 * Boutique: the products members publish, their flash sales, edit and removal.
 * Filters live in the URL. The product status is shown and filterable, but it
 * changes nothing in the member app (products are listed whatever their status).
 */
function ProductsManagementPage() {
    const queryClient = useQueryClient();
    const { values, set, clear, activeCount, page, setPage } = useUrlFilters(FILTER_KEYS);

    const [editing, setEditing] = useState<Product | null | 'new'>(null);
    const [saving, setSaving] = useState(false);
    const [viewing, setViewing] = useState<Product | null>(null);
    const [flashProduct, setFlashProduct] = useState<Product | null>(null);
    const [flashSales, setFlashSales] = useState<FlashSale[]>([]);
    const [flashLoading, setFlashLoading] = useState(false);
    const [confirm, setConfirm] = useState<ConfirmOptions | null>(null);

    const pageFilters = usePageFilters();
    const clearAll = () => clear(['pays', 'periode', 'du', 'au']);
    const filters = {
        page,
        limit: LIMIT,
        searchTerm: values.q || undefined,
        status: values.status || undefined,
        hasActiveFlashSale: values.flash === '' ? undefined : values.flash === 'yes',
    };
    const list = useQuery({ queryKey: [...KEY, 'list', filters, pageFilters.apiParams], queryFn: () => fetchProducts(filters, pageFilters.apiParams), placeholderData: prev => prev });
    const queueParams = countryOnly(pageFilters.apiParams);
    const counts = useQuery({
        queryKey: [...KEY, 'counts', pageFilters.apiParams],
        queryFn: async () => {
            // Catalogue figures follow country + period; the pending queue only the country.
            const [all, pending, flash] = await Promise.all([
                countOf({}, pageFilters.apiParams),
                countOf({ status: 'pending' }, queueParams),
                countOf({ hasActiveFlashSale: true }, pageFilters.apiParams),
            ]);
            return { all, pending, flash };
        },
    });

    const products = list.data?.data ?? [];
    const total = list.data?.pagination.totalCount ?? 0;
    const totalPages = list.data?.pagination.totalPages ?? 1;
    const refresh = () => { void queryClient.invalidateQueries({ queryKey: KEY }); };

    const handleSaveProduct = async (productData: Partial<Product>) => {
        setSaving(true);
        try {
            if (productData._id) {
                await updateProduct(productData._id, productData);
                toast.success('Produit enregistré.');
            } else {
                await createProduct(productData as Required<Omit<Product, '_id' | 'createdAt' | 'updatedAt' | 'flashSales' | 'isActive'>>);
                toast.success('Produit ajouté.');
            }
            setEditing(null);
            setViewing(null);
            refresh();
        } catch (err) {
            // The form stays open so the admin can correct and retry.
            toast.error(msg(err, 'Impossible d’enregistrer le produit.'));
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteProduct = (productId: string, productName?: string) => setConfirm({
        title: 'Supprimer le produit ?',
        description: `Supprimer « ${productName || 'ce produit'} » ? Cette action est définitive.`,
        confirmLabel: 'Supprimer le produit',
        onConfirm: async () => {
            try {
                await deleteProduct(productId);
            } catch (err) {
                throw new Error(msg(err, 'Impossible de supprimer le produit.'));
            }
            toast.success('Produit supprimé.');
            setViewing(null);
            refresh();
        },
    });

    const handleManageFlashSale = async (product: Product) => {
        setFlashProduct(product);
        setFlashSales([]);
        setFlashLoading(true);
        try {
            setFlashSales((await getProductFlashSales(product._id)) || []);
        } catch (err) {
            toast.error(msg(err, 'Impossible de charger les ventes flash de ce produit.'));
        } finally {
            setFlashLoading(false);
        }
    };

    const handleSaveFlashSale = async (data: { discountedPrice: number; startTime: Date; endTime: Date }) => {
        if (!flashProduct) return;
        setFlashLoading(true);
        try {
            const payload: BackendFlashSaleCreatePayload = { productId: flashProduct._id, ...data };
            await createFlashSale(payload);
            toast.success('Vente flash enregistrée.');
            setFlashProduct(null);
            refresh();
        } catch (err) {
            toast.error(msg(err, 'Impossible d’enregistrer la vente flash.'));
        } finally {
            setFlashLoading(false);
        }
    };

    const handleDeleteFlashSale = (flashSaleId: string) => {
        if (!flashSaleId) {
            toast.error('Suppression impossible : identifiant de la vente flash manquant.');
            return;
        }
        setConfirm({
            title: 'Retirer la vente flash ?',
            description: 'La vente flash en cours ou programmée sera annulée ou désactivée.',
            confirmLabel: 'Retirer la vente',
            onConfirm: async () => {
                let response;
                try {
                    response = await deleteFlashSaleById(flashSaleId);
                } catch (err) {
                    throw new Error(msg(err, 'Impossible de retirer la vente flash.'));
                }
                toast.success(response?.message || 'Vente flash retirée.');
                setFlashProduct(null);
                refresh();
            },
        });
    };

    const pending = counts.data?.pending ?? 0;
    const showingPending = values.status === 'pending';

    return (
        <div className="space-y-6">
            <PageHeader
                title="Boutique"
                description="Les produits publiés par les membres, leurs ventes flash, la modification et le retrait."
                actions={(
                    <Can module="boutique" write>
                        <Button variant="primary" size="lg" className="w-full sm:w-auto" onClick={() => setEditing('new')}>
                            <HugeiconsIcon icon={PlusSignIcon} size={18} aria-hidden="true" />
                            Ajouter un produit
                        </Button>
                    </Can>
                )}
            />

            <PageFilters filters={pageFilters} onReset={clearAll}>
                    <FilterBar
                        className="sm:contents"
                        filterCount={2}
                        activeCount={pageFilters.isFiltered ? 0 : activeCount}
                        onClear={clearAll}
                        search={<SearchInput value={values.q} onChange={v => set({ q: v })} placeholder="Rechercher par nom, catégorie…" />}
                        filters={(
                            <>
                                <FilterSelect
                                    label="Statut"
                                    allLabel="Tous les statuts"
                                    value={values.status}
                                    onChange={v => set({ status: v })}
                                    options={[
                                        { value: 'pending', label: 'En attente' },
                                        { value: 'approved', label: 'Approuvé' },
                                        { value: 'rejected', label: 'Rejeté' },
                                    ]}
                                />
                                <FilterSelect
                                    label="Vente flash active"
                                    allLabel="Vente flash : tous"
                                    value={values.flash}
                                    onChange={v => set({ flash: v })}
                                    options={[{ value: 'yes', label: 'Avec vente flash' }, { value: 'no', label: 'Sans vente flash' }]}
                                />
                            </>
                        )}
                    />
            </PageFilters>

            {!counts.isError && (
                <TodoPanel
                    loading={counts.isLoading}
                    items={[{
                        key: 'pending',
                        count: pending,
                        label: `${plural(pending, 'Produit')} en attente de vérification`,
                        hint: 'Le statut n’a aucun effet dans l’app : les produits en attente sont déjà visibles des membres.',
                        action: showingPending ? undefined : <TodoAction onClick={() => set({ status: 'pending' })}>Voir</TodoAction>,
                    }]}
                />
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Metric label="Produits" icon={ShoppingBag01Icon} value={counts.isLoading ? <Skeleton className="h-7 w-24" /> : formatNumber(counts.data?.all ?? 0)} hint="Tous statuts confondus" />
                <Metric
                    label="En attente"
                    tone={pending > 0 ? 'warning' : 'neutral'}
                    value={counts.isLoading ? <Skeleton className="h-7 w-24" /> : formatNumber(pending)}
                    hint={pageFilters.period !== 'all' ? 'Toutes périodes confondues' : counts.data?.all ? `${Math.round((pending / counts.data.all) * 100)} % du catalogue` : undefined}
                    onClick={() => set({ status: 'pending' })}
                />
                <Metric
                    label="Vente flash active"
                    icon={FlashIcon}
                    value={counts.isLoading ? <Skeleton className="h-7 w-24" /> : formatNumber(counts.data?.flash ?? 0)}
                    onClick={() => set({ flash: 'yes' })}
                />
            </div>

            <Panel>
                <PanelHeader title="Produits" description={list.data ? `${formatNumber(total)} ${plural(total, 'produit')}` : undefined} />
                {values.status && (
                    <div className="px-4 pb-3 sm:px-5">
                        <Notice tone="info">
                            Le statut d’un produit ne change rien dans l’app : les membres voient tous les produits, quel que soit leur statut.
                        </Notice>
                    </div>
                )}
                <div className={list.isFetching && !list.isLoading ? 'opacity-60 transition-opacity' : undefined}>
                    <ProductList
                        products={products}
                        isLoading={list.isLoading}
                        onOpen={setViewing}
                        onEdit={p => setEditing(p)}
                        onDelete={handleDeleteProduct}
                        onManageFlashSale={p => void handleManageFlashSale(p)}
                        empty={list.isError ? (
                            <ErrorState error={list.error} onRetry={() => void list.refetch()} retrying={list.isFetching} />
                        ) : (
                            <EmptyState
                                icon={ShoppingBag01Icon}
                                title="Aucun produit trouvé"
                                description={activeCount || pageFilters.isFiltered ? 'Aucun produit ne correspond à ces filtres.' : 'Les produits publiés par les membres apparaîtront ici.'}
                                action={activeCount || pageFilters.isFiltered ? <Button size="lg" onClick={clearAll}>Effacer les filtres</Button> : undefined}
                            />
                        )}
                    />
                </div>
                <Pagination page={page} totalPages={totalPages} total={total} pageSize={LIMIT} onPageChange={setPage} />
            </Panel>

            <Dialog open={!!viewing} onOpenChange={o => { if (!o) setViewing(null); }}>
                {viewing && (
                    <SheetContent
                        title={viewing.name}
                        description={`${viewing.category}${viewing.subcategory ? ` › ${viewing.subcategory}` : ''}`}
                        width="lg"
                        footer={(
                            <Can module="boutique" write>
                                <Button variant="danger-ghost" size="lg" onClick={() => handleDeleteProduct(viewing._id, viewing.name)}>
                                    <HugeiconsIcon icon={Delete02Icon} size={16} aria-hidden="true" />Supprimer
                                </Button>
                                <Button variant="outline" size="lg" onClick={() => void handleManageFlashSale(viewing)}>
                                    <HugeiconsIcon icon={FlashIcon} size={16} aria-hidden="true" />Vente flash
                                </Button>
                                <Button variant="primary" size="lg" onClick={() => setEditing(viewing)}>
                                    <HugeiconsIcon icon={Edit02Icon} size={16} aria-hidden="true" />Modifier
                                </Button>
                            </Can>
                        )}
                    >
                        <div className="space-y-6">
                            {(viewing.imagesUrl?.length ?? 0) > 0 && (
                                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                                    {viewing.imagesUrl!.map((u, i) => <ProductThumb key={i} src={u} alt={`${viewing.name} ${i + 1}`} className="aspect-square h-auto w-full border border-line" />)}
                                </div>
                            )}
                            <DetailList items={[
                                ['Prix', <Money value={viewing.price} />],
                                ['Statut', <StatusBadge status={viewing.status} map={PRODUCT_STATUS} />],
                                ['Vente flash active', viewing.hasActiveFlashSale ? 'Oui' : 'Non'],
                                viewing.stock !== undefined && ['Stock', formatNumber(viewing.stock)],
                                viewing.isActive !== undefined && ['Actif', viewing.isActive ? 'Oui' : 'Non'],
                                ['Publié', <DateText value={viewing.createdAt} />],
                                ['Modifié', <DateText value={viewing.updatedAt} />],
                                viewing.userId ? ['Vendeur', <CopyId value={viewing.userId} />] : null,
                                ['Produit', <CopyId value={viewing._id} />],
                            ]} />
                            {viewing.description && (
                                <SheetSection title="Description">
                                    <p className="whitespace-pre-line text-sm text-fg-muted">{viewing.description}</p>
                                </SheetSection>
                            )}
                            <Notice tone="info">Le statut ne change rien dans l’app : le produit est visible des membres quel que soit son statut.</Notice>
                        </div>
                    </SheetContent>
                )}
            </Dialog>

            {editing && (
                <ProductEditForm
                    product={editing === 'new' ? null : editing}
                    onSave={handleSaveProduct}
                    onCancel={() => setEditing(null)}
                    isLoading={saving}
                />
            )}

            <FlashSaleModal
                isOpen={!!flashProduct}
                product={flashProduct}
                existingSales={flashSales}
                isLoading={flashLoading}
                onSave={handleSaveFlashSale}
                onDelete={handleDeleteFlashSale}
                onClose={() => setFlashProduct(null)}
            />

            <ConfirmDialog options={confirm} onClose={() => setConfirm(null)} />
        </div>
    );
}

export default ProductsManagementPage;
