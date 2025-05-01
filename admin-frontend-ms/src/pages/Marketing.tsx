import { useEffect, useState } from 'react';
import Header from '../components/common/Header';
import { UserRoundX } from 'lucide-react';
import StatCard from '../components/common/statCard';
import UnsubcribedUsersTable from '../components/unsubcribedUsersTable';
import { fetchNonSubscribedUsers } from '../api'; // Import the API function
import Loader from '../components/common/loader';
import { convertDatesToMonthlyDataNonSub } from '../utils/dateUtils';

const Marketing = () => {
  const [nonSubscribedUsers, setNonSubscribedUsers] = useState([]);
  const [total, setTotalUsers] = useState(0);
  const [monthlyData, setMonthlyData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Fetch non-subscribed users when the component loads
  useEffect(() => {
    const getNonSubscribedUsers = async () => {
      try {
        const response = await fetchNonSubscribedUsers();
        const { nonSubDates, subDates, users, total } = response;

        setNonSubscribedUsers(users); // Set the fetched users data
        setTotalUsers(total); // Set the total number of non sub users

        const formattedData = convertDatesToMonthlyDataNonSub(nonSubDates,subDates)
        setMonthlyData(formattedData); // Set the monthly data for the chart
      } catch (err) {
        console.error('Error fetching non-subscribed users:', err);
        setError('Failed to fetch users');
      } finally {
        setLoading(false);
      }
    };

    getNonSubscribedUsers();
  }, []);

  
  if (loading) {
    return (
      <div className="flex justify-center items-center h-screen w-screen overflow-auto relative z-10">
        <Loader name={"Marketing"} />
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
      <Header title="Marketing" />
      <main className="max-w-7xl mx-auto py-6 px-4 lg:px-8 ">
        <StatCard
          name="Utilisateurs non inscrits"
          value={total} // Number of non-subscribed users
          icon={UserRoundX}
          color="red"
        />
        {/* Pass the fetched non-subscribed users data to the table */}
        <UnsubcribedUsersTable users={nonSubscribedUsers} monthlyData={monthlyData}/>
      </main>
    </div>
  );
};

export default Marketing;


