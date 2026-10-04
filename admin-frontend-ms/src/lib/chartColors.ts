import { useMemo } from 'react';
import { useTheme } from '../theme/ThemeProvider';

/** SVG attributes can't read CSS variables: resolve the theme tokens to colours for charts. */
export function useChartColors() {
    const { theme } = useTheme();
    return useMemo(() => {
        const css = getComputedStyle(document.documentElement);
        const c = (name: string) => `rgb(${css.getPropertyValue(`--c-${name}`).trim().split(/\s+/).join(',')})`;
        return { primary: c('primary'), success: c('success'), accent: c('accent'), grid: c('border'), ink: c('ink-3') };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [theme]);
}
