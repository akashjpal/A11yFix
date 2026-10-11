import simpleGit from 'simple-git';
import { join } from 'path';
import dotenv from 'dotenv';

dotenv.config();

export async function createBranch(repoPath, branchName) {
  const git = simpleGit(repoPath);
  await git.checkoutLocalBranch(branchName);
  return branchName;
}

/**
 * Commit and push. Handles two modes:
 *  - fork === null → push to `origin` (requires push access to upstream)
 *  - fork set      → push to the bot's fork via a dedicated remote, using the
 *    bot token in the URL so auth never depends on the local credential manager
 */
export async function commitAndPush(repoPath, branchName, message, fork = null) {
  const git = simpleGit(repoPath);

  await git.add('.');
  const status = await git.status();
  if (status.staged.length > 0 || status.files.length > 0) {
    await git.commit(message);
  } else {
    console.log('[gitService] Nothing to commit — changes already committed');
  }

  if (fork) {
    const remoteName = 'a11yfix-fork';
    const remoteUrl = `https://x-access-token:${process.env.GITHUB_TOKEN}@github.com/${fork.forkOwner}/${fork.forkRepo}.git`;
    const remotes = await git.getRemotes();
    const existing = remotes.find(r => r.name === remoteName);
    if (existing) {
      // Keep the URL fresh in case the token rotated
      await git.remote(['set-url', remoteName, remoteUrl]);
    } else {
      await git.addRemote(remoteName, remoteUrl);
    }
    // Force-push: fix branches are disposable and may already exist on the
    // fork from a previous run with different commits (non-fast-forward)
    await git.push(remoteName, branchName, ['--force', '--set-upstream']);
    console.log(`[gitService] Force-pushed ${branchName} to fork ${fork.forkOwner}/${fork.forkRepo}`);
  } else {
    await git.push('origin', branchName);
    console.log(`[gitService] Pushed ${branchName} to origin`);
  }

  return { branch: branchName, committed: true };
}

export async function getOrCreateFixBranch(repoPath, issueId, ruleId) {
  const branchName = `a11yfix/${ruleId}-${issueId}`;
  const git = simpleGit(repoPath);

  // Check if branch already exists
  const branches = await git.branch();
  if (!branches.all.includes(branchName)) {
    await git.checkoutLocalBranch(branchName);
  } else {
    await git.checkout(branchName);
  }

  return branchName;
}
