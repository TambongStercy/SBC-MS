import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { motion } from 'framer-motion'
import { User } from 'lucide-react';

// Define the expected structure of the data items
interface MonthlyUserSubData {
  monthLabel: string; // Formatted month label (e.g., "Jan 24")
  Users: number;
  Classique: number;
  Cible: number;
}

interface UsersOverViewChartProps {
  data: MonthlyUserSubData[];
}

const UsersOverViewCahrt: React.FC<UsersOverViewChartProps> = ({ data }) => {

  return (
    <div>
      <motion.div
        className='bg-gray-800 bg-opacity-50 backdrop-blur-md shadow-lg rounded-xl p-6 border border-gray-700'
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: "easeInOut" }}
      >
        <h2 className="text-lg font-medium text-gray-400 pb-4 flex gap-2"><User color='#6366F1' />Utilisateurs inscrits</h2>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke='#4b5563' />
              <XAxis dataKey="monthLabel" stroke='#4b5563' tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "rgba(31, 41, 55, 0.7)",
                  borderColor: "#4b5563"
                }}
                itemStyle={{ color: "#E5E7EB" }}
              />
              <Legend wrapperStyle={{ fontSize: '14px' }} />
              <Line
                type='monotone'
                dataKey='Users'
                stroke='#8884d8'
                strokeWidth={2}
                dot={{ r: 4 }}
                activeDot={{ r: 6 }}
              />
              <Line
                type='monotone'
                dataKey='Classique'
                name='Abo. Classique'
                stroke='#82ca9d'
                strokeWidth={2}
                dot={{ r: 4 }}
                activeDot={{ r: 6 }}
              />
              <Line
                type='monotone'
                dataKey='Cible'
                name='Abo. Cible'
                stroke='#ffc658'
                strokeWidth={2}
                dot={{ r: 4 }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </motion.div>
    </div>
  )
}

export default UsersOverViewCahrt
