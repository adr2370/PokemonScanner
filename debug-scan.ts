/**
 * Debug script to test Pokemon card scanning
 * Run with: GEMINI_API_KEY=your_key npx tsx debug-scan.ts
 */

import * as fs from 'fs';
import * as path from 'path';

// Configuration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'YOUR_API_KEY_HERE';
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1I4BK6IdJ5aYXLpOJcO-Hf6iVGh9Ng11NUE-vBzLtrlE/edit';
const SHEET_TAB = 'My Collection';
const COLUMN = 'B';
const IMAGE_PATH = './pokemon-test-4.jpeg';

// ============ Sheets Utilities (same as app) ============

function extractSheetId(url: string): string | null {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
}

async function fetchSheetData(
  sheetUrl: string,
  sheetTab: string = '',
  column: string = 'A'
): Promise<string[]> {
  const sheetId = extractSheetId(sheetUrl);

  if (!sheetId) {
    throw new Error('Invalid Google Sheets URL');
  }

  let csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&range=${column}:${column}`;

  if (sheetTab && sheetTab.trim()) {
    csvUrl += `&sheet=${encodeURIComponent(sheetTab.trim())}`;
  }

  console.log('📋 Fetching from:', csvUrl);

  const response = await fetch(csvUrl);

  if (!response.ok) {
    throw new Error(`Failed to fetch sheet: ${response.statusText}`);
  }

  const csvText = await response.text();

  const lines = csvText.split('\n');
  const cards: string[] = [];

  // Skip first row (header)
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    let value = line.trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    value = value.replace(/""/g, '"');

    if (value) {
      cards.push(value);
    }
  }

  return cards;
}

// ============ Image Loading ============

function getImageAsDataUrl(imagePath: string): string {
  const absolutePath = path.resolve(imagePath);
  const imageBuffer = fs.readFileSync(absolutePath);
  const base64 = imageBuffer.toString('base64');

  const ext = path.extname(imagePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  };
  const mimeType = mimeTypes[ext] || 'image/jpeg';

  // Return as data URL (same format as FileReader.readAsDataURL)
  return `data:${mimeType};base64,${base64}`;
}

// ============ Vision API (EXACT COPY from src/utils/vision.ts) ============

async function findMissingPokemonInImage(
  imageBase64: string,
  missingList: string[],
  apiKey: string
): Promise<string[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent?key=${apiKey}`;

  // Remove data URL prefix if present
  const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');

  // Detect mime type from data URL or default to jpeg
  let mimeType = 'image/jpeg';
  const mimeMatch = imageBase64.match(/^data:(image\/\w+);base64,/);
  if (mimeMatch) {
    mimeType = mimeMatch[1];
  }

  // Create the prompt with the missing list
  const prompt = `You are analyzing a photo of Pokemon trading cards. Your task is to identify which Pokemon cards are visible in this image.

Here is my list of missing Pokemon cards that I'm looking for:
${missingList.map(name => `- ${name}`).join('\n')}

Please examine the image carefully and identify ANY Pokemon card names that are visible on the cards in the photo. Look at the name printed on each card (usually at the top of the card).

IMPORTANT:
- Only report Pokemon names that you can actually see written on cards in the image
- Match the names against my missing list above
- Report ONLY the names from my missing list that appear in the image
- If a card name has slight variations (like "Pikachu V" vs "Pikachu"), still match it if the base name is the same

Respond with ONLY a JSON array of the matching Pokemon names from my missing list, nothing else.
If no matches are found, respond with an empty array: []

Example response format: ["Pikachu", "Charizard", "Mewtwo"]`;

  const requestBody = {
    contents: [
      {
        parts: [
          {
            inline_data: {
              mime_type: mimeType,
              data: base64Data,
            },
          },
          {
            text: prompt,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1, // Low temperature for more precise matching
      topP: 0.8,
      maxOutputTokens: 8192, // Increased to account for model's thinking tokens
    },
  };

  // Debug: Log request details
  console.log('\n📤 REQUEST DETAILS:');
  console.log('   Model: gemini-3-pro-preview');
  console.log('   MIME type:', mimeType);
  console.log('   Base64 length:', base64Data.length);
  console.log('   Missing list size:', missingList.length);
  console.log('   Prompt length:', prompt.length);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('❌ API Error Response:', JSON.stringify(errorData, null, 2));
      if (errorData.error?.message) {
        throw new Error(errorData.error.message);
      }
      throw new Error(`Gemini API error: ${response.statusText}`);
    }

    const data = await response.json();

    // Debug: Log full response
    console.log('\n📥 FULL API RESPONSE:');
    console.log(JSON.stringify(data, null, 2));

    // Extract the text response
    const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;

    console.log('\n📝 TEXT RESPONSE:', textResponse);

    if (!textResponse) {
      console.log('⚠️ No text response from API');
      return [];
    }

    // Parse the JSON array from the response
    try {
      // Clean up the response - remove markdown code blocks if present
      let cleanedResponse = textResponse.trim();
      if (cleanedResponse.startsWith('```json')) {
        cleanedResponse = cleanedResponse.slice(7);
      }
      if (cleanedResponse.startsWith('```')) {
        cleanedResponse = cleanedResponse.slice(3);
      }
      if (cleanedResponse.endsWith('```')) {
        cleanedResponse = cleanedResponse.slice(0, -3);
      }
      cleanedResponse = cleanedResponse.trim();

      console.log('📝 CLEANED RESPONSE:', cleanedResponse);

      const foundPokemon = JSON.parse(cleanedResponse);

      if (Array.isArray(foundPokemon)) {
        // Validate that all returned names are actually in the missing list
        const validNames = foundPokemon.filter((name: string) =>
          missingList.some(missing =>
            missing.toLowerCase() === name.toLowerCase() ||
            missing.toLowerCase().includes(name.toLowerCase()) ||
            name.toLowerCase().includes(missing.toLowerCase())
          )
        );

        // Return the original names from the missing list for consistency
        return validNames.map((name: string) => {
          const match = missingList.find(missing =>
            missing.toLowerCase() === name.toLowerCase() ||
            missing.toLowerCase().includes(name.toLowerCase()) ||
            name.toLowerCase().includes(missing.toLowerCase())
          );
          return match || name;
        });
      }

      return [];
    } catch (parseError) {
      console.error('❌ JSON Parse Error:', parseError);
      // If JSON parsing fails, try to extract names manually
      const foundNames: string[] = [];
      for (const pokemon of missingList) {
        if (textResponse.toLowerCase().includes(pokemon.toLowerCase())) {
          foundNames.push(pokemon);
        }
      }
      return foundNames;
    }
  } catch (error) {
    console.error('❌ Fetch Error:', error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Failed to process image with Gemini API');
  }
}

// ============ Main ============

async function main() {
  console.log('🎴 Pokemon Card Scanner Debug Script\n');
  console.log('='.repeat(60));

  if (GEMINI_API_KEY === 'YOUR_API_KEY_HERE') {
    console.error('❌ Please set your GEMINI_API_KEY environment variable');
    process.exit(1);
  }

  // Step 1: Load the missing list (same way as the app)
  console.log('\n📋 Step 1: Loading missing list from Google Sheets...');
  console.log('   Sheet URL:', SHEET_URL);
  console.log('   Tab:', SHEET_TAB);
  console.log('   Column:', COLUMN);

  const missingList = await fetchSheetData(SHEET_URL, SHEET_TAB, COLUMN);
  console.log(`✅ Loaded ${missingList.length} cards`);
  console.log('   First 10:', missingList.slice(0, 10).join(', '));
  console.log('   Last 5:', missingList.slice(-5).join(', '));

  // Step 2: Load the image as data URL (same format as FileReader)
  console.log('\n🖼️ Step 2: Loading image as data URL...');
  const imageDataUrl = getImageAsDataUrl(IMAGE_PATH);
  console.log('   Data URL prefix:', imageDataUrl.substring(0, 50) + '...');
  console.log('   Total length:', imageDataUrl.length);

  // Step 3: Call the EXACT same function as the app
  console.log('\n🔍 Step 3: Calling findMissingPokemonInImage (same as app)...');
  console.log('='.repeat(60));

  try {
    const results = await findMissingPokemonInImage(
      imageDataUrl,
      missingList,
      GEMINI_API_KEY
    );

    console.log('\n' + '='.repeat(60));
    console.log('📊 FINAL RESULTS');
    console.log('='.repeat(60));
    console.log(`Found ${results.length} matching cards:`);
    results.forEach(name => console.log(`   ✅ ${name}`));

    if (results.length === 0) {
      console.log('\n⚠️ No results returned. Check the API response above for clues.');
    }
  } catch (error) {
    console.error('\n❌ ERROR:', error);
  }
}

main().catch(console.error);
