import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from "../components/common/Header";
import { motion } from "framer-motion";
import StatCard from "../components/common/statCard";
import {
  UsersRound,
  UserRoundPlus,
  UserRoundCheck,
  // UserRound,
} from "lucide-react";
import Loader from "../components/common/loader";
import { listUsers, AdminUserData, AdminUserListFilters, AdminUserListResponse, getUserSummaryStats, UserSummaryStats, SubscriptionType } from '../services/adminUserApi';
import { PaginationOptions } from '../services/adminUserApi'; // Import PaginationOptions if needed elsewhere or keep local
import toast from 'react-hot-toast'; // Import react-hot-toast
import { getAvatarUrl } from '../api/apiClient'; // Import getAvatarUrl

// Define props for UserTablePlaceholder to include handlers
interface UserTablePlaceholderProps {
  users: AdminUserData[];
  onViewUser: (userId: string) => void;
  // Add props for block/unblock/delete later
}

// Update UserTablePlaceholder to accept and use props
const UserTablePlaceholder: React.FC<UserTablePlaceholderProps> = ({
  users,
  onViewUser,
}) => (
  <div className="overflow-x-auto shadow-md rounded-lg">
    <table className="min-w-full divide-y divide-gray-700">
      <thead className="bg-gray-800">
        <tr>
          <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Avatar</th>
          <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Name</th>
          <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Email</th>
          <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Phone Number</th>
          <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Subscription</th>
          <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Relance</th>
          <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Balance FCFA</th>
          <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Balance USD</th>
          <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Country</th>
          <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Status</th>
          <th scope="col" className="px-6 py-3 text-center text-xs font-medium text-gray-300 uppercase tracking-wider">Action</th>
        </tr>
      </thead>
      <tbody className="bg-gray-900 divide-y divide-gray-700">
        {users.map((user) => (
          <tr key={user._id} className="hover:bg-gray-800">
            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-100">
              <img
                src={user.avatar ? getAvatarUrl(user.avatar) : `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name || 'User')}&background=random`}
                alt={`${user.name}'s avatar`}
                className="h-10 w-10 rounded-full object-cover"
              />
            </td>
            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-100">{user.name}</td>
            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">{user.email}</td>
            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">{user.phoneNumber || 'N/A'}</td>
            <td className="px-6 py-4 whitespace-nowrap text-sm">
              {user.activeSubscriptionTypes && user.activeSubscriptionTypes.length > 0 ? (
                <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                  user.activeSubscriptionTypes.includes(SubscriptionType.CIBLE) ? 'bg-amber-500 text-amber-100' :
                  user.activeSubscriptionTypes.includes(SubscriptionType.CLASSIQUE) ? 'bg-green-500 text-green-100' :
                  'bg-gray-500 text-gray-100'
                }`}>
                  {user.activeSubscriptionTypes.includes(SubscriptionType.CIBLE) ? 'Cible' :
                   user.activeSubscriptionTypes.includes(SubscriptionType.CLASSIQUE) ? 'Classique' : 'None'}
                </span>
              ) : (
                <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-gray-500 text-gray-100">None</span>
              )}
            </td>
            <td className="px-6 py-4 whitespace-nowrap text-sm">
              {user.activeSubscriptionTypes && user.activeSubscriptionTypes.includes(SubscriptionType.RELANCE) ? (
                <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-500 text-blue-100">Active</span>
              ) : (
                <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-gray-500 text-gray-100">Inactive</span>
              )}
            </td>
            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">{user.balance !== undefined ? user.balance.toLocaleString('fr-FR', {minimumFractionDigits: 2, maximumFractionDigits: 2}) + ' FCFA' : 'N/A'}</td>
            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">{user.usdBalance !== undefined ? user.usdBalance.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}) + ' USD' : '0.00 USD'}</td>
            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">{user.country || 'N/A'}</td>
            <td className="px-6 py-4 whitespace-nowrap text-sm">
              <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${user.blocked ? 'bg-red-500 text-red-100' : user.deleted ? 'bg-gray-500 text-gray-100' : 'bg-green-500 text-green-100'}`}>
                {user.deleted ? 'Deleted' : user.blocked ? 'Blocked' : 'Active'}
              </span>
            </td>
            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-center">
              <button
                onClick={() => onViewUser(user._id)}
                className="text-indigo-400 hover:text-indigo-300"
              >
                View
              </button>
            </td>
          </tr>
        ))}
        {users.length === 0 && (
          <tr>
            <td colSpan={11} className="px-6 py-4 text-center text-sm text-gray-400">No users match the current filters.</td>
          </tr>
        )}
      </tbody>
    </table>
  </div>
);

