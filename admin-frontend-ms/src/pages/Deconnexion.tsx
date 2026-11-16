import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon, Logout01Icon } from "@hugeicons/core-free-icons";
import { logoutAdmin } from "../api";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui";

/** Confirms the sign-out, tells the server, then clears the session (the guard sends to /login). */
function Deconnexion() {
  const navigate = useNavigate();
  const { logout } = useAuth();

  const handleLogout = async () => {
    try {
      // Call the API to logout on the server
      await logoutAdmin();
      // Use the auth context to clear local state
      logout();
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
    <div className="flex min-h-[60dvh] items-center justify-center">
      <motion.div
        className="w-full max-w-md rounded-panel border border-line bg-surface p-6 text-center shadow-panel sm:p-8"
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
      >
        <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-danger-soft text-danger" aria-hidden="true">
          <HugeiconsIcon icon={Logout01Icon} size={22} />
        </span>
        <h1 className="mb-2 text-xl font-semibold text-fg">Êtes-vous sûr de vouloir vous déconnecter ?</h1>
        <p className="mb-6 text-sm text-fg-muted">Vous devrez vous reconnecter pour accéder à votre compte.</p>

        <div className="flex flex-col-reverse justify-center gap-2 sm:flex-row">
          <Button variant="outline" size="lg" onClick={handleCancel}>
            <HugeiconsIcon icon={ArrowLeft01Icon} size={18} aria-hidden="true" />
            Annuler
          </Button>
          <Button variant="danger" size="lg" onClick={handleLogout}>
            <HugeiconsIcon icon={Logout01Icon} size={18} aria-hidden="true" />
            Se déconnecter
          </Button>
        </div>
      </motion.div>
    </div>
  );
}

export default Deconnexion;
