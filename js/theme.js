/** Direction Blue: apply businesses.theme → data-theme + meta theme-color. */
export const THEMES = ['blue', 'teal', 'violet', 'graphite'];

export const THEME_META = {
  blue: '#1D6FD8',
  teal: '#0F766E',
  violet: '#6D28D9',
  graphite: '#18181B',
};

export const THEME_LABELS = {
  blue: 'כחול',
  teal: 'טיל',
  violet: 'סגול',
  graphite: 'גרפיט',
};

/** Preview bar swatches (bg / surface-2 / primary / ink) per preset. */
export const THEME_PREVIEWS = {
  blue: ['#F5F8FC', '#E8F0FA', '#1D6FD8', '#0F172A'],
  teal: ['#F3FAF8', '#E0F2EE', '#0F766E', '#134E4A'],
  violet: ['#F7F5FC', '#EDE8F8', '#6D28D9', '#1E1B2E'],
  graphite: ['#F4F4F5', '#E4E4E7', '#18181B', '#18181B'],
};

export function normalizeTheme(theme) {
  const t = String(theme || 'blue').toLowerCase();
  return THEMES.includes(t) ? t : 'blue';
}

/** Set html[data-theme] and all meta[name=theme-color]. Manifest stays blue. */
export function applyTheme(theme) {
  const t = normalizeTheme(theme);
  document.documentElement.setAttribute('data-theme', t);
  const color = THEME_META[t];
  document.querySelectorAll('meta[name="theme-color"]').forEach((el) => {
    el.setAttribute('content', color);
  });
  return t;
}

/** Alias used in pwa-meta.md */
export function applyThemeColor(theme) {
  return applyTheme(theme);
}
