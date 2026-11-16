import React from 'react';
import { motion } from 'framer-motion';
import { ArrowDownToLine } from 'lucide-react';
import UsersOverViewCahrt from './charts/usersOverViewCahrt';

interface User {
  id: string;
  name: string;
  email: string;
  phoneNumber: string;
  balance: number;
  usdBalance?: number; // Add USD balance field
  avatar: string;
}

// Copied from UsersOverViewCahrt.tsx to match expected data structure
interface MonthlyUserSubData {
  monthLabel: string; // Formatted month label (e.g., "Jan 24")
  Users: number;
  Classique: number;
  Cible: number;
  Relance: number;
}

interface UnsubcribedUsersTableProps {
  users: User[];
  monthlyData: MonthlyUserSubData[]; // Use the correct type here
}

const UnsubcribedUsersTable: React.FC<UnsubcribedUsersTableProps> = ({ users, monthlyData }) => {
  const handleDownload = async () => {
    openInNewTab(import.meta.env.VITE_API_URL + '/download-nonsub')
  };

  const handleDownloadCSV = async () => {
    openInNewTab(import.meta.env.VITE_API_URL + '/download-nonsub-csv')
  };


  const openInNewTab = (url: any) => {
    window.open(url, "_blank", "noreferrer");
  };

  return (
    <>
      <motion.div
        className="bg-surface rounded-xl p-6 border border-line mb-8 mt-2"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1, ease: 'easeInOut' }}
      >
        <div className="flex flex-col sm:flex-row items-center justify-between mb-6">
          <h2 className="text-lg sm:text-xl font-semibold text-fg mb-4 sm:mb-0">
            Liste des 10 derniers utilisateurs non souscrits
          </h2>
          <div className="relative w-full sm:w-auto">
            <motion.button
              className="bg-surface-2/50 text-fg rounded-sm py-1 px-2 flex items-center gap-2"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1.2, ease: 'easeInOut' }}
              onClick={handleDownload}
            >
              <p>Télécharger</p>
              <ArrowDownToLine />
            </motion.button>

            <motion.button
              className="bg-surface-2/50 text-fg rounded-sm py-1 px-2 flex items-center gap-2 mt-5"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1.2, ease: 'easeInOut' }}
              onClick={handleDownloadCSV}
            >
              <p>Télécharger en CSV</p>
              <ArrowDownToLine />
            </motion.button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-line">
            <thead>
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-fg-muted uppercase tracking-wider">
                  Noms
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-fg-muted uppercase tracking-wider">
                  E-mail
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-fg-muted uppercase tracking-wider">
                  Tel
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-fg-muted uppercase tracking-wider">
                  Solde FCFA
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-fg-muted uppercase tracking-wider">
                  Solde USD
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {users.map((user) => (
                <motion.tr
                  key={user.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, ease: 'easeInOut' }}
                >
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-fg flex gap-2 items-center">
                    <img
                      src={user.avatar ?? 'https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_1280.png'}
                      alt={user.name}
                      className="size-8 rounded-full"
                    />
                    {user.name}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-fg">
                    {user.email}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-fg">
                    {user.phoneNumber}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-fg">
                    {user.balance ? user.balance.toLocaleString('fr-FR') : '0'} FCFA
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-fg">
                    {user.usdBalance ? user.usdBalance.toLocaleString('fr-FR', {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '0,00'} USD
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.div>
      <UsersOverViewCahrt data={monthlyData} />

    </>
  );
};

export default UnsubcribedUsersTable;
