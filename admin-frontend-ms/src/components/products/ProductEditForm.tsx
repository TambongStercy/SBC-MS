import React, { useEffect, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Upload01Icon } from '@hugeicons/core-free-icons';
import type { Product } from '../../pages/ProductsManagementPage';
import { Button, Checkbox, Dialog, Field, Input, SheetContent, Textarea } from '../ui';
import { ProductThumb } from './ProductList';

interface ProductEditFormProps {
    product: Partial<Product> | null; // Use Partial for create mode, null if no initial data
    isLoading: boolean;
    onSave: (productData: Partial<Product>) => void; // Pass back partial data
    onCancel: () => void;
}

type Errors = Partial<Record<'name' | 'category' | 'price', string>>;

/** Create or edit a product, in a side sheet (full screen on phones) with the buttons always visible. */
const ProductEditForm: React.FC<ProductEditFormProps> = ({ product, isLoading, onSave, onCancel }) => {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [price, setPrice] = useState<number | string>('');
    const [category, setCategory] = useState('');
    const [subcategory, setSubcategory] = useState('');
    const [stock, setStock] = useState<number | string>('');
    const [isActive, setIsActive] = useState(true);
    const [imagePreviews, setImagePreviews] = useState<string[]>([]); // newly selected files (preview only)
    const [existingImageUrls, setExistingImageUrls] = useState<string[]>([]);
    const [errors, setErrors] = useState<Errors>({});

    useEffect(() => {
        setName(product?.name || '');
        setDescription(product?.description || '');
        setPrice(product?.price ?? '');
        setCategory(product?.category || '');
        setSubcategory(product?.subcategory || '');
        setStock(product?.stock ?? '');
        setIsActive(product?.isActive === undefined ? true : !!product.isActive);
        setExistingImageUrls(product?.imagesUrl || []);
        setImagePreviews([]);
        setErrors({});
    }, [product]);

    const handleImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (!files || files.length === 0) { setImagePreviews([]); return; }
        const list = Array.from(files);
        Promise.all(list.map(file => new Promise<string>(resolve => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(file);
        }))).then(setImagePreviews);
    };

    const handleSubmit = (event?: React.FormEvent) => {
        event?.preventDefault();
        const next: Errors = {};
        if (!name.trim()) next.name = 'Indique le nom du produit.';
        if (!category.trim()) next.category = 'Indique la catégorie.';
        if (price === '' || isNaN(Number(price)) || Number(price) < 0) next.price = 'Indique un prix valide (0 ou plus).';
        setErrors(next);
        if (Object.keys(next).length) return;

        const productData: Partial<Product> = {
            name,
            description,
            price: Number(price),
            category,
            subcategory: subcategory || undefined,
            stock: stock === '' || isNaN(Number(stock)) ? undefined : Number(stock),
            isActive,
            imagesUrl: existingImageUrls,
        };
        if (product?._id) productData._id = product._id;
        // Uploading newly chosen images is not wired to an API yet: only the current images are saved.
        onSave(productData);
    };

    const editing = !!product?._id;

    return (
        <Dialog open onOpenChange={open => { if (!open && !isLoading) onCancel(); }}>
            <SheetContent
                title={editing ? 'Modifier le produit' : 'Nouveau produit'}
                description={editing ? product?.name : 'Le produit est publié dans la boutique des membres.'}
                width="lg"
                footer={(
                    <>
                        <Button variant="outline" size="lg" onClick={onCancel} disabled={isLoading}>Annuler</Button>
                        <Button variant="primary" size="lg" onClick={() => handleSubmit()} loading={isLoading}>Enregistrer le produit</Button>
                    </>
                )}
            >
                <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <Field label="Nom" required error={errors.name}>
                            <Input className="h-11 sm:h-9" value={name} onChange={e => setName(e.target.value)} disabled={isLoading} />
                        </Field>
                        <Field label="Prix (F CFA)" required error={errors.price}>
                            <Input className="h-11 sm:h-9" type="number" inputMode="numeric" min="0" value={price} onChange={e => setPrice(e.target.value)} disabled={isLoading} />
                        </Field>
                        <Field label="Catégorie" required error={errors.category}>
                            <Input className="h-11 sm:h-9" value={category} onChange={e => setCategory(e.target.value)} disabled={isLoading} />
                        </Field>
                        <Field label="Sous-catégorie">
                            <Input className="h-11 sm:h-9" value={subcategory} onChange={e => setSubcategory(e.target.value)} disabled={isLoading} />
                        </Field>
                        <Field label="Quantité en stock">
                            <Input className="h-11 sm:h-9" type="number" inputMode="numeric" min="0" value={stock} onChange={e => setStock(e.target.value)} disabled={isLoading} />
                        </Field>
                        <label className="flex min-h-11 items-center gap-2 self-end text-sm text-fg">
                            <Checkbox checked={isActive} onCheckedChange={v => setIsActive(v === true)} disabled={isLoading} />
                            Produit actif
                        </label>
                    </div>

                    <Field label="Description">
                        <Textarea rows={4} value={description} onChange={e => setDescription(e.target.value)} disabled={isLoading} />
                    </Field>

                    <div className="space-y-2">
                        <p className="text-sm font-medium text-fg">Images du produit</p>
                        {(existingImageUrls.length > 0 || imagePreviews.length > 0) && (
                            <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
                                {editing && existingImageUrls.map((url, i) => (
                                    <ProductThumb key={`e-${i}`} src={url} alt={`Image actuelle ${i + 1}`} className="aspect-square h-auto w-full border border-line" />
                                ))}
                                {imagePreviews.map((src, i) => (
                                    <img key={`n-${i}`} src={src} alt={`Nouvelle image ${i + 1}`} className="aspect-square w-full rounded-md border border-primary object-cover" />
                                ))}
                            </div>
                        )}
                        <label className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-control border border-line-strong bg-surface px-4 text-sm font-medium text-fg hover:bg-surface-2 sm:h-9">
                            <HugeiconsIcon icon={Upload01Icon} size={16} aria-hidden="true" />
                            Choisir des images
                            <input type="file" multiple accept="image/*" className="sr-only" onChange={handleImageChange} disabled={isLoading} />
                        </label>
                        <p className="text-xs text-fg-muted">L’envoi de nouvelles images n’est pas encore branché : seules les images actuelles sont enregistrées.</p>
                    </div>
                </form>
            </SheetContent>
        </Dialog>
    );
};

export default ProductEditForm;
