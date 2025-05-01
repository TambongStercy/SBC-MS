import React, { useState } from "react";
import { motion } from "framer-motion";
import { Check, Link2 } from "lucide-react"; // Use proper icons
import { updateWhatsappLink, updateTelegramLink } from "../api"; // Import the necessary API functions

interface LinksCardProps {
  name: string;
  icon: typeof Link2; // Accept icon component type
  color: string;
}

const LinksCard: React.FC<LinksCardProps> = ({ name, icon: Icon, color }) => {
  const [link, setLink] = useState<string>(""); // Single state for the link
  const [loading, setLoading] = useState<boolean>(false); // Loading state

  // Handle input change
  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setLink(event.target.value); // Update the link state
  };

  // Handle update click based on the name (WhatsApp/Telegram)
  const handleUpdate = async () => {
    setLoading(true);
    try {
      if (name === "WhatsApp") {
        await updateWhatsappLink(link);
        alert("WhatsApp link updated successfully!");
      } else if (name === "Telegram") {
        await updateTelegramLink(link);
        alert("Telegram link updated successfully!");
      }
    } catch (error) {
      console.error(`Error updating ${name} link:`, error);
      alert(`Failed to update ${name} link.`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      className="bg-gray-800 bg-opacity-50 backdrop-blur-md overflow-hidden shadow-lg rounded-xl border border-gray-700"
      whileFocus={{ y: 5, boxShadow: "0 25px 50px 12px rgba(0, 0, 0, 0.25)" }}
    >
      <div className="p-4 py-5 sm:p-6">
        <span className="flex items-center text-sm font-medium text-gray-400">
          <Icon size={20} className="mr-2" style={{ color }} />
          {name}
        </span>
        <div className="relative flex flex-wrap">
          <input
            type="text"
            placeholder={`Enter ${name} link...`} // Dynamic placeholder
            className="bg-gray-700 text-white placeholder-gray-400 rounded-lg pl-10 pr-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 mt-5"
            onChange={handleInputChange}
            value={link}
          />
          <button
            className="bg-gray-700 backdrop-blur-10 bg-opacity-50 text-gray-400 rounded-lg p-2 lg:ml-2 flex gap-1 mt-2"
            onClick={handleUpdate}
            disabled={loading} // Disable button while loading
          >
            <p className="text-gray-400">{loading ? "Updating..." : "Confirm"}</p>
            <Check size={18} className="mt-1 ml-2" />
          </button>
          <Link2 className="absolute left-3 top-2.5 text-gray-400" size={18} />
        </div>
      </div>
    </motion.div>
  );
};

export default LinksCard;
