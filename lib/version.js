// Which build is running, for the footer.
//
// A reader reporting a problem, or the operator checking whether a push has
// gone out yet, needs to know which commit the page in front of them came from.
// Render sets RENDER_GIT_COMMIT, RENDER_GIT_BRANCH and RENDER_GIT_REPO_SLUG on
// every deploy, so on Render the answer is read from the environment. Anywhere
// else — a laptop, the test suites — it is read from .git directly, without
// shelling out to git, which may not be installed where this runs.
//
// Everything here is public already: the repository is public, and a commit
// hash names a version of the code, not anything about a reader.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DEFAULT_REPO = 'jaredsia-svg/psycheAI';
const STARTED_AT = new Date().toISOString();

// HEAD, followed to the commit it names. Loose refs first, then packed-refs,
// which is where a ref lives after `git gc` or a fresh clone. Never throws: a
// missing or odd .git means "unknown", not a server that will not start.
function fromGit(root) {
  try {
    const gitDir = path.join(root, '.git');
    const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
    const ref = /^ref: (.+)$/.exec(head);
    if (!ref) return { commit: head, branch: '' };
    const name = ref[1];
    const branch = name.replace(/^refs\/heads\//, '');
    try {
      return { commit: fs.readFileSync(path.join(gitDir, name), 'utf8').trim(), branch };
    } catch (error) {
      const packed = fs.readFileSync(path.join(gitDir, 'packed-refs'), 'utf8');
      const line = packed.split('\n').find(l => l.endsWith(' ' + name));
      return { commit: line ? line.split(' ')[0] : '', branch };
    }
  } catch (error) {
    return { commit: '', branch: '' };
  }
}

/**
 * The running build, as the status route serves it.
 *
 * Every value is checked before it is passed on, because the footer turns two
 * of them into a link: a commit that is not a hash, or a repository slug that
 * is not `owner/name`, is dropped rather than written into an href.
 */
function describe(env, root) {
  const vars = env || process.env;
  const git = fromGit(root || ROOT);
  let version = '';
  try {
    version = String(JSON.parse(fs.readFileSync(path.join(root || ROOT, 'package.json'), 'utf8')).version || '');
  } catch (error) { /* left blank */ }
  const rawCommit = String(vars.RENDER_GIT_COMMIT || vars.GIT_COMMIT || git.commit || '').trim();
  const commit = /^[0-9a-f]{7,40}$/i.test(rawCommit) ? rawCommit.toLowerCase() : '';
  const rawBranch = String(vars.RENDER_GIT_BRANCH || git.branch || '').trim();
  const branch = /^[\w./-]{1,120}$/.test(rawBranch) ? rawBranch : '';
  const rawRepo = String(vars.RENDER_GIT_REPO_SLUG || DEFAULT_REPO).trim();
  const repo = /^[\w.-]+\/[\w.-]+$/.test(rawRepo) ? rawRepo : DEFAULT_REPO;
  return {
    version: /^[\w.+-]{1,40}$/.test(version) ? version : '',
    commit,
    shortCommit: commit.slice(0, 7),
    branch,
    // When this process started. On Render that is the deploy, or the most
    // recent restart of it; either way it is when this build began serving.
    startedAt: STARTED_AT,
    url: commit ? 'https://github.com/' + repo + '/commit/' + commit : '',
    platform: vars.RENDER ? 'render' : '',
  };
}

module.exports = { describe, fromGit, DEFAULT_REPO };
