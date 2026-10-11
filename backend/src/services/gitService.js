import simpleGit from 'simple-git';
import { join } from 'path';

export async function createBranch(repoPath, branchName) {
  const git = simpleGit(repoPath);
  await git.checkoutLocalBranch(branchName);
  return branchName;
}

export async function commitAndPush(repoPath, branchName, message) {
  const git = simpleGit(repoPath);
  await git.add('.');
  await git.commit(message);
  await git.push('origin', branchName);
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
