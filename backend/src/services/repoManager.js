import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import { randomBytes } from 'crypto';
import simpleGit from 'simple-git';
import dotenv from 'dotenv';

dotenv.config();

const execAsync = promisify(exec);

export async function validateRepoUrl(url) {
  try {
    const u = new URL(url);
    if (!u.hostname.includes('github.com')) {
      throw new Error('Only GitHub repository URLs are supported');
    }
    const pathParts = u.pathname.split('/').filter(Boolean);
    if (pathParts.length < 2) {
      throw new Error('Invalid GitHub repository URL format');
    }
    return { valid: true, owner: pathParts[0], repo: pathParts[1], url };
  } catch (err) {
    throw new Error(`Invalid repository URL: ${err.message}`);
  }
}

export async function cloneRepo(repoUrl, scanId) {
  const validated = await validateRepoUrl(repoUrl);
  const tmpDir = `tmp/${scanId}`;
  const git = simpleGit();

  // Clean up any existing directory
  const { rmSync } = await import('fs');
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}

  await git.clone(repoUrl, tmpDir);
  return tmpDir;
}

export async function detectFramework(repoPath) {
  const { readFileSync } = await import('fs');
  const pkgPath = `${repoPath}/package.json`;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    const devDeps = pkg.devDependencies || {};
    const deps = pkg.dependencies || {};
    if (deps.vite || devDeps.vite) return 'vite-react';
    if (deps.next) return 'nextjs';
    if (devDeps['@angular/cli']) return 'angular';
    if (deps.react) return 'react';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function installDeps(repoPath) {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);

  const { stdout, stderr } = await execAsync('npm install', {
    cwd: repoPath,
    timeout: 120000,
    maxBuffer: 1024 * 1024 * 10
  });
  return { stdout, stderr };
}

export async function startApp(repoPath, scanId) {
  const framework = await detectFramework(repoPath);
  const port = 5173 + parseInt(scanId.slice(-4), 36) % 1000; // deterministic port

  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);

  let command;
  if (framework === 'vite-react' || framework === 'react') {
    command = 'npm run dev -- --port ' + port;
  } else {
    command = 'npm start';
  }

  // Start the dev server in background (no timeout — it must stay running for the scan)
  const proc = exec(command, {
    cwd: repoPath,
    env: { ...process.env, PORT: String(port) },
    windowsHide: true
  });
  // Do not let the parent exit kill the child prematurely; keep a handle for cleanup
  proc.unref?.();

  // Wait for server to be ready
  const appUrl = `http://localhost:${port}`;
  await waitForServer(appUrl, 60000);

  return { url: appUrl, port, framework, process: proc };
}

async function waitForServer(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const resp = await fetch(url);
      if (resp.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`Server at ${url} did not start within ${timeoutMs}ms`);
}

export async function stopApp(scanId) {
  // Cleanup logic — placeholder for now
  console.log(`Stopping app for scan ${scanId}`);
}

/**
 * Kill a dev-server process tree. On Windows, proc.kill() only kills the
 * shell (cmd.exe) — npm/node children survive. taskkill /T kills the tree.
 */
export function killProcessTree(proc) {
  if (!proc || proc.killed || proc.exitCode !== null) return;
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /pid ${proc.pid} /T /F`, { stdio: 'ignore' });
    } else {
      proc.kill('SIGTERM');
    }
    console.log(`[repoManager] Killed app process tree (pid ${proc.pid})`);
  } catch (e) {
    // Process may have already exited
    try { proc.kill('SIGKILL'); } catch {}
  }
}

/**
 * Restart the app AFTER a fix is applied so verification tests the NEW code.
 * Vite dev servers serve stale modules until restarted, so the old process
 * must be killed and a fresh one started — on a NEW port (the old port may
 * linger in TIME_WAIT). Reuses startApp with a modified scanId suffix, which
 * deterministically maps to a different port.
 */
export async function restartApp(repoPath, scanId, oldProc) {
  console.log(`[repoManager] Restarting app for scan ${scanId} (post-fix verification)`);
  killProcessTree(oldProc);
  // Give the OS a moment to release the old port
  await new Promise(r => setTimeout(r, 2000));
  const app = await startApp(repoPath, `${scanId}restart`);
  console.log(`[repoManager] App restarted at ${app.url}`);
  return app;
}
