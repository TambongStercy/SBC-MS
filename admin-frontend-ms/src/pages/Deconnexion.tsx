import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { LogOut, ArrowLeft } from "lucide-react";
import { logoutAdmin } from "../api";
import { useAuth } from "../context/AuthContext";

function Deconnexion() {
  const navigate = useNavigate();
  const { logout } = useAuth();

  const handleLogout = async () => {
    try {
      // Call the API to logout on the server
      await logoutAdmin();
      // Use the auth context to clear local state
      logout();
      // Navigation is handled by the logout function in AuthContext
    } catch (error) {
      console.error("Error logging out:", error);
      // Even if the API call fails, still logout locally
      logout();
    }
  };

  const handleCancel = () => {
    navigate(-1); // Go back to the previous page
  };

  return (
    <motion.div
      className="flex flex-col justify-center items-center h-screen w-screen bg-gray-900 text-gray-100 z-10"
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: "easeInOut" }}
    >
      <motion.div
        className="bg-gray-800 rounded-lg p-8 shadow-lg text-center"
        initial={{ scale: 0.9 }}
        animate={{ scale: 1 }}
        transition={{ duration: 0.3, ease: "easeInOut" }}
      >
        <h2 className="text-2xl font-bold mb-4">Êtes-vous sûr de vouloir vous déconnecter ?</h2>
        <p className="mb-6 text-gray-300">Vous devrez vous reconnecter pour accéder à votre compte.</p>

        <div className="flex space-x-4 justify-center">
          <button
            onClick={handleLogout}
            className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg inline-flex items-center"
          >
            <LogOut size={18} className="mr-2" />
            Se Déconnecter
          </button>
          <button
            onClick={handleCancel}
            className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded-lg inline-flex items-center"
          >
            <ArrowLeft size={18} className="mr-2" />
            Annuler
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default Deconnexion;

