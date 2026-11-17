import React from 'react';
import { LucideProps } from 'lucide-react';
import { Panel } from '../ui';

interface StatCardProps {
  name: string;
  icon: React.ComponentType<LucideProps>;
  value: string | number;
  /** Kept for compatibility; the icon now uses the theme's muted colour. */
  color?: string;
}

/**
 * Legacy key-figure card, drawn like the kit's Metric (prefer `Metric` from
 * components/ui in new code: it takes hugeicons and a hint line).
 */
const StatCard: React.FC<StatCardProps> = ({ name, icon: Icon, value }) => (
  <Panel className="p-4">
    <div className="flex items-center justify-between gap-3">
      <p className="text-xs font-medium text-fg-muted">{name}</p>
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-3 text-fg-muted" aria-hidden="true">
        <Icon size={16} />
      </span>
    </div>
    <div className="mt-2 text-2xl font-semibold tracking-tight text-fg">{value}</div>
  </Panel>
);

export default StatCard;
