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
import { useChartTheme } from '../../hooks/useChartTheme';

interface ActivityOverviewChartProps {
    data: ActivityOverviewData[];
}

const ActivityOverviewChart: React.FC<ActivityOverviewChartProps> = ({ data }) => {
    const chart = useChartTheme();
    if (!data || data.length === 0) {
        return (
            <div className="text-fg-subtle flex items-center justify-center h-full">
                Aucune donnée d'activité.
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
        };
    });

    return (
        // Fixed height for consistency
        <ResponsiveContainer width="100%" height={300}>
            <BarChart
                data={formattedData}
                margin={{
                    top: 20,
                    right: 30,
                    left: 0, // Adjust left margin if needed
                    bottom: 5,
                }}
            >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chart.grid} />
                <XAxis dataKey="monthLabel" tick={{ fontSize: 12, fill: chart.axis }} stroke={chart.grid} />
                <YAxis tick={{ fontSize: 12, fill: chart.axis }} stroke={chart.grid} />
                <Tooltip
                    contentStyle={chart.tooltip.contentStyle}
                    labelStyle={chart.tooltip.labelStyle}
                    itemStyle={chart.tooltip.itemStyle}
                    cursor={{ fill: chart.cursor }}
                />
                <Legend wrapperStyle={{ fontSize: '14px', color: chart.text }} />
                <Bar dataKey="deposits" name="Dépôts" fill="#34d399" radius={[4, 4, 0, 0]} />
                <Bar dataKey="withdrawals" name="Retraits" fill="#f87171" radius={[4, 4, 0, 0]} />
                <Bar dataKey="payments" name="Paiements" fill="#60a5fa" radius={[4, 4, 0, 0]} />
            </BarChart>
        </ResponsiveContainer>
    );
};

export default ActivityOverviewChart; 