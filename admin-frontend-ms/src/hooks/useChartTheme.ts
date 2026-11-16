import { useMemo, useSyncExternalStore } from 'react';

const read = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Re-renders when the theme class on <html> changes (after ThemeProvider applies it). */
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}
const themeClass = () => document.documentElement.className;

/**
 * Colours for charts (Recharts needs real values, not CSS variables), read
 * from the design tokens and refreshed when the theme changes.
 */
export function useChartTheme() {
  const cls = useSyncExternalStore(subscribe, themeClass, () => '');
  return useMemo(() => {
    void cls; // recomputed for each theme
    return {
      series: [1, 2, 3, 4, 5, 6].map(i => read(`--chart-${i}`)),
      primary: read('--primary'),
      accent: read('--accent'),
      ink: read('--ink'),
      grid: read('--line'),
      axis: read('--fg-subtle'),
      text: read('--fg-muted'),
      cursor: read('--surface-2'),
      tooltip: {
        contentStyle: {
          background: read('--surface'),
          border: `1px solid ${read('--line')}`,
          borderRadius: 10,
          boxShadow: '0 8px 24px rgb(0 0 0 / 0.12)',
          color: read('--fg'),
          fontSize: 12,
        },
        labelStyle: { color: read('--fg-muted'), marginBottom: 4 },
        itemStyle: { color: read('--fg') },
      },
    };
  }, [cls]);
}
