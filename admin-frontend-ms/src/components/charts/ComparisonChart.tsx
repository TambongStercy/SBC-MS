import React from 'react';
import {
    PieChart,
    Pie,
    Cell,
    ResponsiveContainer,
    Tooltip,
    Legend
} from 'recharts';

interface ComparisonData {
    name: string;
    value: number;
}

interface ComparisonChartProps {
    data: ComparisonData[];
    title: string;
    colors?: string[]; // Optional custom colors
}

const DEFAULT_COLORS = ['#0ea5e9', '#f59e0b', '#10b981', '#ef4444']; // Example colors

const ComparisonChart: React.FC<ComparisonChartProps> = ({ data, title, colors = DEFAULT_COLORS }) => {
    if (!data || data.length === 0 || data.every(item => item.value === 0)) {
        return (
            <div className="text-center text-gray-500 h-full flex flex-col justify-center">
                <h3 className="text-lg font-semibold mb-2 text-gray-900 dark:text-gray-100">{title}</h3>
                No data available for comparison.
            </div>
        );
    }

    const totalValue = data.reduce((sum, entry) => sum + entry.value, 0);

    return (
        <div className="text-center h-full flex flex-col">
            <h3 className="text-lg font-semibold mb-2 text-gray-900 dark:text-gray-100">{title}</h3>
            <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                    <Pie
                        data={data}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        // label={renderCustomizedLabel} // Add custom label if needed
                        outerRadius={80} // Adjust size as needed
                        innerRadius={50} // Make it a doughnut chart
                        fill="#8884d8"
                        dataKey="value"
                        paddingAngle={5}
                    >
                        {data.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
                        ))}
                    </Pie>
                    <Tooltip
                        formatter={(value: number, name: string) => [
                            `${value.toLocaleString()} (${((value / totalValue) * 100).toFixed(1)}%)`,
                            name
                        ]}
                        contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: '4px' }}
                        labelStyle={{ color: '#cbd5e1' }}
                        itemStyle={{ color: '#9ca3af' }}
                    />
                    <Legend wrapperStyle={{ fontSize: '12px', marginTop: '10px' }} />
                </PieChart>
            </ResponsiveContainer>
        </div>
    );
};

export default ComparisonChart; 