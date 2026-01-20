import Tesseract from 'tesseract.js';
import { findMatchingCard } from './sheets';

export interface ScanProgress {
  status: string;
  progress: number;
}

/**
 * Uses Tesseract.js to perform OCR on an image and find matching Pokemon names
 */
export async function findMissingPokemonWithOCR(
  imageSource: string,
  missingList: string[],
  onProgress?: (progress: ScanProgress) => void
): Promise<string[]> {
  if (missingList.length === 0) {
    return [];
  }

  onProgress?.({ status: 'Initializing OCR...', progress: 0 });

  try {
    // Perform OCR on the image
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
    });

    onProgress?.({ status: 'Matching Pokemon names...', progress: 85 });

    const extractedText = result.data.text;

    // Extract potential Pokemon names from the OCR text
    const matches = matchPokemonNames(extractedText, missingList);

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
function matchPokemonNames(text: string, missingList: string[]): string[] {
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
    if (lineMatch.match && lineMatch.confidence >= 0.75) {
      foundPokemon.add(lineMatch.match);
      continue;
    }

    // Try sliding window approach for multi-word names
    const words = trimmedLine.split(/\s+/);

    // Single words
    for (const word of words) {
      if (word.length < 3) continue;
      const match = findMatchingCard(word, missingList);
      if (match.match && match.confidence >= 0.8) {
        foundPokemon.add(match.match);
      }
    }

    // Two-word combinations
    for (let i = 0; i < words.length - 1; i++) {
      const twoWords = `${words[i]} ${words[i + 1]}`;
      if (twoWords.length < 4) continue;
      const match = findMatchingCard(twoWords, missingList);
      if (match.match && match.confidence >= 0.75) {
        foundPokemon.add(match.match);
      }
    }

    // Three-word combinations (for names like "Tapu Koko GX")
    for (let i = 0; i < words.length - 2; i++) {
      const threeWords = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
      const match = findMatchingCard(threeWords, missingList);
      if (match.match && match.confidence >= 0.75) {
        foundPokemon.add(match.match);
      }
    }
  }

  return Array.from(foundPokemon);
}
