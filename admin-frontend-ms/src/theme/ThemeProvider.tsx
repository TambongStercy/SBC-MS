import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';

export type Theme = 'light' | 'dark';
const KEY = 'sbc-admin-theme';

/** Light unless the admin picked dark. index.html applies it before first paint. */
export function storedTheme(): Theme {
    try { return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'; } catch { return 'light'; }
}

const ThemeContext = createContext<{ theme: Theme; setTheme: (t: Theme) => void }>({ theme: 'light', setTheme: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
    const [theme, setThemeState] = useState<Theme>(storedTheme);

    useEffect(() => {
        document.documentElement.classList.toggle('dark', theme === 'dark');
        const meta = document.querySelector('meta[name="theme-color"]');
        meta?.setAttribute('content', theme === 'dark' ? '#0B1120' : '#F8FAFC');
    }, [theme]);

    const setTheme = useCallback((t: Theme) => {
        setThemeState(t);
        try { localStorage.setItem(KEY, t); } catch { /* private mode: the choice lasts this visit */ }
    }, []);

    return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
