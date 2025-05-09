import { useParams } from 'react-router-dom';
import { motion } from "framer-motion";
import Header from "../components/common/Header";
import UserCard from "../components/userCard";
import UserProductsTable from "../components/usersProductsTable";
import { getUserDetails, AdminUserData, adminUpdateUserSubscription, adminUpdateUserPartner, PartnerPack } from "../services/adminUserApi";  // Import the API function
import { useEffect, useState } from 'react';
import Loader from '../components/common/loader';
import toast from 'react-hot-toast'; // Import toast for errors

// Define SubscriptionType locally if not imported
enum SubscriptionType {
  CLASSIQUE = 'CLASSIQUE',
  CIBLE = 'CIBLE',
}

function UsersPage() {
  const { userId } = useParams<{ userId: string }>();  // Get the userId from the URL
  const [userData, setUserData] = useState<AdminUserData | null>(null);  // State to hold the user data
  const [loading, setLoading] = useState(true);  // State to manage loading

  // Fetch the user data when the component mounts
  useEffect(() => {
    const fetchData = async () => {
      if (!userId) {
        toast.error("User ID is missing from URL.");
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
        toast.error(err.message || "Failed to fetch user data");
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

    const toastId = toast.loading('Updating subscription...');
    try {
      await adminUpdateUserSubscription(targetUserId, newType);
      toast.success('Subscription updated successfully!', { id: toastId });
      // Optionally re-fetch user data to confirm change
      // fetchData(); 
    } catch (error: any) {
      console.error("Subscription update failed:", error);
      toast.error(`Failed to update subscription: ${error.message}`, { id: toastId });
      // Revert optimistic update if done
      setUserData(originalUserData as AdminUserData);
    }
  };

  // Handler for partner pack changes from UserCard
  const handlePartnerPackChange = async (targetUserId: string, newPack: 'silver' | 'gold' | 'none') => {
    console.log(`Handling partner pack change for ${targetUserId} to ${newPack}`);
    const originalUserData = { ...userData }; // Keep backup in case of error

    const toastId = toast.loading('Updating partner status...');
    try {
      await adminUpdateUserPartner(targetUserId, newPack);
      toast.success('Partner status updated successfully!', { id: toastId });

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
      toast.error(`Failed to update partner status: ${error.message}`, { id: toastId });
      // Revert local state
      setUserData(originalUserData as AdminUserData);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-screen w-screen overflow-auto relative z-10">
        <Loader name={'User'} />
      </div>
    );
  }

  // Handle case where user data couldn't be loaded but not loading anymore
  if (!userData) {
    console.log("Rendering 'Could not load user data' message");
    return (
      <div className="flex flex-col justify-center items-center h-screen w-screen overflow-auto relative z-10 text-red-400">
        <Header title="Error" />
        <p>Could not load user data. Please check the ID or go back.</p>
      </div>
    )
  }

  console.log("Rendering UserCard and UserProductsTable with userData:", userData);

  return (
    <>
      <div className="flex-1 overflow-auto relative z-10">
        <Header title={`User Details: ${userData?.name || userId}`} />
        <motion.div
          className="bg-gray-800 bg-opacity-50 backdrop-blur-md shadow-lg rounded-xl p-6 border border-gray-700 mb-8 m-3"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, ease: "easeInOut" }}
        >
          <UserCard
            data={{
              _id: userData._id,
              id: userData._id,
              name: userData.name || 'Unknown Name',
              email: userData.email || 'N/A',
              role: userData.role || 'USER',
              phoneNumber: userData.phoneNumber?.toString() || 'N/A',
              registeredAt: new Date(userData.createdAt || Date.now()).toLocaleDateString(),
              avatar: userData.avatar || 'https://via.placeholder.com/150',
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
        <motion.div
          className=" backdrop-blur-md shadow-lg rounded-xl p-0  mb-8 m-3"
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
    </>
  );
}

export default UsersPage;
