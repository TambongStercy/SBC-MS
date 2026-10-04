import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';

export type Theme = 'light' | 'dark';
const KEY = 'sbc-admin-theme';

/** Dark (the original admin's look) unless the admin picked light. index.html applies it before first paint. */
export function storedTheme(): Theme {
    try { return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
}

const ThemeContext = createContext<{ theme: Theme; setTheme: (t: Theme) => void }>({ theme: 'dark', setTheme: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
    const [theme, setThemeState] = useState<Theme>(storedTheme);

    useEffect(() => {
        document.documentElement.classList.toggle('dark', theme === 'dark');
        const meta = document.querySelector('meta[name="theme-color"]');
        meta?.setAttribute('content', theme === 'dark' ? '#111827' : '#F8FAFC');
    }, [theme]);

    const setTheme = useCallback((t: Theme) => {
        setThemeState(t);
        try { localStorage.setItem(KEY, t); } catch { /* private mode: the choice lasts this visit */ }
    }, []);

    return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
