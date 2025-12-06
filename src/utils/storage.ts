import type { AppSettings } from '../types';

const STORAGE_KEY = 'pokemon-scanner-settings';
const MISSING_LIST_KEY = 'pokemon-scanner-missing-list';

export function loadSettings(): AppSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('Failed to load settings:', e);
  }

  return {
    sheetUrl: '',
    visionApiKey: '',
    sheetTab: '',
    sheetColumn: 'A',
  };
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
}

export function loadMissingList(): string[] {
  try {
    const stored = localStorage.getItem(MISSING_LIST_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('Failed to load missing list:', e);
  }
  return [];
}

export function saveMissingList(list: string[]): void {
  try {
    localStorage.setItem(MISSING_LIST_KEY, JSON.stringify(list));
  } catch (e) {
    console.error('Failed to save missing list:', e);
  }
}