const PaginationPlaceholder: React.FC<{
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}> = ({ currentPage, totalPages, onPageChange }) => (
  <div className="flex justify-between items-center mt-4">
    <button
      onClick={() => onPageChange(currentPage - 1)}
      disabled={currentPage <= 1}
      className="px-4 py-2 bg-gray-700 rounded disabled:opacity-50 disabled:cursor-not-allowed"
    >
      Previous
    </button>
    <span>Page {currentPage} of {totalPages}</span>
    <button
      onClick={() => onPageChange(currentPage + 1)}
      disabled={currentPage >= totalPages}
      className="px-4 py-2 bg-gray-700 rounded disabled:opacity-50 disabled:cursor-not-allowed"
    >
      Next
    </button>
  </div>
);

const UserFiltersPlaceholder: React.FC<{
  filters: AdminUserListFilters;
  onFilterChange: (filters: AdminUserListFilters) => void;
}> = ({ filters, onFilterChange }) => {
  const [searchInput, setSearchInput] = useState(filters.search || '');
  const [statusInput, setStatusInput] = useState(filters.status || '');

  useEffect(() => {
    setSearchInput(filters.search || '');
    setStatusInput(filters.status || '');
  }, [filters]);

  const handleLocalInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (name === 'search') {
      setSearchInput(value);
    }
    if (name === 'status') {
      setStatusInput(value);
    }
  };

  const handleApplyFilters = (e: React.FormEvent) => {
    e.preventDefault();
    console.log("Applying filters:", { search: searchInput, status: statusInput });
    onFilterChange({
      search: searchInput || undefined,
      status: (statusInput || undefined) as AdminUserListFilters['status']
    });
  };

  return (
    <form onSubmit={handleApplyFilters} className="mb-4 flex flex-wrap gap-4 items-center bg-gray-800 p-4 rounded-lg shadow">
      <input
        type="text"
        name="search"
        placeholder="Search name, email..."
        value={searchInput}
        onChange={handleLocalInputChange}
        className="px-3 py-2 bg-gray-700 rounded border border-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 flex-grow"
      />
      <select
        name="status"
        value={statusInput}
        onChange={handleLocalInputChange}
        className="px-3 py-2 bg-gray-700 rounded border border-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      >
        <option value="">All Statuses</option>
        <option value="active">Active</option>
        <option value="inactive">Inactive</option> {/* Assuming inactive exists */}
        <option value="blocked">Blocked</option>
        <option value="deleted">Deleted</option> {/* Assuming deleted exists */}
      </select>
      <button
        type="submit"
        className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-gray-800"
      >
        Search
      </button>
    </form>
  );
};

