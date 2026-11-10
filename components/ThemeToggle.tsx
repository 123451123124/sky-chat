'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from './ThemeProvider';

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const label = theme === 'light' ? '切换暗色模式' : '切换亮色模式';
  return <button onClick={toggle} className="sky-icon-button" title={label} aria-label={label}>{theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}</button>;
}
