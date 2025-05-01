import React, { useState } from "react";
import { motion } from "framer-motion";
import { Trash2 } from "lucide-react";
import { deleteProduct } from "../api"; // Import your deleteProduct API function

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

const UserProductsTable: React.FC<UserProductsProps> = ({ data }) => {
  const [filteredData, setFilteredData] = useState(data);

  const handleDelete = async (productId: string) => {
    try {
      await deleteProduct(filteredData.id, productId); // Call API to delete product
      // Remove the deleted product from the UI
      setFilteredData((prevData) => ({
        ...prevData,
        product: prevData.product.filter((prdt) => prdt.id !== productId),
      }));
      alert("Produit/service supprimé avec succès.");
    } catch (error) {
      console.error("Failed to delete product:", error);
      alert("Échec de la suppression du produit/service.");
    }
  };

  return (
    <>
      <motion.div
        className="bg-gray-800 bg-opacity-50 backdrop-blur-md shadow-lg rounded-xl p-6 border border-gray-700 mb-8 mt-2"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1, ease: "easeInOut" }}
      >
        <div className="flex flex-col sm:flex-row items-center justify-between mb-6">
          <h2 className="text-lg sm:text-xl font-semibold text-gray-100 mb-4 sm:mb-0">
            Produits/Service
          </h2>
          <div className="relative w-full sm:w-auto"></div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-700">
            <thead>
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Produit/service
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Ville
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Tel
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Email
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {/* Add check for product array existence before mapping */}
              {filteredData.product && Array.isArray(filteredData.product) && filteredData.product.length > 0 ? (
                filteredData.product.map((prdt) => (
                  <motion.tr
                    key={prdt.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, ease: "easeInOut" }}
                  >
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-100 flex gap-2 items-center">
                      <img
                        src={prdt.imagesUrl[0]}
                        alt={prdt.name}
                        className="size-8 rounded-full"
                      />
                      {prdt.name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-100">
                      {filteredData.town}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-100">
                      {filteredData.phone}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-100">
                      {filteredData.email}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-100">
                      <button onClick={() => handleDelete(prdt.id)}>
                        <Trash2 color="#ec4899" />
                      </button>
                    </td>
                  </motion.tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="px-6 py-4 text-center text-sm text-gray-400">No products/services found for this user.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </motion.div>
    </>
  );
};

export default UserProductsTable;
