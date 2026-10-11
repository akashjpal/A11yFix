import dotenv from 'dotenv';
dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemma-2-2b:generateContent';

export async function generateFix(issue, sourceCode, filePath) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY not configured');
  }

  const prompt = `You are an accessibility expert. Fix the following WCAG violation in the provided source code.

Issue details:
- Rule ID: ${issue.ruleId}
- Description: ${issue.description}
- Impact: ${issue.impact}
- WCAG Tags: ${issue.wcagTags?.join(', ')}
- Affected HTML: ${issue.htmlSnippet}
- Page: ${issue.page}

Source file: ${filePath}
Source code:
\`\`\`${filePath.endsWith('.jsx') || filePath.endsWith('.tsx') ? 'tsx' : 'js'}\`\`\`
${sourceCode}

Requirements:
1. Generate ONLY the minimal change needed to fix this specific violation.
2. Do NOT invent new accessibility issues or WCAG classifications.
3. Return ONLY the complete corrected file content.
4. Do NOT add explanations or comments about the fix.
5. Preserve all existing functionality and styling.

Return the complete corrected source code. Do not wrap in markdown code blocks.`;

  const response = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': GEMINI_API_KEY
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 4096 }
    })
  });

  if (!response.ok) {
    throw new Error(`Gemma API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!generatedText) {
    throw new Error('No response generated from Gemma API');
  }

  return {
    summary: `Fix for ${issue.ruleId}: ${issue.description}`,
    filePath,
    newContent: generatedText.trim(),
    ruleId: issue.ruleId
  };
}
