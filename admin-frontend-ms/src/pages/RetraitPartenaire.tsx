import React, { useState } from 'react';
import Header from '../components/common/Header';
import { motion } from 'framer-motion';
import { BadgeSwissFranc, Check, HandCoins } from 'lucide-react';
import StatCard from '../components/common/statCard';
import { userWithdrawal } from '../api'; // Import the API function
import { useLocation } from 'react-router-dom';

function RetraitPartenaire() {

  const location = useLocation();
  const { user } = location.state || {}; // Accessing the passed state

  // State to manage form inputs
  const [operator, setOperator] = useState('Orange');
  const [phone, setPhone] = useState(user?.phoneNumber);
  const [amount, setAmount] = useState('');
  const [password, setPassword] = useState(''); // Admin password


  // Handle form submission
  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault(); // Prevent page refresh
    try {
      const data = {
        id: user?.id,
        operator,
        phone,
        amount: parseFloat(amount),
        password,
      };
      const response = await userWithdrawal(data); // Call the API function
      alert(`Withdrawal successful: ${response.message}`);
    } catch (error) {
      console.error('Failed to withdraw:', error);
      alert('Withdrawal failed. Please try again.');
    }
  };

  return (
    <div className="flex-1 overflow-auto relative z-10">
      <Header title="Retrait Partenaires" avatar={user?.avatar} name={user?.name} />
      <main className="max-w-7xl mx-auto py-6 px-4 lg:px-8 ">
        <StatCard
          name="Solde Partenaire"
          value={user?.amount + ' FCFA'}
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
                  placeholder="Entrer le mot de passe admin..."
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

export default RetraitPartenaire;
