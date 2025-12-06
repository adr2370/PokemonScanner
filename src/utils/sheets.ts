/**
 * Parses a Google Sheets URL and extracts the sheet ID
 */
export function extractSheetId(url: string): string | null {
  // Match patterns like:
  // https://docs.google.com/spreadsheets/d/SHEET_ID/...
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
}

/**
 * Fetches data from a public Google Sheet
 * The sheet must be published to the web or shared as "Anyone with the link can view"
 */
export async function fetchSheetData(
  sheetUrl: string,
  sheetTab: string = '',
  column: string = 'A'
): Promise<string[]> {
  const sheetId = extractSheetId(sheetUrl);

  if (!sheetId) {
    throw new Error('Invalid Google Sheets URL. Please check the URL format.');
  }

  // Use the Google Sheets CSV export URL
  // Format: https://docs.google.com/spreadsheets/d/{id}/gviz/tq?tqx=out:csv&sheet={sheetName}&range={column}:{column}
  let csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&range=${column}:${column}`;

  // Add sheet/tab name if specified
  if (sheetTab && sheetTab.trim()) {
    csvUrl += `&sheet=${encodeURIComponent(sheetTab.trim())}`;
  }

  try {
    const response = await fetch(csvUrl);

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('Sheet not found. Make sure the sheet is public.');
      }
      throw new Error(`Failed to fetch sheet: ${response.statusText}`);
    }

    const csvText = await response.text();

    // Parse CSV - handle quoted values and newlines
    const lines = csvText.split('\n');
    const cards: string[] = [];

    // Skip first row (header)
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      // Remove quotes and trim
      let value = line.trim();
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      // Replace escaped quotes
      value = value.replace(/""/g, '"');

      // Skip empty lines
      if (value) {
        cards.push(value);
      }
    }

    return cards;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Failed to fetch sheet data. Make sure the sheet is publicly accessible.');
  }
}

/**
 * Normalizes a Pokemon name for comparison
 */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    // Remove common suffixes and variations
    .replace(/\s*(ex|gx|v|vmax|vstar|v-union|break|lv\.?\s*x|delta|shining|radiant|galarian|alolan|hisuian|paldean)\s*/gi, '')
    // Remove special characters
    .replace(/[^a-z0-9]/g, '')
    // Handle common OCR mistakes
    .replace(/0/g, 'o')
    .replace(/1/g, 'l')
    .replace(/5/g, 's');
}

/**
 * Checks if a detected name matches any card in the missing list
 */
export function findMatchingCard(
  detectedName: string,
  missingList: string[]
): { match: string | null; confidence: number } {
  const normalizedDetected = normalizeName(detectedName);

  // Direct match
  for (const card of missingList) {
    if (normalizeName(card) === normalizedDetected) {
      return { match: card, confidence: 1.0 };
    }
  }

  // Partial match (detected name contains or is contained in card name)
  for (const card of missingList) {
    const normalizedCard = normalizeName(card);
    if (normalizedCard.includes(normalizedDetected) || normalizedDetected.includes(normalizedCard)) {
      const similarity = Math.min(normalizedDetected.length, normalizedCard.length) /
                        Math.max(normalizedDetected.length, normalizedCard.length);
      if (similarity > 0.7) {
        return { match: card, confidence: similarity };
      }
    }
  }

  // Fuzzy match using Levenshtein distance
  let bestMatch: string | null = null;
  let bestScore = 0;

  for (const card of missingList) {
    const normalizedCard = normalizeName(card);
    const distance = levenshteinDistance(normalizedDetected, normalizedCard);
    const maxLen = Math.max(normalizedDetected.length, normalizedCard.length);
    const similarity = 1 - (distance / maxLen);

    if (similarity > bestScore && similarity > 0.75) {
      bestScore = similarity;
      bestMatch = card;
    }
  }

  return { match: bestMatch, confidence: bestScore };
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}
