import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Search, Pencil } from "lucide-react";
import { Link } from "react-router-dom";
import { fetchUsers } from "../api"; // Import the API functions
import Loader from "./common/loader";
import Pagination from './Pagination'; // Import the Pagination component

function UserTable() {
  const [searchTerm, setSearchTerm] = useState("");
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalUsers, setTotalUsers] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const usersPerPage = 30;

  // Track the AbortController instance to cancel previous requests
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  const [debounceTimeout, setDebounceTimeout] = useState<NodeJS.Timeout | null>(null);

  const fetchUserData = async (page: number, searchTerm: string) => {
    // Abort any ongoing request
    if (abortController) {
      abortController.abort(); // Cancel the previous request
    }

    // Create a new AbortController for the current request
    const controller = new AbortController();
    setAbortController(controller);

    setLoading(true);
    try {
      const usersResponse = await fetchUsers(searchTerm, page, usersPerPage, controller.signal);
      console.log("Users Data:", usersResponse); // Debugging
      setUsers(usersResponse.users);
      setTotalUsers(usersResponse.total); // Assuming the API returns total users count
    } catch (err: any) {
      if (err.code === "ERR_CANCELED") {
        console.log("Fetch aborted");
      } else {
        console.error("Error fetching data:", err);
        setError("Failed to load data");
      }
    } finally {
      setLoading(false);
    }
  };

  // Debounce Effect: Fetch users when searchTerm changes (after a delay)
  useEffect(() => {
    if (debounceTimeout) clearTimeout(debounceTimeout);

    const timeout = setTimeout(() => {
      fetchUserData(currentPage, searchTerm);
    }, 500); // 500ms debounce delay

    setDebounceTimeout(timeout);

    return () => clearTimeout(timeout); // Cleanup previous timeout on re-render
  }, [searchTerm, currentPage]);

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
    setCurrentPage(1); // Reset to first page on new search
  };

  return (
    <motion.div
      className="bg-gray-800 bg-opacity-50 backdrop-blur-md shadow-lg rounded-xl p-6 border border-gray-700 mb-8"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 1, ease: "easeInOut" }}
    >
      <div className="flex flex-col sm:flex-row items-center justify-between mb-6">
        <h2 className="text-lg sm:text-xl font-semibold text-gray-100 mb-4 sm:mb-0">
          Liste d'utilisateurs
        </h2>
        <div className="relative w-full sm:w-auto">
          <input
            type="text"
            placeholder="Rechercher..."
            className="bg-gray-700 text-white placeholder-gray-400 rounded-lg pl-10 pr-4 py-2 w-full sm:w-64 focus:outline-none focus:ring-2 focus:ring-blue-500"
            onChange={handleSearch}
            value={searchTerm}
          />
          <Search className="absolute left-3 top-2.5 text-gray-400" size={18} />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-700">
          <thead>
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                Noms
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                Email
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                Tel
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                Solde
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                Code
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                Action
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700">
            {loading ? (
              <div className="flex justify-center items-center h-500 m-500 overflow-auto relative z-10">
                <Loader name={searchTerm ?? "Table"} />
              </div>
            ) : null}

            {error ? (
              <div className="flex justify-center items-center h-500 m-10 overflow-auto relative z-10">
                {error}
              </div>
            ) : null}

            {!loading && !error
              ? users.map((user) => (
                <motion.tr
                  key={user._id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, ease: "easeInOut" }}
                >
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-100 flex gap-2 items-center">
                    <img
                      src={user.avatar}
                      alt={user.name}
                      className="size-8 rounded-full object-cover"
                      loading="lazy"
                    />
                    {user.name}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-100">
                    {user.email}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-100">
                    {user.phoneNumber}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-100">
                    {user.balance}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-100">
                    {user.referralCode}
                  </td>
                  <td
                    className="px-6 py-4 whitespace-nowrap text-sm"
                    style={{
                      color: user.isSubscribed ? "#10B981" : "#ec4899",
                    }}
                  >
                    {user.isSubscribed ? "Abonné" : "NON Abonné"}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <Link key={user._id} to={`/userpage/${user._id}`}>
                      <button className="bg-gray-700 backdrop-blur-10 bg-opacity-50 text-white rounded-lg px-4 py-2">
                        <Pencil size={18} />
                      </button>
                    </Link>
                  </td>
                </motion.tr>
              ))
              : null}
          </tbody>
        </table>

        <Pagination
          postsPerPage={usersPerPage}
          totalPosts={totalUsers}
          currentPage={currentPage}
          setCurrentPage={setCurrentPage}
        />
      </div>
    </motion.div>
  );
}

export default UserTable;
