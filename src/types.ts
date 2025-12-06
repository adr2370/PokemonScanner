export interface ScanResult {
  name: string;
  status: 'need' | 'have' | 'unknown';
  confidence: number;
}

export interface AppSettings {
  sheetUrl: string;
  visionApiKey: string;
  sheetTab: string;
  sheetColumn: string;
}

export type TabType = 'scan' | 'list' | 'settings';
