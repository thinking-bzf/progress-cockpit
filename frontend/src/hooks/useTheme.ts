import { useEffect } from 'react';
import { useLocalStorage } from './useLocalStorage';

export type Theme = 'dark' | 'light';

export function useTheme() {
  const [theme, setTheme] = useLocalStorage<Theme>('theme', 'dark');
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);
  return [theme, setTheme] as const;
}
