import { useTheme } from '../theme';
import { MoonIcon, SunIcon } from './icons';

export function ThemeToggle() {
  const [theme, toggle] = useTheme();
  const label = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  return (
    <button className="icon-btn" id="btn-theme" title={label} aria-label={label} onClick={toggle}>
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
