import React from 'react';
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
} from 'recharts';
import { ActivityOverviewData } from '../../pages/overViewPage'; // Adjust path if necessary

interface ActivityOverviewChartProps {
    data: ActivityOverviewData[];
}

const ActivityOverviewChart: React.FC<ActivityOverviewChartProps> = ({ data }) => {
    if (!data || data.length === 0) {
        return (
            <div className="text-gray-500 flex items-center justify-center h-full">
                No activity data available.
            </div>
        );
    }

    // Format month names if needed (e.g., "2024-1" -> "Jan 24")
    const formattedData = data.map(item => {
        const [year, month] = item.month.split('-');
        const date = new Date(parseInt(year), parseInt(month) - 1);
        const monthName = date.toLocaleString('default', { month: 'short' });
        const shortYear = year.substring(2);
        return {
            ...item,
            monthLabel: `${monthName} ${shortYear}`,
        };
    });

    return (
        <ResponsiveContainer width="100%" height={300}> // Fixed height for consistency
            <BarChart
                data={formattedData}
                margin={{
                    top: 20,
                    right: 30,
                    left: 0, // Adjust left margin if needed
                    bottom: 5,
                }}
            >
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="monthLabel" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip
                    contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: '4px' }}
                    labelStyle={{ color: '#cbd5e1' }}
                    itemStyle={{ color: '#9ca3af' }}
                />
                <Legend wrapperStyle={{ fontSize: '14px' }} />
                <Bar dataKey="deposits" name="Dépôts" fill="#34d399" radius={[4, 4, 0, 0]} />
                <Bar dataKey="withdrawals" name="Retraits" fill="#f87171" radius={[4, 4, 0, 0]} />
                <Bar dataKey="payments" name="Paiements" fill="#60a5fa" radius={[4, 4, 0, 0]} />
            </BarChart>
        </ResponsiveContainer>
    );
};

export default ActivityOverviewChart; 