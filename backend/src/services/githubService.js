import { Octokit } from '@octokit/rest';
import dotenv from 'dotenv';

dotenv.config();

function octo() {
  return new Octokit({ auth: process.env.GITHUB_TOKEN });
}

// Authenticated user (the bot account)
export async function getAuthenticatedUser() {
  const { data } = await octo().users.getAuthenticated();
  return data.login;
}

// Fetch the repo's actual default branch (main / master / etc.)
export async function getDefaultBranch(owner, repo) {
  const { data } = await octo().repos.get({ owner, repo });
  return data.default_branch;
}

// Check if the token has push access to the upstream repo
export async function hasPushAccess(owner, repo) {
  const { data } = await octo().repos.get({ owner, repo });
  return Boolean(data.permissions?.push);
}

// Fork the upstream repo under the bot account (idempotent — returns existing fork)
export async function ensureFork(owner, repo) {
  const octokit = octo();
  const botLogin = await getAuthenticatedUser();

  // Check if the fork already exists
  try {
    const { data } = await octokit.repos.get({ owner: botLogin, repo });
    if (data.fork && data.parent.full_name === `${owner}/${repo}`) {
      console.log(`[githubService] Fork already exists: ${botLogin}/${repo}`);
      return { forkOwner: botLogin, forkRepo: repo, created: false };
    }
  } catch (e) {
    if (e.status !== 404) throw e;
  }

  // Create the fork (async on GitHub's side — may take a few seconds)
  const { data } = await octokit.repos.createFork({ owner, repo });
  console.log(`[githubService] Fork created: ${data.full_name} (may take a moment to be ready)`);
  return { forkOwner: botLogin, forkRepo: repo, created: true };
}

// Wait until the fork is ready (GitHub forks are created asynchronously)
export async function waitForFork(owner, repo, maxAttempts = 10) {
  const octokit = octo();
  const botLogin = await getAuthenticatedUser();
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await octokit.repos.get({ owner: botLogin, repo });
      console.log(`[githubService] Fork ready: ${botLogin}/${repo}`);
      return true;
    } catch (e) {
      if (e.status !== 404) throw e;
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  throw new Error(`Fork ${botLogin}/${repo} not ready after ${maxAttempts} attempts`);
}

/**
 * Create a PR. Handles both cases:
 *  - Token has push access → head is `branchName` on the same repo
 *  - Token is read-only    → head is `botLogin:branchName` from the bot's fork
 */
export async function createPullRequest({
  owner,
  repo,
  headBranch,
  baseBranch,
  title,
  body
}) {
  const octokit = octo();

  const base = baseBranch || await getDefaultBranch(owner, repo);
  const canPush = await hasPushAccess(owner, repo);

  let head = headBranch;

  if (!canPush) {
    // Fork-based flow: fork the repo, wait for it, PR head = `bot:branch`
    console.log(`[githubService] No push access to ${owner}/${repo} — using fork flow`);
    const { forkOwner } = await ensureFork(owner, repo);
    await waitForFork(owner, repo);
    head = `${forkOwner}:${headBranch}`;
  }

  let response;
  try {
    response = await octokit.pulls.create({
      owner,       // PR is opened against the UPSTREAM repo
      repo,
      head,        // `bot:branch` syntax pulls from the fork
      base,
      title,
      body
    });
  } catch (e) {
    // Retry after a force-push: a PR may already exist for this head branch
    if (e.status === 422 && /already exists/i.test(e.message)) {
      const existing = await octo().pulls.list({ owner, repo, head, base, state: 'open' });
      if (existing.data.length > 0) {
        const pr = existing.data[0];
        console.log(`[githubService] PR already exists: ${pr.html_url}`);
        return {
          prUrl: pr.html_url,
          prNumber: pr.number,
          baseBranch: base,
          headBranch: head,
          forkBased: !canPush,
          status: 'existing'
        };
      }
    }
    throw e;
  }

  return {
    prUrl: response.data.html_url,
    prNumber: response.data.number,
    baseBranch: base,
    headBranch: head,
    forkBased: !canPush,
    status: 'created'
  };
}

export async function verifyPrExists(owner, repo, headBranch) {
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  const { data } = await octokit.pulls.list({
    owner,
    repo,
    head: `${owner}:${headBranch}`
  });
  return data.length > 0;
}
