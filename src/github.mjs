/** GitHub API access with your token (GITHUB_TOKEN, GH_TOKEN, or the one from `gh`). */
import { execFileSync } from 'node:child_process';

export const BRANCH = 'pauline/consignes';

export function token() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  try {
    return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    throw new Error('Aucun jeton GitHub : connectez-vous avec « gh auth login », ou définissez GITHUB_TOKEN.');
  }
}

export function client(authToken = token(), apiBase = process.env.PAULINE_API_BASE || 'https://api.github.com') {
  async function call(method, path, body) {
    const response = await fetch(apiBase + path, {
      method,
      headers: {
        Authorization: `Bearer ${authToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'pauline',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    return { status: response.status, data: text ? JSON.parse(text) : null };
  }
  const checked = (result, what) => {
    if (result.status >= 300) {
      const detail = result.data && result.data.message ? `, ${result.data.message}` : '';
      throw new Error(`${what} : refusé par GitHub (${result.status}${detail})`);
    }
    return result.data;
  };
  const encodePath = (path) => path.split('/').map(encodeURIComponent).join('/');

  return {
    async currentUser() {
      return checked(await call('GET', '/user'), 'Jeton').login;
    },
    async repositories(owner) {
      const allRepositories = [];
      for (let page = 1; ; page++) {
        const batch = checked(await call('GET', `/user/repos?per_page=100&page=${page}&affiliation=owner`), 'Liste des dépôts');
        allRepositories.push(...batch);
        if (batch.length < 100) break;
      }
      return allRepositories.filter((repo) => repo.owner.login.toLowerCase() === owner.toLowerCase());
    },
    async repository(fullName) {
      return checked(await call('GET', `/repos/${fullName}`), `Dépôt ${fullName}`);
    },
    /** A file's text and sha, or null when it does not exist. */
    async file(fullName, path, ref) {
      const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';
      const result = await call('GET', `/repos/${fullName}/contents/${encodePath(path)}${query}`);
      if (result.status === 404) return null;
      const data = checked(result, `Lecture de ${path}`);
      return { text: Buffer.from(data.content, 'base64').toString('utf8'), sha: data.sha };
    },
    /** Resets the working branch onto the head of the default branch. */
    async prepareBranch(fullName, defaultBranch) {
      const headRef = checked(await call('GET', `/repos/${fullName}/git/ref/heads/${encodePath(defaultBranch)}`), 'Branche principale');
      const headSha = headRef.object.sha;
      const created = await call('POST', `/repos/${fullName}/git/refs`, { ref: `refs/heads/${BRANCH}`, sha: headSha });
      if (created.status === 422) {
        checked(await call('PATCH', `/repos/${fullName}/git/refs/heads/${encodePath(BRANCH)}`, { sha: headSha, force: true }), 'Branche de travail');
      } else {
        checked(created, 'Branche de travail');
      }
    },
    async write(fullName, path, text, message) {
      const existing = await this.file(fullName, path, BRANCH);
      const body = { message, content: Buffer.from(text, 'utf8').toString('base64'), branch: BRANCH, ...(existing ? { sha: existing.sha } : {}) };
      checked(await call('PUT', `/repos/${fullName}/contents/${encodePath(path)}`, body), `Écriture de ${path}`);
    },
    /** Opens the pull request, or reuses the one already open. Returns its URL. */
    async pullRequest(fullName, owner, defaultBranch, title, body) {
      const head = encodeURIComponent(`${owner}:${BRANCH}`);
      const open = checked(await call('GET', `/repos/${fullName}/pulls?state=open&head=${head}`), 'PR ouvertes');
      if (open.length) {
        checked(await call('PATCH', `/repos/${fullName}/pulls/${open[0].number}`, { title, body }), 'Mise à jour de la PR');
        return open[0].html_url;
      }
      const created = await call('POST', `/repos/${fullName}/pulls`, { title, head: BRANCH, base: defaultBranch, body });
      return checked(created, 'Ouverture de la PR').html_url;
    },
  };
}
