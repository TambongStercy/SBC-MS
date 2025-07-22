import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { motion } from 'framer-motion'
import { User, Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';

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
  // State for toggling line visibility
  const [visibleLines, setVisibleLines] = useState({
    Users: true,
    Classique: true,
    Cible: true
  });

  // Toggle function for line visibility
  const toggleLine = (lineKey: keyof typeof visibleLines) => {
    setVisibleLines(prev => ({
      ...prev,
      [lineKey]: !prev[lineKey]
    }));
  };

  // Line configurations
  const lineConfigs = [
    {
      key: 'Users' as const,
      name: 'Utilisateurs',
      stroke: '#8884d8',
      color: '#8884d8'
    },
    {
      key: 'Classique' as const,
      name: 'Abo. Classique',
      stroke: '#82ca9d',
      color: '#82ca9d'
    },
    {
      key: 'Cible' as const,
      name: 'Abo. Cible',
      stroke: '#ffc658',
      color: '#ffc658'
    }
  ];

  return (
    <div>
      <motion.div
        className='bg-gray-800 bg-opacity-50 backdrop-blur-md shadow-lg rounded-xl p-6 border border-gray-700'
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: "easeInOut" }}
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4">
          <h2 className="text-lg font-medium text-gray-400 flex gap-2 mb-3 sm:mb-0">
            <User color='#6366F1' />Utilisateurs inscrits
          </h2>

          {/* Filter Controls */}
          <div className="flex flex-wrap gap-3">
            {lineConfigs.map((config) => (
              <button
                key={config.key}
                onClick={() => toggleLine(config.key)}
                className={`flex items-center gap-2 px-3 py-1 rounded-lg border transition-all duration-200 ${visibleLines[config.key]
                    ? 'border-gray-500 bg-gray-700 text-white'
                    : 'border-gray-600 bg-gray-800 text-gray-400'
                  }`}
              >
                {visibleLines[config.key] ? (
                  <Eye size={16} color={config.color} />
                ) : (
                  <EyeOff size={16} className="text-gray-500" />
                )}
                <span className="text-sm font-medium">{config.name}</span>
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: visibleLines[config.key] ? config.color : '#6b7280' }}
                />
              </button>
            ))}
          </div>
        </div>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke='#4b5563' />
              <XAxis dataKey="monthLabel" stroke='#4b5563' tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} stroke='#4b5563' />
              <Tooltip
                contentStyle={{
                  backgroundColor: "rgba(31, 41, 55, 0.8)",
                  borderColor: "#4b5563",
                  borderRadius: "8px"
                }}
                itemStyle={{ color: "#E5E7EB" }}
                labelStyle={{ color: "#F3F4F6" }}
              />
              <Legend wrapperStyle={{ fontSize: '14px' }} />
              
              {/* Conditionally render lines based on visibility state */}
              {visibleLines.Users && (
                <Line
                  type='monotone'
                  dataKey='Users'
                  name='Utilisateurs'
                  stroke='#8884d8'
                  strokeWidth={3}
                  dot={{ r: 4, fill: '#8884d8' }}
                  activeDot={{ r: 6, fill: '#8884d8' }}
                />
              )}
              
              {visibleLines.Classique && (
                <Line
                  type='monotone'
                  dataKey='Classique'
                  name='Abo. Classique'
                  stroke='#82ca9d'
                  strokeWidth={3}
                  dot={{ r: 4, fill: '#82ca9d' }}
                  activeDot={{ r: 6, fill: '#82ca9d' }}
                />
              )}
              
              {visibleLines.Cible && (
                <Line
                  type='monotone'
                  dataKey='Cible'
                  name='Abo. Cible'
                  stroke='#ffc658'
                  strokeWidth={3}
                  dot={{ r: 4, fill: '#ffc658' }}
                  activeDot={{ r: 6, fill: '#ffc658' }}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </motion.div>
    </div>
  )
}

export default UsersOverViewCahrt