function Users() {
  const navigate = useNavigate();
  const [users, setUsers] = useState<AdminUserData[]>([]);
  const [pagination, setPagination] = useState<PaginationOptions>({ page: 1, limit: 10 });
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [filters, setFilters] = useState<AdminUserListFilters>({});
  const [isLoading, setIsLoading] = useState(true);
  const [summaryStats, setSummaryStats] = useState<UserSummaryStats | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(true);

  const fetchUsersList = useCallback(async () => {
    setIsLoading(true);
    const loadingToastId = toast.loading('Fetching users list...');
    try {
      console.log('Fetching users with filters:', filters, 'and pagination:', pagination);
      const response: AdminUserListResponse = await listUsers(filters, pagination);
      console.log('Received users response:', response);
      setUsers(response.data || []);
      setTotalPages(response.pagination?.totalPages || 1);
      setTotalCount(response.pagination?.totalCount || 0);

      const currentPageFromResponse = response.pagination?.currentPage;
      if (currentPageFromResponse !== undefined && currentPageFromResponse !== pagination.page) {
        setPagination(prev => ({ ...prev, page: currentPageFromResponse }));
      }
      toast.dismiss(loadingToastId);
    } catch (err: any) {
      console.error("Failed to fetch users:", err);
      toast.error(`Failed to load users list: ${err.message}`);
      toast.dismiss(loadingToastId);
    } finally {
      setIsLoading(false);
    }
  }, [filters, pagination]);

  const fetchSummaryStats = useCallback(async () => {
    setIsLoadingStats(true);
    try {
      const stats = await getUserSummaryStats();
      setSummaryStats(stats);
    } catch (err: any) {
      console.error("Failed to fetch summary stats:", err);
      toast.error(`Failed to load summary stats: ${err.message}`);
      setSummaryStats(null);
    } finally {
      setIsLoadingStats(false);
    }
  }, []);

  useEffect(() => {
    fetchUsersList();
    fetchSummaryStats();
  }, [fetchUsersList, fetchSummaryStats]);

  const handlePageChange = (newPage: number) => {
    if (newPage > 0 && newPage <= totalPages) {
      setPagination(prev => ({ ...prev, page: newPage }));
    }
  };

  const handleFilterChange = (newFilters: AdminUserListFilters) => {
    setPagination(prev => ({ ...prev, page: 1 }));
    setFilters(newFilters);
  };

  // --- Action Handlers --- 
  const handleViewUser = (userId: string) => {
    console.log("Viewing user:", userId);
    navigate(`/userpage/${userId}`);
  };

  if ((isLoading || isLoadingStats) && users.length === 0 && !summaryStats) {
    return (
      <div className="flex justify-center items-center h-screen w-screen overflow-auto relative z-10">
        <Loader name={"Users Data"} />
      </div>
    );
  }

  // const totalSubscribers = summaryStats ? summaryStats.activeClassique + summaryStats.activeCible : 0;

  return (
    <div className="flex-1 overflow-auto relative z-10">
      <Header title="Utilisateurs" />
      <main className="max-w-7xl mx-auto py-6 px-4 lg:px-8">
        <motion.div
          className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4 mb-8"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, ease: "easeInOut" }}
        >
          <StatCard
            name="Total Users"
            icon={UsersRound}
            value={(totalCount > 0 ? totalCount : (summaryStats?.totalUsers ?? 0)).toString()}
            color="#6366F1"
          />
          <StatCard
            name="Abonnés Classique"
            icon={UserRoundCheck}
            value={isLoadingStats ? "..." : (summaryStats?.activeClassique ?? 0).toString()}
            color="#10B981"
          />
          <StatCard
            name="Abonnés Cible"
            icon={UserRoundPlus}
            value={isLoadingStats ? "..." : (summaryStats?.activeCible ?? 0).toString()}
            color="#F59E0B"
          />
        </motion.div>
        <UserFiltersPlaceholder filters={filters} onFilterChange={handleFilterChange} />

        {isLoading && users.length === 0 && <div className="text-center py-4 text-gray-400">Loading users list...</div>}

        {!isLoading && users.length === 0 && (
          <div className="text-center py-4 text-gray-400">No users found matching the criteria.</div>
        )}

        {users.length > 0 && (
          <UserTablePlaceholder
            users={users}
            onViewUser={handleViewUser}
          />
        )}

        {users.length > 0 && totalPages > 1 && (
          <PaginationPlaceholder
            currentPage={pagination.page}
            totalPages={totalPages}
            onPageChange={handlePageChange}
          />
        )}
        <div className="text-sm text-gray-400 mt-2">Total users found: {totalCount}</div>
      </main>
    </div>
  );
}

export default Users;
