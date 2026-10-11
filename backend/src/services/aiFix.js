import dotenv from 'dotenv';
dotenv.config();

// OpenRouter configuration
// Model is configurable via .env (currently: inclusionai/ling-3.0-flash — paid tier).
// No max_tokens cap and no reasoning override — the model manages its own output.
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'inclusionai/ling-3.0-flash';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export async function generateFix(issue, sourceCode, filePath) {
  if (!OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY not configured — add it to backend/.env');
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
${sourceCode}

Requirements:
1. Generate ONLY the minimal change needed to fix this specific violation.
2. Do NOT invent new accessibility issues or WCAG classifications.
3. Return ONLY the complete corrected file content.
4. Do NOT add explanations or comments about the fix — EXCEPT the required traceability comment below.
5. Preserve all existing functionality and styling.
6. MANDATORY: Immediately next to the code you changed, add a short comment in the file's native comment syntax (// for JS/TS/JSX, <!-- --> for HTML, {/* */} for JSX inside markup, # for Python/YAML) with EXACTLY this format:
   a11yfix: ${issue.issueId} (${issue.ruleId})
   Example for a TSX file:
   {/* a11yfix: ${issue.issueId} (${issue.ruleId}) */}
   This comment is required for traceability — never omit it.

Return the complete corrected source code. Do not wrap in markdown code blocks.`;

  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'A11yFix'
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [
        { role: 'user', content: prompt }
      ],
      temperature: 0.1
      // No max_tokens limit — let the model use its full output budget.
      // No reasoning param — let the model decide how to work.
    })
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(`OpenRouter API error: ${response.status} ${response.statusText} ${errBody.slice(0, 300)}`);
  }

  const data = await response.json();
  const choice = data.choices?.[0];
  const generatedText = choice?.message?.content;

  if (!generatedText || generatedText.trim().length === 0) {
    // Surface why the model returned nothing (finish_reason, length cutoffs, etc.)
    const finish = choice?.finish_reason || 'unknown';
    const usage = JSON.stringify(data.usage || {});
    const raw = JSON.stringify(data).slice(0, 400);
    throw new Error(`No response generated from OpenRouter API (finish_reason: ${finish}, usage: ${usage}, body: ${raw})`);
  }

  // Strip markdown code fences if the model wrapped the file in them
  const cleaned = generatedText
    .replace(/^```[a-zA-Z]*\n/, '')
    .replace(/\n```$/, '')
    .trim();

  return {
    summary: `Fix for ${issue.ruleId}: ${issue.description}`,
    filePath,
    newContent: cleaned,
    ruleId: issue.ruleId
  };
}
