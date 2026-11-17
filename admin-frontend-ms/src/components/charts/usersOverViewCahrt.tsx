import { useMemo, useState } from 'react';
import { useChartTheme } from '../../hooks/useChartTheme';
import { Panel, PanelBody, PanelHeader, Segmented } from '../ui';
import { SeriesLegend, TimeSeriesChart, type TimePoint } from './TimeSeriesChart';

// Define the expected structure of the data items
interface MonthlyUserSubData {
  monthLabel: string; // Formatted month label (e.g., "janv. 24")
  Users: number;
  Classique: number;
  Cible: number;
  Relance: number;
}

interface UsersOverViewChartProps {
  data: MonthlyUserSubData[];
}

const SUBS = [
  { key: 'Classique', label: 'Classique' },
  { key: 'Cible', label: 'Ciblé' },
  { key: 'Relance', label: 'Relance' },
];

/**
 * Sign-ups and subscriptions per month. Members and subscriptions differ by an
 * order of magnitude, so they are two views of the same panel instead of four
 * lines on one scale (which flattened the subscriptions to zero).
 */
const UsersOverViewCahrt: React.FC<UsersOverViewChartProps> = ({ data }) => {
  const t = useChartTheme();
  const [view, setView] = useState<'members' | 'subs'>('members');
  const points: TimePoint[] = useMemo(
    () => data.map((d, i) => ({ key: String(i), label: d.monthLabel, full: d.monthLabel, Users: d.Users, Classique: d.Classique, Cible: d.Cible, Relance: d.Relance })),
    [data],
  );
  const subs = SUBS.filter(s => s.key !== 'Relance' || data.some(d => d.Relance > 0));
  const series = view === 'members' ? [{ key: 'Users', label: 'Inscriptions' }] : subs;

  return (
    <Panel>
      <PanelHeader
        title={view === 'members' ? 'Membres inscrits par mois' : 'Abonnements démarrés par mois'}
        className="flex-col sm:flex-row"
        actions={(
          <Segmented
            label="Mesure"
            size="sm"
            value={view}
            onValueChange={setView}
            options={[{ value: 'members', label: 'Inscriptions' }, { value: 'subs', label: 'Abonnements' }]}
          />
        )}
      />
      <PanelBody className="space-y-3">
        <SeriesLegend series={series} colors={series.map((_, i) => t.series[i])} />
        <TimeSeriesChart data={points} series={series} ariaLabel={view === 'members' ? 'Membres inscrits par mois' : 'Abonnements démarrés par mois'} height={280} />
      </PanelBody>
    </Panel>
  );
};

export default UsersOverViewCahrt;
