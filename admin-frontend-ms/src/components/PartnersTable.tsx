import { motion } from 'framer-motion';
import { Search, Pencil, BadgeSwissFranc } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

interface Partner {
    id: string;
    name: string;
    email: string;
    phoneNumber: string;
    pack: string;
    avatar: string;
}

interface PartnersTableProps {
    partners: Partner[];
}

const PartnersTable: React.FC<PartnersTableProps> = ({ partners }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [filteredData, setFilteredData] = useState(partners);
    const [currentPage, setCurrentPage] = useState(1);
    const usersPerPage = 50;

    // Update filtered data when partners prop changes
    useState(() => {
        setFilteredData(partners);
    });

    const indexOfLastUser = currentPage * usersPerPage;
    const indexOfFirstUser = indexOfLastUser - usersPerPage;
    const currentUsers = filteredData.slice(indexOfFirstUser, indexOfLastUser);

    const paginate = (pageNumber: number) => setCurrentPage(pageNumber);

    function handleSearch(e: { target: { value: string } }) {
        const term = e.target.value.toLowerCase();
        setSearchTerm(term);
        const filtered = partners.filter(
            (user) =>
                user.name.toLowerCase().includes(term) ||
                user.email.toLowerCase().includes(term) ||
                user.phoneNumber.includes(term)
        );
        setFilteredData(filtered);
    }

    return (
        <motion.div
            className="bg-gray-800 bg-opacity-50 backdrop-blur-md shadow-lg rounded-xl p-6 border border-gray-700 m-2"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, ease: 'easeInOut' }}
        >
            <div className="flex flex-col sm:flex-row items-center justify-between mb-6">
                <h2 className="text-lg sm:text-xl font-semibold text-gray-100 mb-4 sm:mb-0">Liste des partenaires</h2>
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
                                Pack
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                                Retrait
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                                Action
                            </th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-700">
                        {currentUsers.map((user) => (
                            <motion.tr
                                key={user.id}
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.3, ease: 'easeInOut' }}
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
                                <td className="px-6 py-4 whitespace-nowrap text-sm  text-gray-100 ">
                                    {user.email}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm  text-gray-100 ">
                                    {user.phoneNumber}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm  text-gray-100 ">
                                    {user.pack}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm ">
                                    <Link key={user.id} to={`/retraitPartenaire`} state={{ user }} >
                                        <button className="bg-gray-700 backdrop-blur-10 bg-opacity-50 text-white rounded-lg px-4 py-2">
                                            <BadgeSwissFranc size={18} />
                                        </button>
                                    </Link>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm ">
                                    <Link key={user.id} to={`/userpage/${user.id}`} >
                                        <button className="bg-gray-700 backdrop-blur-10 bg-opacity-50 text-white rounded-lg px-4 py-2">
                                            <Pencil size={18} />
                                        </button>
                                    </Link>
                                </td>
                            </motion.tr>
                        ))}
                    </tbody>
                </table>
                <div className=" flex justify-center gap-2 overflow-x-scroll relative sm:ml-10 sm:content-center">
                    {Array.from(
                        { length: Math.ceil(filteredData.length / usersPerPage) },
                        (_, index) => (
                            <button
                                key={index + 1}
                                onClick={() => paginate(index + 1)}
                                className={currentPage === index + 1 ? 'active' : ''}
                            >
                                {index + 1}
                            </button>
                        )
                    )}
                </div>
            </div>
        </motion.div>
    );
};

export default PartnersTable;
