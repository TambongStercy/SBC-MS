import React from 'react';
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from 'recharts';
import { MonthlyRevenueData } from '../../pages/overViewPage'; // Adjust path if necessary

interface MonthlyRevenueChartProps {
    data: MonthlyRevenueData[];
}

const MonthlyRevenueChart: React.FC<MonthlyRevenueChartProps> = ({ data }) => {
    if (!data || data.length === 0) {
        return (
            <div className="text-gray-500 flex items-center justify-center h-full">
                No revenue data available.
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
            // Format amount for tooltip/axis if needed
            revenue: item.totalAmount,
        };
    });

    // Format currency for Y-axis ticks
    const formatYAxis = (tickItem: number) => {
        return `${(tickItem / 1000).toFixed(0)}k`; // Display as '10k', '20k'
    };

    return (
        <ResponsiveContainer width="100%" height={300}> // Fixed height
            <AreaChart
                data={formattedData}
                margin={{
                    top: 10,
                    right: 30,
                    left: 0,
                    bottom: 0,
                }}
            >
                <defs>
                    <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.8} />
                        <stop offset="95%" stopColor="#14b8a6" stopOpacity={0} />
                    </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="monthLabel" tick={{ fontSize: 12 }} />
                <YAxis tickFormatter={formatYAxis} tick={{ fontSize: 12 }} />
                <Tooltip
                    formatter={(value: number) => [`${value.toLocaleString()} F`, 'Revenu']}
                    contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: '4px' }}
                    labelStyle={{ color: '#cbd5e1' }}
                    itemStyle={{ color: '#9ca3af' }}
                />
                <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke="#14b8a6"
                    fillOpacity={1}
                    fill="url(#colorRevenue)"
                />
            </AreaChart>
        </ResponsiveContainer>
    );
};

export default MonthlyRevenueChart; 