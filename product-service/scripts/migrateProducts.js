const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const { URL } = require('url'); // For parsing URLs

// Load environment variables (adjust path if your .env is elsewhere)
dotenv.config({ path: path.resolve(__dirname, '../.env') }); // Assuming .env is in the workspace root

const MONGODB_URI = process.env.MONGODB_URI_PROD; // Make sure this points to your DB (e.g., the one user-service uses)

if (!MONGODB_URI) {
    console.error('Error: MONGODB_URI is not defined in your .env file.');
    process.exit(1);
}

// --- Define Schema matching Product structure (including old and new fields) ---

// Define Product Status locally for the script
const ProductStatus = {
    PENDING: 'pending',
    APPROVED: 'approved',
    REJECTED: 'rejected'
};

// Interface/Schema for the NEW image structure
const ProductImageSchema = new mongoose.Schema({
    url: { type: String, required: true },
    fileId: { type: String, required: true },
}, { _id: false });

// Define the Product Schema *for the migration*
// Include BOTH old `imagesUrl` and new `images`
// Set strict: false to handle potential schema variations during read
const ProductSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, required: true },
    name: { type: String, required: true },
    category: { type: String, required: true },
    subcategory: { type: String },
    description: { type: String },
    price: { type: Number },
    imagesUrl: { type: [String], select: true }, // OLD field - select ensures it's loaded
    images: [ProductImageSchema],              // NEW field
    status: { type: String, enum: Object.values(ProductStatus), default: ProductStatus.PENDING },
    ratings: [{ type: mongoose.Schema.Types.ObjectId }],
    overallRating: { type: Number },
    deleted: { type: Boolean, default: false },
    // Add other fields if necessary for filtering or context
}, {
    timestamps: true,
    strict: false // Be lenient when reading potentially inconsistent old data
});

const ProductModel = mongoose.model('Product', ProductSchema);

// --- Migration Logic ---

async function runMigration() {
    console.log('Connecting to MongoDB...');
    try {
        await mongoose.connect(MONGODB_URI);
        console.log('MongoDB connected successfully.');

        console.log('Finding products with imagesUrl field...');
        // Find products that have the old imagesUrl field and it's not empty
        const productsToMigrate = await ProductModel.find({
            imagesUrl: { $exists: true, $ne: [] }
        }).select('+imagesUrl').lean(); // Ensure imagesUrl is selected and use lean for plain objects

        console.log(`Found ${productsToMigrate.length} products to migrate.`);

        if (productsToMigrate.length === 0) {
            console.log('No products found needing migration.');
            return;
        }

        const bulkOps = [];
        let migratedCount = 0;
        let errorCount = 0;

        console.log('Processing products...');
        for (const product of productsToMigrate) {
            try {
                const newImages = [];
                if (Array.isArray(product.imagesUrl)) {
                    for (const imageUrl of product.imagesUrl) {
                        if (typeof imageUrl === 'string' && imageUrl.includes('id=')) {
                            try {
                                const parsedUrl = new URL(imageUrl);
                                const fileId = parsedUrl.searchParams.get('id');
                                if (fileId) {
                                    newImages.push({
                                        fileId: fileId,
                                        url: `/settings/files/${fileId}` // Construct the new relative URL
                                    });
                                } else {
                                    console.warn(`Could not extract fileId from URL: ${imageUrl} for product ${product._id}`);
                                }
                            } catch (parseError) {
                                console.warn(`Could not parse URL: ${imageUrl} for product ${product._id}`, parseError);
                            }
                        } else {
                            console.warn(`Invalid item in imagesUrl for product ${product._id}:`, imageUrl);
                        }
                    }
                } else {
                    console.warn(`imagesUrl is not an array for product ${product._id}`);
                }

                // Add operation to bulk update
                bulkOps.push({
                    updateOne: {
                        filter: { _id: product._id },
                        update: {
                            $set: {
                                images: newImages,
                                status: ProductStatus.APPROVED // Set status to approved
                            },
                            $unset: { imagesUrl: "" } // Remove the old field
                        }
                    }
                });
                migratedCount++;
            } catch (error) {
                errorCount++;
                console.error(`Error processing product ${product._id}:`, error);
            }
        }

        console.log(`Prepared ${bulkOps.length} update operations. ${errorCount} products had processing errors.`);

        if (bulkOps.length > 0) {
            console.log('Executing bulk update...');
            const result = await ProductModel.bulkWrite(bulkOps, { ordered: false }); // ordered:false allows other updates if one fails
            console.log('Bulk update result:', {
                matchedCount: result.matchedCount,
                modifiedCount: result.modifiedCount,
                upsertedCount: result.upsertedCount,
                deletedCount: result.deletedCount,
                writeErrors: result.getWriteErrors().length,
            });
            if (result.hasWriteErrors()) {
                console.error("Bulk write errors occurred:", result.getWriteErrors());
            } else {
                console.log("Bulk update completed successfully.");
            }
        } else {
            console.log('No operations to execute.');
        }

    } catch (error) {
        console.error('Migration script failed:', error);
    } finally {
        await mongoose.disconnect();
        console.log('MongoDB disconnected.');
    }
}

runMigration();
