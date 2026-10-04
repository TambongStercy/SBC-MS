import { createContext, useContext } from 'react';

/** Opens the app menu (the ☰ drawer on a phone). Provided by the shell; null outside it. */
export const MenuContext = createContext<(() => void) | null>(null);
export const useOpenMenu = () => useContext(MenuContext);
