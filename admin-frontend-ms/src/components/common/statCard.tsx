import React from 'react';
import { LucideProps } from 'lucide-react';

interface StatCardProps {
  name: string;
  icon: React.ComponentType<LucideProps>;
  value: string | number;
  color?: string;
}

const StatCard: React.FC<StatCardProps> = ({ name, icon: Icon, value, color }) => {
  return (
    <div className="bg-surface overflow-hidden rounded-xl border border-line">
      <div className="p-4 py-5 sm:p-6">
        <span className="flex items-center text-sm font-medium text-fg-muted">
          <Icon size={20} className="mr-2" style={{ color }} />
          {name}
        </span>
        <p className="mt-1 text-2xl font-semibold text-fg">{value}</p>
      </div>
    </div>
  );
};

export default StatCard;
