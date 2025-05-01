import React, { useState, useEffect } from 'react';
import { Product } from '../../pages/ProductsManagementPage'; // Import interfaces

interface ProductEditFormProps {
    product: Partial<Product> | null; // Use Partial for create mode, null if no initial data
    isLoading: boolean;
    onSave: (productData: Partial<Product>) => void; // Pass back partial data
    onCancel: () => void;
}

const ProductEditForm: React.FC<ProductEditFormProps> = ({
    product,
    isLoading,
    onSave,
    onCancel,
}) => {
    // Form state initialization
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [price, setPrice] = useState<number | string>('');
    const [category, setCategory] = useState('');
    const [subcategory, setSubcategory] = useState('');
    const [stock, setStock] = useState<number | string>('');
    const [isActive, setIsActive] = useState(true);
    // State for image handling
    const [imageFiles, setImageFiles] = useState<FileList | null>(null);
    const [imagePreviews, setImagePreviews] = useState<string[]>([]); // For newly selected files
    const [existingImageUrls, setExistingImageUrls] = useState<string[]>([]); // For existing product

    // Populate form when product prop changes (for editing)
    useEffect(() => {
        if (product) {
            setName(product.name || '');
            setDescription(product.description || '');
            setPrice(product.price ?? '');
            setCategory(product.category || '');
            setSubcategory(product.subcategory || '');
            setStock(product.stock ?? '');
            setIsActive(product.isActive === undefined ? true : product.isActive);
            // Populate existing images and clear new selections
            setExistingImageUrls(product.imagesUrl || []);
            setImageFiles(null);
            setImagePreviews([]);
        } else {
            // Reset form for create mode
            setName('');
            setDescription('');
            setPrice('');
            setCategory('');
            setSubcategory('');
            setStock('');
            setIsActive(true);
            // Clear all image states
            setExistingImageUrls([]);
            setImageFiles(null);
            setImagePreviews([]);
        }
    }, [product]);

    // Handle file input changes
    const handleImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (files) {
            setImageFiles(files);
            // Generate previews for selected files
            const newPreviews: string[] = [];
            Array.from(files).forEach(file => {
                const reader = new FileReader();
                reader.onloadend = () => {
                    newPreviews.push(reader.result as string);
                    // Update state once all previews are read (or iteratively)
                    // This simple approach might cause multiple re-renders, optimize if needed
                    if (newPreviews.length === files.length) {
                        setImagePreviews(newPreviews);
                    }
                };
                reader.readAsDataURL(file);
            });
            // If no files selected, clear previews
            if (files.length === 0) {
                setImagePreviews([]);
            }
        }
    };

    const handleSubmit = (event: React.FormEvent) => {
        event.preventDefault();

        // Basic validation (can be expanded)
        if (!name || !category || price === '' || isNaN(Number(price))) {
            alert('Please fill in Name, Category, and a valid Price.');
            return;
        }

        const productData: Partial<Product> = {
            name,
            description,
            price: Number(price),
            category,
            subcategory: subcategory || undefined, // Send undefined if empty
            stock: stock === '' || isNaN(Number(stock)) ? undefined : Number(stock),
            isActive,
            imagesUrl: existingImageUrls, // Pass existing URLs for now
        };

        // If editing, include the _id
        if (product?._id) {
            productData._id = product._id;
        }

        // !!! IMPORTANT: Actual file upload logic would go here !!!
        // This would involve sending `imageFiles` to the backend, possibly as FormData.
        // Example placeholder:
        // if (imageFiles) { 
        //    uploadFiles(imageFiles).then(uploadedUrls => { 
        //        productData.imagesUrl = [...existingImageUrls, ...uploadedUrls]; 
        //        onSave(productData); 
        //    }); 
        // } else { 
        //    onSave(productData); 
        // } 

        onSave(productData); // Call onSave without file handling for now
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-20 p-4">
            <div className="bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
                <h2 className="text-xl font-semibold text-white mb-6">{product?._id ? 'Edit Product' : 'Create New Product'}</h2>
                <form onSubmit={handleSubmit}>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        {/* Name */}
                        <div>
                            <label htmlFor="name" className="block text-sm font-medium text-gray-300 mb-1">Name *</label>
                            <input
                                type="text"
                                id="name"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                                disabled={isLoading}
                                required
                            />
                        </div>
                        {/* Price */}
                        <div>
                            <label htmlFor="price" className="block text-sm font-medium text-gray-300 mb-1">Price (XAF) *</label>
                            <input
                                type="number"
                                id="price"
                                value={price}
                                onChange={(e) => setPrice(e.target.value)}
                                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                                disabled={isLoading}
                                required
                                min="0"
                            />
                        </div>
                        {/* Category */}
                        <div>
                            <label htmlFor="category" className="block text-sm font-medium text-gray-300 mb-1">Category *</label>
                            <input
                                type="text" // Consider changing to select if categories are fixed
                                id="category"
                                value={category}
                                onChange={(e) => setCategory(e.target.value)}
                                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                                disabled={isLoading}
                                required
                            />
                        </div>
                        {/* Subcategory */}
                        <div>
                            <label htmlFor="subcategory" className="block text-sm font-medium text-gray-300 mb-1">Subcategory</label>
                            <input
                                type="text"
                                id="subcategory"
                                value={subcategory}
                                onChange={(e) => setSubcategory(e.target.value)}
                                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                                disabled={isLoading}
                            />
                        </div>
                        {/* Stock */}
                        <div>
                            <label htmlFor="stock" className="block text-sm font-medium text-gray-300 mb-1">Stock Quantity</label>
                            <input
                                type="number"
                                id="stock"
                                value={stock}
                                onChange={(e) => setStock(e.target.value)}
                                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                                disabled={isLoading}
                                min="0"
                            />
                        </div>
                        {/* Active Status */}
                        <div className="flex items-center mt-4 md:mt-7">
                            <input
                                id="isActive"
                                name="isActive"
                                type="checkbox"
                                checked={isActive}
                                onChange={(e) => setIsActive(e.target.checked)}
                                className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-500 rounded bg-gray-700"
                                disabled={isLoading}
                            />
                            <label htmlFor="isActive" className="ml-2 block text-sm text-gray-300">
                                Product Active
                            </label>
                        </div>
                    </div>

                    {/* Description */}
                    <div className="mb-4">
                        <label htmlFor="description" className="block text-sm font-medium text-gray-300 mb-1">Description</label>
                        <textarea
                            id="description"
                            rows={4}
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                            disabled={isLoading}
                        />
                    </div>

                    {/* Image Upload/Management Section */}
                    <div className="mb-4">
                        <label htmlFor="images" className="block text-sm font-medium text-gray-300 mb-1">Product Images</label>
                        <input
                            type="file"
                            id="images"
                            multiple
                            accept="image/*" // Accept only image files
                            onChange={handleImageChange}
                            className="block w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 disabled:opacity-50"
                            disabled={isLoading}
                        />
                        <p className="mt-1 text-xs text-gray-400">Select one or more images.</p>
                    </div>

                    {/* Image Previews */}
                    <div className="mb-4 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
                        {/* Existing Images (only show when editing) */}
                        {product?._id && existingImageUrls.map((url, index) => (
                            <div key={`existing-${index}`} className="relative group">
                                <img src={url} alt={`Existing product image ${index + 1}`} className="w-full h-20 object-cover rounded-md border border-gray-600" />
                                {/* TODO: Add a button to remove existing image */}
                                {/* <button type="button" className="absolute top-0 right-0 bg-red-600 text-white rounded-full p-1 text-xs opacity-0 group-hover:opacity-100">&times;</button> */}
                            </div>
                        ))}
                        {/* New Image Previews */}
                        {imagePreviews.map((previewUrl, index) => (
                            <div key={`new-${index}`} className="relative group">
                                <img src={previewUrl} alt={`New preview ${index + 1}`} className="w-full h-20 object-cover rounded-md border border-indigo-500" />
                            </div>
                        ))}
                    </div>

                    {/* Action Buttons */}
                    <div className="mt-6 flex justify-end space-x-3">
                        <button
                            type="button"
                            onClick={onCancel}
                            disabled={isLoading}
                            className="px-4 py-2 bg-gray-600 text-white text-sm font-medium rounded-md shadow-sm hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 disabled:opacity-50"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isLoading}
                            className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-md shadow-sm hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50"
                        >
                            {isLoading ? 'Saving...' : 'Save Product'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default ProductEditForm; 