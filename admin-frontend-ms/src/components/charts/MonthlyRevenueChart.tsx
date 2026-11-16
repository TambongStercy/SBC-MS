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
import { useChartTheme } from '../../hooks/useChartTheme';

interface MonthlyRevenueChartProps {
    data: MonthlyRevenueData[];
}

const MonthlyRevenueChart: React.FC<MonthlyRevenueChartProps> = ({ data }) => {
    const chart = useChartTheme();
    if (!data || data.length === 0) {
        return (
            <div className="text-fg-subtle flex items-center justify-center h-full">
                Aucune donnée de revenu.
            </div>
        );
    }

    // Format month names if needed (e.g., "2024-1" -> "Jan 24")
    const formattedData = data.map(item => {
        const [year, month] = item.month.split('-');
        const date = new Date(parseInt(year), parseInt(month) - 1);
        const monthName = date.toLocaleString('fr-FR', { month: 'short' });
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
        // Fixed height
        <ResponsiveContainer width="100%" height={300}>
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
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chart.grid} />
                <XAxis dataKey="monthLabel" tick={{ fontSize: 12, fill: chart.axis }} stroke={chart.grid} />
                <YAxis tickFormatter={formatYAxis} tick={{ fontSize: 12, fill: chart.axis }} stroke={chart.grid} />
                <Tooltip
                    formatter={(value: number) => [`${value.toLocaleString('fr-FR')} F`, 'Revenu']}
                    contentStyle={chart.tooltip.contentStyle}
                    labelStyle={chart.tooltip.labelStyle}
                    itemStyle={chart.tooltip.itemStyle}
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