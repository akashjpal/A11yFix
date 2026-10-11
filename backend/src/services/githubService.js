import { Octokit } from '@octokit/rest';
import dotenv from 'dotenv';

dotenv.config();

export async function createPullRequest({
  owner,
  repo,
  headBranch,
  baseBranch = 'main',
  title,
  body
}) {
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

  const response = await octokit.pulls.create({
    owner,
    repo,
    head: headBranch,
    base: baseBranch,
    title,
    body
  });

  return {
    prUrl: response.data.html_url,
    prNumber: response.data.number,
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
