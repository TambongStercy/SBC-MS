import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import Header from '../components/common/Header';
import { User } from 'lucide-react';
import StatCard from '../components/common/statCard';
import PartnersTable from '../components/PartnersTable';
import { fetchPartners } from '../api'; // Import your API function
import Loader from '../components/common/loader';

function Partner() {
  const [partners, setPartners] = useState([]);
  const [numberOfPartners, setNumberOfPartners] = useState(0);
  const [loading, setLoading] = useState(true);  // State to manage loading
  const [error, setError] = useState<string | null>(null);  // State to manage errors

  useEffect(() => {
    // Fetch partners data when the component mounts
    const getPartnersData = async () => {
      try {
        setLoading(true);
        const data = await fetchPartners();
        setPartners(data.partners); // Set partners data
        setNumberOfPartners(data.total); // Set the total number of partners
        setLoading(false);  // Set loading to false after data is fetched
      } catch (error) {
        setError("Failed to fetch Partners data");
        setLoading(false);
      }
    };

    getPartnersData();
  }, []);



  if (loading) {
    return (
      <div className="flex justify-center items-center h-screen w-screen overflow-auto relative z-10">
        <Loader name={'Partenaire'} />
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

  return (
    <div className="flex-1 overflow-auto relative z-10">
      <Header title="Partenaires" />
      <motion.div
        className="backdrop-blur-md shadow-lg rounded-xl m-2"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1, ease: 'easeInOut' }}
      >
        <StatCard name="Nombre de partenaires" value={numberOfPartners} icon={User} color="#6366F1" />
      </motion.div>
      {/* Pass the partners data to the table */}
      <PartnersTable partners={partners} />
    </div>
  );
}

export default Partner;
