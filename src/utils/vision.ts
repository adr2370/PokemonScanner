/**
 * Uses Google Gemini 3 Pro to identify Pokemon card names from an image
 * by providing the missing list directly in the prompt
 */
export async function findMissingPokemonInImage(
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
      maxOutputTokens: 1024,
    },
  };

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
      if (errorData.error?.message) {
        throw new Error(errorData.error.message);
      }
      throw new Error(`Gemini API error: ${response.statusText}`);
    }

    const data = await response.json();

    // Extract the text response
    const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!textResponse) {
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
    } catch {
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
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Failed to process image with Gemini API');
  }
}
