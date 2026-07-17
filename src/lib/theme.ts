export type ThemePreference = 'system' | 'light' | 'dark'

export const THEME_PREFERENCE_KEY = 'theme-preference-v1'

function systemPrefersDark() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function readThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system'
  const raw = window.localStorage.getItem(THEME_PREFERENCE_KEY)
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system'
}

export function applyThemePreference(pref: ThemePreference) {
  if (typeof document === 'undefined') return
  const dark = pref === 'dark' || (pref === 'system' && systemPrefersDark())
  const root = document.documentElement
  root.classList.toggle('dark', dark)
  root.style.colorScheme = dark ? 'dark' : 'light'
}

export function saveThemePreference(pref: ThemePreference) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(THEME_PREFERENCE_KEY, pref)
}

