import Tesseract from 'tesseract.js';
import { findMatchingCard } from './sheets';

export interface ScanProgress {
  status: string;
  progress: number;
}

export interface ScanDebugInfo {
  rawText: string;
  matchAttempts: Array<{ text: string; result: string | null; confidence: number }>;
}

/**
 * Uses Tesseract.js to perform OCR on an image and find matching Pokemon names
 */
export async function findMissingPokemonWithOCR(
  imageSource: string,
  missingList: string[],
  onProgress?: (progress: ScanProgress) => void,
  onDebug?: (debug: ScanDebugInfo) => void
): Promise<string[]> {
  onProgress?.({ status: 'Initializing OCR...', progress: 0 });

  try {
    // Perform OCR on the image with optimized settings for card text
    const result = await Tesseract.recognize(imageSource, 'eng', {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          onProgress?.({
            status: 'Reading text...',
            progress: Math.round(m.progress * 80),
          });
        } else if (m.status === 'loading language traineddata') {
          onProgress?.({
            status: 'Loading OCR model...',
            progress: Math.round(m.progress * 20),
          });
        }
      },
    }, {
      tessedit_pageseg_mode: '11', // Sparse text - find as much text as possible
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 -\'',
    });

    onProgress?.({ status: 'Matching Pokemon names...', progress: 85 });

    const extractedText = result.data.text;

    // Extract potential Pokemon names from the OCR text
    const debugInfo: ScanDebugInfo = {
      rawText: extractedText,
      matchAttempts: []
    };

    const matches = missingList.length > 0
      ? matchPokemonNames(extractedText, missingList, debugInfo)
      : [];

    onDebug?.(debugInfo);
    onProgress?.({ status: 'Done!', progress: 100 });

    return matches;
  } catch (error) {
    console.error('OCR Error:', error);
    throw new Error('Failed to process image with OCR');
  }
}

/**
 * Extracts potential Pokemon names from OCR text and matches against the missing list
 */
function matchPokemonNames(text: string, missingList: string[], debugInfo?: ScanDebugInfo): string[] {
  const foundPokemon = new Set<string>();

  // Clean up OCR text - normalize whitespace and remove artifacts
  const cleanedText = text
    .replace(/[|\\/_\-=+*#@$%^&()[\]{}<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Split into lines and words
  const lines = cleanedText.split(/[\n\r]+/);

  // Process each line - Pokemon names are usually on their own line or clearly separated
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (trimmedLine.length < 2) continue;

    // Try matching the whole line first (for multi-word Pokemon names)
    const lineMatch = findMatchingCard(trimmedLine, missingList);
    debugInfo?.matchAttempts.push({
      text: trimmedLine,
      result: lineMatch.match,
      confidence: lineMatch.confidence
    });
    if (lineMatch.match && lineMatch.confidence >= 0.6) {
      foundPokemon.add(lineMatch.match);
      continue;
    }

    // Try sliding window approach for multi-word names
    const words = trimmedLine.split(/\s+/);

    // Single words (most important for Pokemon names)
    for (const word of words) {
      if (word.length < 3) continue;
      const match = findMatchingCard(word, missingList);
      debugInfo?.matchAttempts.push({
        text: word,
        result: match.match,
        confidence: match.confidence
      });
      if (match.match && match.confidence >= 0.65) {
        foundPokemon.add(match.match);
      }
    }

    // Two-word combinations
    for (let i = 0; i < words.length - 1; i++) {
      const twoWords = `${words[i]} ${words[i + 1]}`;
      if (twoWords.length < 4) continue;
      const match = findMatchingCard(twoWords, missingList);
      debugInfo?.matchAttempts.push({
        text: twoWords,
        result: match.match,
        confidence: match.confidence
      });
      if (match.match && match.confidence >= 0.6) {
        foundPokemon.add(match.match);
      }
    }

    // Three-word combinations (for names like "Tapu Koko GX")
    for (let i = 0; i < words.length - 2; i++) {
      const threeWords = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
      const match = findMatchingCard(threeWords, missingList);
      debugInfo?.matchAttempts.push({
        text: threeWords,
        result: match.match,
        confidence: match.confidence
      });
      if (match.match && match.confidence >= 0.6) {
        foundPokemon.add(match.match);
      }
    }
  }

  return Array.from(foundPokemon);
}
