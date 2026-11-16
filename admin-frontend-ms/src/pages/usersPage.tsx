import { useParams } from 'react-router-dom';
import { motion } from "framer-motion";
import Header from "../components/common/Header";
import UserCard from "../components/userCard";
import UserProductsTable from "../components/usersProductsTable";
import { getUserDetails, AdminUserData, adminUpdateUserSubscription, adminUpdateUserPartner, PartnerPack, blockUser, unblockUser, deleteUser, restoreUser } from "../services/adminUserApi";  // Import the API function
import { useEffect, useState } from 'react';
import Loader from '../components/common/loader';
import toast from 'react-hot-toast'; // Import toast for errors
import { getAvatarUrl } from '../api/apiClient'; // Import getAvatarUrl
import ConfirmationModal from '../components/common/ConfirmationModal';

// Define SubscriptionType locally if not imported
enum SubscriptionType {
  CLASSIQUE = 'CLASSIQUE',
  CIBLE = 'CIBLE',
}

function UsersPage() {
  const { userId } = useParams<{ userId: string }>();  // Get the userId from the URL
  const [userData, setUserData] = useState<AdminUserData | null>(null);  // State to hold the user data
  const [loading, setLoading] = useState(true);  // State to manage loading
  const [accountActionLoading, setAccountActionLoading] = useState(false);
  const [confirmModal, setConfirmModal] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);

  // Fetch the user data when the component mounts
  useEffect(() => {
    const fetchData = async () => {
      if (!userId) {
        toast.error("Identifiant de l’utilisateur absent de l’URL.");
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        const fetchedData = await getUserDetails(userId);
        console.log("User data received:", fetchedData);
        setUserData(fetchedData);  // Store the fetched user data
        setLoading(false);  // Set loading to false after data is fetched
      } catch (err: any) {
        console.error("Failed to fetch user details:", err);
        toast.error(err.message || "Impossible de charger l’utilisateur");
        setLoading(false);
      }
    };

    fetchData();
  }, [userId]);

  // Inside the component, before the return statement
  console.log("Rendering UsersPage, loading:", loading, "userData:", userData);

  // Handler for subscription changes from UserCard
  const handleSubscriptionChange = async (targetUserId: string, newType: SubscriptionType | 'NONE') => {
    console.log(`Handling subscription change for ${targetUserId} to ${newType}`);
    const originalUserData = { ...userData }; // Keep backup in case of error
    // Optimistically update local state? (Optional)
    // setUserData(prev => prev ? ({ ...prev, role: newType === 'NONE' ? 'USER' : newType }) : null);

    const toastId = toast.loading('Mise à jour de l’abonnement…');
    try {
      await adminUpdateUserSubscription(targetUserId, newType);
      toast.success('Abonnement mis à jour', { id: toastId });
      // Optionally re-fetch user data to confirm change
      // fetchData(); 
    } catch (error: any) {
      console.error("Subscription update failed:", error);
      toast.error(`Échec de la mise à jour de l’abonnement : ${error.message}`, { id: toastId });
      // Revert optimistic update if done
      setUserData(originalUserData as AdminUserData);
    }
  };

  // Handler for partner pack changes from UserCard
  const handlePartnerPackChange = async (targetUserId: string, newPack: 'silver' | 'gold' | 'none') => {
    console.log(`Handling partner pack change for ${targetUserId} to ${newPack}`);
    const originalUserData = { ...userData }; // Keep backup in case of error

    const toastId = toast.loading('Mise à jour du statut partenaire…');
    try {
      await adminUpdateUserPartner(targetUserId, newPack);
      toast.success('Statut partenaire mis à jour', { id: toastId });

      // Update local state to reflect the change
      if (userData) {
        setUserData({
          ...userData,
          partnerPack: newPack === 'none' ? undefined :
            (newPack === 'silver' ? PartnerPack.SILVER : PartnerPack.GOLD)
        });
      }
    } catch (error: any) {
      console.error("Partner update failed:", error);
      toast.error(`Échec de la mise à jour du statut partenaire : ${error.message}`, { id: toastId });
      // Revert local state
      setUserData(originalUserData as AdminUserData);
    }
  };

  const handleAccountAction = (action: 'block' | 'unblock' | 'delete' | 'restore') => {
    const messages = {
      block: { title: 'Bloquer l’utilisateur', message: `Bloquer ${userData?.name} ? Il ne pourra plus se connecter.` },
      unblock: { title: 'Débloquer l’utilisateur', message: `Débloquer ${userData?.name} ? Il retrouvera l’accès à son compte.` },
      delete: { title: 'Supprimer l’utilisateur', message: `Supprimer ${userData?.name} ? Cette suppression est réversible.` },
      restore: { title: 'Restaurer l’utilisateur', message: `Restaurer ${userData?.name} ? Son compte sera réactivé.` },
    };
    setConfirmModal({
      ...messages[action],
      onConfirm: async () => {
        setConfirmModal(null);
        setAccountActionLoading(true);
        const toastId = toast.loading('Traitement…');
        try {
          if (action === 'block') await blockUser(userData!._id);
          else if (action === 'unblock') await unblockUser(userData!._id);
          else if (action === 'delete') await deleteUser(userData!._id);
          else if (action === 'restore') await restoreUser(userData!._id);

          setUserData(prev => {
            if (!prev) return prev;
            if (action === 'block') return { ...prev, blocked: true };
            if (action === 'unblock') return { ...prev, blocked: false };
            if (action === 'delete') return { ...prev, deleted: true };
            if (action === 'restore') return { ...prev, deleted: false };
            return prev;
          });
          toast.success('Terminé', { id: toastId });
        } catch (err: any) {
          toast.error(err.response?.data?.message || 'Échec de l’action', { id: toastId });
        } finally {
          setAccountActionLoading(false);
        }
      },
    });
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-96">
        <Loader name={'Utilisateur'} />
      </div>
    );
  }

  // Handle case where user data couldn't be loaded but not loading anymore
  if (!userData) {
    console.log("Rendering 'Could not load user data' message");
    return (
      <div className="text-danger">
        <Header title="Erreur" />
        <p>Impossible de charger cet utilisateur. Vérifiez l’identifiant ou revenez en arrière.</p>
      </div>
    )
  }

  console.log("Rendering UserCard and UserProductsTable with userData:", userData);

  return (
    <>
      <div>
        <Header title={`Détails de l’utilisateur : ${userData?.name || userId}`} />
        <motion.div
          className="bg-surface rounded-xl p-6 border border-line mb-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, ease: "easeInOut" }}
        >
          <UserCard
            data={{
              _id: userData._id,
              id: userData._id,
              name: userData.name || 'Nom inconnu',
              email: userData.email || 'N/A',
              role: userData.role || 'USER',
              phoneNumber: userData.phoneNumber?.toString() || 'N/A',
              registeredAt: new Date(userData.createdAt || Date.now()).toLocaleDateString('fr-FR'),
              avatar: userData.avatar ? getAvatarUrl(userData.avatar) : `https://ui-avatars.com/api/?name=${encodeURIComponent(userData.name || 'Utilisateur')}&background=random`,
              momoNumber: userData.momoNumber?.toString() || 'N/A',
              momoOperator: userData.momoOperator || 'N/A',
              city: userData.city || 'N/A',
              region: userData.region || 'N/A',
              isVerified: userData.isVerified,
              activeSubscriptionTypes: userData.activeSubscriptionTypes,
              createdAt: userData.createdAt,
              country: userData.country,
              partnerPack: userData.partnerPack,
              product: []
            }}
            onSubscriptionChange={handleSubscriptionChange}
            onPartnerPackChange={handlePartnerPackChange}
          />
        </motion.div>

        {/* Account Status */}
        <motion.div
          className="bg-surface rounded-xl p-6 border border-line mb-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, ease: "easeInOut" }}
        >
          <h3 className="text-lg font-semibold text-fg mb-4">Statut du compte</h3>
          <div className="flex flex-wrap gap-3 items-center">
            <div className="flex gap-2 items-center text-sm text-fg-muted">
              <span>Statut :</span>
              {userData.deleted ? (
                <span className="px-2 py-0.5 bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 rounded-sm text-xs font-semibold">Supprimé</span>
              ) : userData.blocked ? (
                <span className="px-2 py-0.5 bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-300 rounded-sm text-xs font-semibold">Bloqué</span>
              ) : (
                <span className="px-2 py-0.5 bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 rounded-sm text-xs font-semibold">Actif</span>
              )}
            </div>
            <div className="flex gap-2 ml-auto">
              {userData.deleted ? (
                <button
                  onClick={() => handleAccountAction('restore')}
                  disabled={accountActionLoading}
                  className="px-4 py-1.5 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white rounded-sm text-sm font-semibold transition-colors"
                >
                  Restaurer
                </button>
              ) : (
                <>
                  {userData.blocked ? (
                    <button
                      onClick={() => handleAccountAction('unblock')}
                      disabled={accountActionLoading}
                      className="px-4 py-1.5 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white rounded-sm text-sm font-semibold transition-colors"
                    >
                      Débloquer
                    </button>
                  ) : (
                    <button
                      onClick={() => handleAccountAction('block')}
                      disabled={accountActionLoading}
                      className="px-4 py-1.5 bg-orange-700 hover:bg-orange-600 disabled:opacity-50 text-white rounded-sm text-sm font-semibold transition-colors"
                    >
                      Bloquer
                    </button>
                  )}
                  <button
                    onClick={() => handleAccountAction('delete')}
                    disabled={accountActionLoading}
                    className="px-4 py-1.5 bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white rounded-sm text-sm font-semibold transition-colors"
                  >
                    Supprimer
                  </button>
                </>
              )}
            </div>
          </div>
        </motion.div>

        <motion.div
          className="rounded-xl mb-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, ease: "easeInOut" }}
        >
          <UserProductsTable
            data={{
              id: userData._id,
              name: userData.name,
              email: userData.email,
              phone: userData.phoneNumber?.toString() || 'N/A',
              town: userData.city || userData.region || 'N/A',
              product: []
            }}
          />
        </motion.div>
      </div>

      {confirmModal && (
        <ConfirmationModal
          isOpen={true}
          title={confirmModal.title}
          message={confirmModal.message}
          confirmText="Confirmer"
          cancelText="Annuler"
          onConfirm={confirmModal.onConfirm}
          onCancel={() => setConfirmModal(null)}
        />
      )}
    </>
  );
}

export default UsersPage;
