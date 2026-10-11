import dotenv from 'dotenv';
import { writeFileSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';

dotenv.config();

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'inclusionai/ling-3.0-flash';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Generate Playwright test cases for the functionality touched by a fix.
 *
 * The AI receives:
 *  - the ORIGINAL file content (pre-fix)
 *  - the FIXED file content (post-fix)
 * and must identify the changed section, then write tests that verify the
 * behavior/semantics of that section (not the accessibility rule itself —
 * axe already covers that).
 */
export async function generateTests(issue, originalCode, fixedCode, filePath, appUrl, routes) {
  if (!OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY not configured');
  }

  const prompt = `You are a QA engineer. Two versions of a source file are given — BEFORE and AFTER an accessibility fix. Identify what changed, and generate Playwright test cases that verify the FUNCTIONALITY of the changed section still works (and, where relevant, that the accessibility semantics are correct).

Issue that was fixed:
- Rule: ${issue.ruleId}
- Description: ${issue.description}
- Affected HTML: ${issue.htmlSnippet}
- Page: ${issue.page}

App under test:
- Base URL: ${appUrl}
- Routes: ${routes.join(', ')}
- Framework: React + Vite (Playwright can use standard locators)

File changed: ${filePath}

=== BEFORE (original) ===
${originalCode}

=== AFTER (fixed) ===
${fixedCode}

Requirements:
1. First, in a short comment, state WHAT SECTION changed (element + attribute/prop).
2. Generate a COMPLETE, runnable Playwright test file using @playwright/test.
3. Tests must verify the changed section's functionality: e.g. if an alt attribute was added, assert the img is visible AND has non-empty alt; if contrast CSS changed, assert the element still renders with expected text.
4. Include at least one test that the page loads without errors.
5. Use the base URL via test.use({ baseURL: ... }) so tests are portable.
6. Output ONLY the test file content — no markdown fences, no explanations outside the file's own comments.`;

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
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1
    })
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(`OpenRouter API error: ${response.status} ${errBody.slice(0, 300)}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content || !content.trim()) {
    throw new Error(`No test content generated (finish_reason: ${data.choices?.[0]?.finish_reason})`);
  }

  // Strip markdown fences if present
  const cleaned = content
    .replace(/^```[a-zA-Z]*\n/, '')
    .replace(/\n```$/, '')
    .trim();

  return cleaned;
}

/**
 * Write the generated test file into the cloned repo and return its path.
 * Tests live under <repoPath>/a11yfix-tests/ so they never collide with the
 * project's own tests.
 */
export function writeTestFile(repoPath, fixId, testCode) {
  const dir = join(repoPath, 'a11yfix-tests');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${fixId}.spec.js`);
  writeFileSync(file, testCode, 'utf-8');
  return file;
}

/**
 * Run the generated tests with Playwright's test runner.
 * The target repo needs @playwright/test available — we run it from OUR
 * node_modules via NODE_PATH so the cloned repo doesn't need its own install.
 */
export async function runTests(repoPath, testFile, appUrl) {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);

  const backendNodeModules = join(process.cwd(), 'node_modules');

  try {
    const { stdout, stderr } = await execAsync(
      `npx playwright test "${testFile}" --reporter=list --config=-`,
      {
        cwd: repoPath,
        timeout: 120000,
        maxBuffer: 1024 * 1024 * 10,
        env: {
          ...process.env,
          NODE_PATH: backendNodeModules,
          PLAYWRIGHT_BASE_URL: appUrl
        },
        // playwright test --config=- reads a config from stdin
        input: JSON.stringify({
          testDir: '.',
          timeout: 30000,
          use: {
            baseURL: appUrl,
            headless: true,
            viewport: { width: 1280, height: 720 }
          },
          projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
          reporter: [['list']]
        })
      }
    );
    return { success: true, stdout, stderr };
  } catch (err) {
    // Non-zero exit = test failures; still return the output
    return { success: false, stdout: err.stdout || '', stderr: err.stderr || err.message };
  }
}
