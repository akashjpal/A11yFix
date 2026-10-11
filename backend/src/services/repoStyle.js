import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * Repo coding-practice analyzer.
 *
 * Extracts the repo's conventions (framework, formatting, component style,
 * CSS approach) so the AI fix generator can produce patches that match the
 * codebase instead of inventing its own style.
 *
 * Purely heuristic — no AI call, deterministic, fast. The result is a compact
 * "style guide" string injected into the fix prompt.
 */

const SOURCE_EXTS = ['.tsx', '.jsx', '.ts', '.js', '.mjs', '.vue', '.svelte'];
const SKIP_DIRS = ['node_modules', 'dist', 'build', '.git', 'coverage', '.next', 'out', 'a11yfix-tests'];
const MAX_SAMPLE_FILES = 8;
const MAX_FILE_BYTES = 120 * 1024; // skip huge generated files

function collectSourceFiles(repoPath) {
  const files = [];
  (function walk(dir, depth) {
    if (depth > 6) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.includes(entry.name) && !entry.name.startsWith('.')) {
          walk(join(dir, entry.name), depth + 1);
        }
      } else if (SOURCE_EXTS.some(ext => entry.name.endsWith(ext))) {
        files.push(join(dir, entry.name));
      }
    }
  })(repoPath, 0);
  return files;
}

function detectFramework(pkg) {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const has = name => Boolean(deps[name]);
  const stack = [];
  if (has('react')) stack.push('React');
  if (has('vue')) stack.push('Vue');
  if (has('svelte')) stack.push('Svelte');
  if (has('next')) stack.push('Next.js');
  if (has('vite')) stack.push('Vite');
  if (has('typescript') || has('@types/react')) stack.push('TypeScript');
  if (has('tailwindcss')) stack.push('Tailwind CSS');
  if (has('styled-components') || has('@emotion/react') || has('@emotion/styled')) stack.push('CSS-in-JS');
  if (has('sass') || has('node-sass')) stack.push('Sass');
  if (has('react-router') || has('react-router-dom')) stack.push('React Router');
  if (has('@mui/material')) stack.push('MUI');
  return stack;
}

