import React, { useEffect, useState } from 'react';
import Header from '../components/common/Header';
import { motion } from 'framer-motion';
import { BadgeSwissFranc, Check, HandCoins } from 'lucide-react';
import StatCard from '../components/common/statCard';
import { adminWithdrawal, fetchAdminBalance } from '../api'; // Import the API function
import Loader from '../components/common/loader';

function RetraitAdmin() {
  // State to manage form inputs
  const [operator, setOperator] = useState('Orange');
  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState('');
  const [password, setPassword] = useState(''); // Admin password
  const [adminData, setAdminData] = useState<any>(null);  // State to hold the user data
  const [loading, setLoading] = useState(true);  // State to manage loading
  const [error, setError] = useState<string | null>(null);  // State to manage errors

  // Fetch the user data when the component mounts
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const response = await fetchAdminBalance();  // Fetch the user data by ID
        setAdminData(response);  // Store the fetched user data
        setLoading(false);  // Set loading to false after data is fetched
      } catch (err) {
        setError("Failed to fetch Admin data");
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-screen w-screen overflow-auto relative z-10">
        <Loader name={'Withdraw'} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex justify-center items-center h-screen w-screen overflow-auto relative z-10">
        {error}
      </div>
    );
  }


  // Handle form submission
  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault(); // Prevent page refresh
    try {
      const data = {
        operator,
        phone,
        amount: parseFloat(amount),
        password,
      };
      const response = await adminWithdrawal(data); // Call the API function
      alert(`Withdrawal successful: ${response.message}`);
    } catch (error) {
      console.error('Failed to withdraw:', error);
      alert('Withdrawal failed. Please try again.');
    }
  };

  return (
    <div className="flex-1 overflow-auto relative z-10">
      <Header title="Retrait" />
      <main className="max-w-7xl mx-auto py-6 px-4 lg:px-8 ">
        <StatCard
          name="Solde Admin"
          value={adminData?.balance + ' FCFA'}
          icon={BadgeSwissFranc}
          color="#6366F1"
        />
        <motion.div
          className="bg-gray-800 bg-opacity-50 backdrop-blur-md shadow-lg rounded-xl p-6 border border-gray-700 mb-8 mt-2"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, ease: 'easeInOut' }}
        >
          <div className="p-1 py-5 sm:p-6">
            <span className="flex items-center text-sm font-medium text-gray-400">
              <HandCoins size={20} className="mr-2" color="#6366F1" />
              Faire un retrait
            </span>
            <form onSubmit={handleSubmit}>
              <div className="relative flex flex-wrap gap-3">
                <select
                  name="Operator"
                  id="operator"
                  className="bg-gray-700 text-gray-400 placeholder-gray-400 rounded-lg pl-2 pr-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 mt-5"
                  value={operator}
                  onChange={(e) => setOperator(e.target.value)}
                >
                  <option value="Orange">Orange Money</option>
                  <option value="MTN">MTN MoMo</option>
                </select>
                <input
                  type="text"
                  placeholder="Entrer le numero..."
                  className="bg-gray-700 text-white placeholder-gray-400 rounded-lg pl-3 pr-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 mt-5"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
                <input
                  type="text"
                  placeholder="Entrer le montant..."
                  className="bg-gray-700 text-white placeholder-gray-400 rounded-lg pl-3 pr-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 mt-5"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
                <input
                  type="password"
                  placeholder="Entrer votre mot de passe..."
                  className="bg-gray-700 text-white placeholder-gray-400 rounded-lg pl-3 pr-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 mt-5"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="submit"
                  className="bg-gray-700 backdrop-blur-10 bg-opacity-50 text-gray-400 rounded-lg p-2 lg:ml-2 flex gap-1 mt-2"
                >
                  <p className="text-gray-400">Confirmer</p>
                  <Check size={18} className="mt-1 ml-2" />
                </button>
              </div>
            </form>
          </div>
        </motion.div>
      </main>
    </div>
  );
}

export default RetraitAdmin;
