import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { motion } from 'framer-motion'
import { User, Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { useChartTheme } from '../../hooks/useChartTheme';

// Define the expected structure of the data items
interface MonthlyUserSubData {
  monthLabel: string; // Formatted month label (e.g., "Jan 24")
  Users: number;
  Classique: number;
  Cible: number;
  Relance: number;
}

interface UsersOverViewChartProps {
  data: MonthlyUserSubData[];
}

const UsersOverViewCahrt: React.FC<UsersOverViewChartProps> = ({ data }) => {
  const chart = useChartTheme();
  // State for toggling line visibility
  const [visibleLines, setVisibleLines] = useState({
    Users: true,
    Classique: true,
    Cible: true,
    Relance: true
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
      name: 'Membres',
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
    },
    {
      key: 'Relance' as const,
      name: 'Abo. Relance',
      stroke: '#ef4444',
      color: '#ef4444'
    }
  ];

  return (
    <div>
      <motion.div
        className='bg-surface rounded-xl p-6 border border-line'
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: "easeInOut" }}
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4">
          <h2 className="text-lg font-medium text-fg-muted flex gap-2 mb-3 sm:mb-0">
            <User color='#6366F1' />Membres inscrits
          </h2>

          {/* Filter Controls */}
          <div className="flex flex-wrap gap-3">
            {lineConfigs.map((config) => (
              <button
                key={config.key}
                onClick={() => toggleLine(config.key)}
                className={`flex items-center gap-2 px-3 py-1 rounded-lg border transition-all duration-200 ${visibleLines[config.key]
                    ? 'border-line-strong bg-surface-2 text-fg'
                    : 'border-line-strong bg-surface text-fg-muted'
                  }`}
              >
                {visibleLines[config.key] ? (
                  <Eye size={16} color={config.color} />
                ) : (
                  <EyeOff size={16} className="text-fg-subtle" />
                )}
                <span className="text-sm font-medium">{config.name}</span>
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: visibleLines[config.key] ? config.color : chart.axis }}
                />
              </button>
            ))}
          </div>
        </div>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
              <XAxis dataKey="monthLabel" stroke={chart.grid} tick={{ fontSize: 12, fill: chart.axis }} />
              <YAxis tick={{ fontSize: 12, fill: chart.axis }} stroke={chart.grid} />
              <Tooltip
                contentStyle={chart.tooltip.contentStyle}
                itemStyle={chart.tooltip.itemStyle}
                labelStyle={chart.tooltip.labelStyle}
              />
              <Legend wrapperStyle={{ fontSize: '14px', color: chart.text }} />
              
              {/* Conditionally render lines based on visibility state */}
              {visibleLines.Users && (
                <Line
                  type='monotone'
                  dataKey='Users'
                  name='Membres'
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

              {visibleLines.Relance && (
                <Line
                  type='monotone'
                  dataKey='Relance'
                  name='Abo. Relance'
                  stroke='#ef4444'
                  strokeWidth={3}
                  dot={{ r: 4, fill: '#ef4444' }}
                  activeDot={{ r: 6, fill: '#ef4444' }}
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