/** Analyze a single file's formatting signals. */
function analyzeFile(content) {
  const signals = { indent2: 0, indent4: 0, tab: 0, singleQuotes: 0, doubleQuotes: 0, semicolons: 0, noSemicolons: 0, arrowComponents: 0, functionComponents: 0, tailwindish: 0, cssModules: 0 };

  const lines = content.split('\n');
  for (const line of lines) {
    const m = line.match(/^(\s+)\S/);
    if (m) {
      const ws = m[1];
      if (ws.startsWith('\t')) signals.tab++;
      else if (ws.length % 4 === 0 && ws.length % 2 === 0) { signals.indent4 += ws.length / 4 > 1 ? 1 : 0; signals.indent2++; }
      else if (ws.length % 2 === 0) signals.indent2++;
      else signals.indent4++;
    }
  }

  // Quote preference in code (rough: count ' vs " outside of obvious JSX text)
  signals.singleQuotes = (content.match(/'/g) || []).length;
  signals.doubleQuotes = (content.match(/"/g) || []).length;

  // Semicolon usage: lines ending in a code char
  const codeEnd = content.match(/^\s*.*[a-zA-Z\)\]\}'"]\s*$/gm) || [];
  signals.semicolons = (content.match(/;\s*$/gm) || []).length;
  signals.noSemicolons = Math.max(0, codeEnd.length - signals.semicolons);

  // Component style
  signals.arrowComponents = (content.match(/const\s+[A-Z][A-Za-z0-9]*\s*=\s*(\(|\(|async)/g) || []).length;
  signals.functionComponents = (content.match(/function\s+[A-Z][A-Za-z0-9]*\s*\(/g) || []).length;

  // CSS approach hints
  signals.tailwindish = (content.match(/className="[^"]*\b(flex|grid|p-\d|m-\d|text-\w+|bg-\w+|w-\d+|h-\d+|rounded|border)\b/g) || []).length;
  signals.cssModules = (content.match(/className=\{?(styles|classes)\./g) || []).length;

  return signals;
}

function mergeSignals(acc, s) {
  for (const k of Object.keys(s)) acc[k] = (acc[k] || 0) + s[k];
}

function buildStyleGuide(pkg, framework, signals, fileCount, tsDetected) {
  const lines = [];

  lines.push(`Stack: ${framework.length ? framework.join(', ') : 'unknown (no framework markers found)'}`);

  // Indentation
  if (signals.tab > signals.indent2 + signals.indent4) lines.push('Indentation: tabs');
  else if (signals.indent4 > signals.indent2 * 2) lines.push('Indentation: 4 spaces');
  else lines.push('Indentation: 2 spaces');

  // Quotes
  if (signals.singleQuotes > signals.doubleQuotes * 1.5) lines.push('Quotes: single quotes preferred');
  else if (signals.doubleQuotes > signals.singleQuotes * 1.5) lines.push('Quotes: double quotes preferred (common in JSX attributes)');
  else lines.push('Quotes: mixed — use double quotes in JSX attributes, match surrounding code elsewhere');

  // Semicolons
  if (signals.semicolons > signals.noSemicolons) lines.push('Semicolons: yes');
  else lines.push('Semicolons: no (omit trailing semicolons)');

  // Component style
  if (signals.arrowComponents > signals.functionComponents) lines.push('Components: arrow-function components (const X = () => ...)');
  else if (signals.functionComponents > 0) lines.push('Components: function declarations (function X() ...)');

  // CSS approach
  if (signals.tailwindish > 3) lines.push('Styling: Tailwind utility classes in className');
  else if (signals.cssModules > 0) lines.push('Styling: CSS modules (styles.xxx)');
  else lines.push('Styling: match the existing className/style approach in the file');

  if (tsDetected) lines.push('Language: TypeScript — keep types intact, do not remove annotations');
  lines.push(`Sampled ${fileCount} source file(s) for these conventions`);
  lines.push('Follow these conventions EXACTLY so the patch looks native to this repo.');

  return lines.join('\n');
}

/**
 * Analyze the repo and return a compact style-guide string.
 * Never throws — on any failure returns a minimal fallback guide.
 */
export function analyzeRepoStyle(repoPath) {
  try {
    // 1. package.json → framework / tooling
    let pkg = {};
    try {
      pkg = JSON.parse(readFileSync(join(repoPath, 'package.json'), 'utf-8'));
    } catch { /* no package.json — plain HTML site etc. */ }

    const framework = detectFramework(pkg);
    const tsDetected = framework.includes('TypeScript');

    // 2. Sample source files and aggregate formatting signals
    const files = collectSourceFiles(repoPath)
      // prefer src/ files, then root-level
      .sort((a, b) => {
        const aSrc = /[/\\]src[/\\]/.test(a) ? 0 : 1;
        const bSrc = /[/\\]src[/\\]/.test(b) ? 0 : 1;
        return aSrc - bSrc;
      })
      .slice(0, MAX_SAMPLE_FILES);

    const signals = {};
    let sampled = 0;
    for (const f of files) {
      try {
        const content = readFileSync(f, 'utf-8');
        if (!content || content.length > MAX_FILE_BYTES) continue;
        mergeSignals(signals, analyzeFile(content));
        sampled++;
      } catch { /* unreadable file — skip */ }
    }

    if (sampled === 0) {
      return 'Repo conventions could not be detected — use conservative, minimal changes matching the target file itself.';
    }

    return buildStyleGuide(pkg, framework, signals, sampled, tsDetected);
  } catch (err) {
    console.error('[repoStyle] analysis failed:', err.message);
    return 'Repo conventions could not be detected — use conservative, minimal changes matching the target file itself.';
  }
}
