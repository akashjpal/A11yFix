import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { dirname, join } from 'path';

export function validatePatch(fix) {
  const errors = [];

  // Check that newContent exists and is non-empty
  if (!fix.newContent || fix.newContent.trim().length === 0) {
    errors.push('Generated patch is empty');
  }

  // Check that filePath exists in the repo
  try {
    const fullPath = join(fix.repoPath, fix.filePath);
    readFileSync(fullPath, 'utf-8');
  } catch {
    errors.push(`Target file ${fix.filePath} not found in repository`);
  }

  // Basic syntax validation: check for balanced braces in JS/JSX
  if (fix.filePath.endsWith('.js') || fix.filePath.endsWith('.jsx') || fix.filePath.endsWith('.tsx')) {
    const content = fix.newContent;
    const openBraces = (content.match(/\{/g) || []).length;
    const closeBraces = (content.match(/\}/g) || []).length;
    if (openBraces !== closeBraces) {
      errors.push('Unbalanced braces in generated code');
    }
    const openParens = (content.match(/\(/g) || []).length;
    const closeParens = (content.match(/\)/g) || []).length;
    if (openParens !== closeParens) {
      errors.push('Unbalanced parentheses in generated code');
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export async function applyPatch(fix) {
  const fullPath = join(fix.repoPath, fix.filePath);
  writeFileSync(fullPath, fix.newContent, 'utf-8');
  return { applied: true, path: fullPath };
}
