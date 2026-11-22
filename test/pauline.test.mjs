import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { block, state, merge, claudeFile, extract, fingerprint } from '../src/block.mjs';

const BINARY = fileURLToPath(new URL('../bin/pauline.mjs', import.meta.url));
const BASE = '## Langue\n\nTout en français.';
const OTHER_BASE = '## Langue\n\nTout en français, sans exception.';

test('un AGENTS.md neuf : titre, bloc commun, place pour le projet', () => {
  const created = merge(null, BASE, 'demo');
  assert.match(created, /^# demo\n\n<!-- pauline:debut empreinte=[0-9a-f]{12} -->/);
  assert.match(created, /## Consignes de ce projet/);
  assert.equal(state(created, BASE), 'up-to-date');
});

test('un AGENTS.md existant : bloc inséré sous le titre, le reste intact', () => {
  const existing = '# Mon projet\n\nNe touchez pas au dossier legacy.\n';
  const updated = merge(existing, BASE, 'demo');
  assert.ok(updated.startsWith('# Mon projet\n\n<!-- pauline:debut'));
  assert.ok(updated.endsWith('Ne touchez pas au dossier legacy.\n'));
  assert.equal(state(existing, BASE), 'no-block');
  assert.equal(state(updated, BASE), 'up-to-date');
});

test('mise à jour : seul le bloc change, et deux passages donnent le même texte', () => {
  const first = merge('# Projet\n\nPropre au projet.\n', BASE, 'demo');
  assert.equal(state(first, OTHER_BASE), 'outdated');
  const second = merge(first, OTHER_BASE, 'demo');
  assert.match(second, /sans exception/);
  assert.match(second, /Propre au projet\./);
  assert.equal(merge(second, OTHER_BASE, 'demo'), second);
});

test('bloc modifié à la main : repéré, pas confondu avec une base dépassée', () => {
  const edited = merge(null, BASE, 'demo').replace('Tout en français.', 'Tout en anglais.');
  assert.equal(state(edited, BASE), 'edited');
  assert.equal(state(edited, OTHER_BASE), 'edited');
});

test('fins de ligne Windows : même empreinte, toujours à jour', () => {
  assert.equal(fingerprint(BASE.replace(/\n/g, '\r\n')), fingerprint(BASE));
  assert.equal(state(merge(null, BASE, 'demo').replace(/\n/g, '\r\n'), BASE), 'up-to-date');
  assert.ok(extract(block(BASE)));
});

test('CLAUDE.md importe AGENTS.md une seule fois, sans perdre son contenu', () => {
  assert.equal(claudeFile(null), '@AGENTS.md\n');
  assert.equal(claudeFile('Utilise pnpm.\n'), '@AGENTS.md\n\nUtilise pnpm.\n');
  assert.equal(claudeFile('@AGENTS.md\n\nUtilise pnpm.\n'), '@AGENTS.md\n\nUtilise pnpm.\n');
});

const runCli = (args, { apiBase } = {}) => new Promise((resolve) => {
  const child = spawn(process.execPath, [BINARY, ...args], { env: { ...process.env, ...(apiBase ? { PAULINE_API_BASE: apiBase } : {}), GITHUB_TOKEN: 'faux' } });
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));
  child.on('close', (code) => resolve({ code, output }));
});

test('local : crée, garde le contenu du projet, refuse un bloc modifié sans --forcer', async () => {
  const folder = join(mkdtempSync(join(tmpdir(), 'pauline-')), 'projet');
  mkdirSync(folder);
  const agentsPath = join(folder, 'AGENTS.md');
  const basePath = join(folder, 'base.md');
  writeFileSync(join(folder, 'CLAUDE.md'), 'Utilise pnpm.\n');
  writeFileSync(basePath, BASE);
  let result = await runCli(['local', folder, '--base', basePath]);
  assert.equal(result.code, 0, result.output);
  assert.match(readFileSync(agentsPath, 'utf8'), /^# projet\n/);
  assert.equal(readFileSync(join(folder, 'CLAUDE.md'), 'utf8'), '@AGENTS.md\n\nUtilise pnpm.\n');
  assert.match((await runCli(['local', folder, '--base', basePath])).output, /Déjà à jour/);
  writeFileSync(agentsPath, readFileSync(agentsPath, 'utf8').replace('français', 'anglais'));
  result = await runCli(['local', folder, '--base', basePath]);
  assert.equal(result.code, 1);
  assert.match(result.output, /modifié à la main/);
  assert.equal((await runCli(['local', folder, '--base', basePath, '--forcer'])).code, 0);
  assert.match(readFileSync(agentsPath, 'utf8'), /Tout en français\./);
});

/** Fake GitHub API: three repositories (new, up to date, edited by hand); records every write. */
function fakeApi(baseText) {
  const repository = (name) => ({ name, full_name: `moi/${name}`, owner: { login: 'moi' }, visibility: 'public', archived: false, fork: false, default_branch: 'main' });
  const repositories = { neuf: repository('neuf'), propre: repository('propre'), bricole: repository('bricole') };
  const files = {
    'propre/AGENTS.md': merge(null, baseText, 'propre'),
    'propre/CLAUDE.md': '@AGENTS.md\n',
    'bricole/AGENTS.md': merge(null, baseText, 'bricole').replace('français', 'anglais'),
    'neuf/CLAUDE.md': 'Utilise pnpm.\n',
  };
  const writes = [];
  const server = createServer((request, response) => {
    let rawBody = '';
    request.on('data', (chunk) => (rawBody += chunk));
    request.on('end', () => {
      const send = (status, data) => {
        response.writeHead(status, { 'Content-Type': 'application/json' });
        response.end(data === undefined ? '' : JSON.stringify(data));
      };
      const [path, query = ''] = request.url.split('?');
      const body = rawBody ? JSON.parse(rawBody) : {};
      let match;
      if (path === '/user') return send(200, { login: 'moi' });
      if (path === '/user/repos') return send(200, Object.values(repositories));
      if ((match = /^\/repos\/moi\/([^/]+)$/.exec(path))) return send(200, repositories[match[1]]);
      if ((match = /^\/repos\/moi\/([^/]+)\/contents\/(.+)$/.exec(path))) {
        const fileKey = `${match[1]}/${decodeURIComponent(match[2])}`;
        if (request.method === 'PUT') {
          writes.push(`PUT ${fileKey} sur ${body.branch}`);
          files[`${fileKey}@${body.branch}`] = Buffer.from(body.content, 'base64').toString('utf8');
          return send(200, {});
        }
        const branch = new URLSearchParams(query).get('ref');
        const text = branch ? files[`${fileKey}@${branch}`] : files[fileKey];
        if (text === undefined) return send(404, { message: 'Not Found' });
        return send(200, { content: Buffer.from(text).toString('base64'), sha: 'abc' });
      }
      if (/^\/repos\/moi\/[^/]+\/git\/ref\/heads\/main$/.test(path)) return send(200, { object: { sha: 'head' } });
      if ((match = /^\/repos\/moi\/([^/]+)\/git\/refs$/.exec(path))) {
        writes.push(`branche ${match[1]} ${body.ref}`);
        return send(201, {});
      }
      if ((match = /^\/repos\/moi\/([^/]+)\/pulls$/.exec(path))) {
        if (request.method === 'GET') return send(200, []);
        writes.push(`PR ${match[1]} ${body.title}`);
        return send(201, { html_url: `https://github.com/moi/${match[1]}/pull/1` });
      }
      return send(404, { message: 'inconnu' });
    });
  });
  return new Promise((resolve) => server.listen(0, () => resolve({ server, apiBase: `http://127.0.0.1:${server.address().port}`, writes, files })));
}

test('verifier ne change rien ; appliquer ouvre une PR, sauf pour un bloc modifié à la main', async () => {
  const basePath = join(mkdtempSync(join(tmpdir(), 'pauline-')), 'base.md');
  writeFileSync(basePath, BASE);
  const { server, apiBase, writes, files } = await fakeApi(BASE);
  try {
    const check = await runCli(['verifier', '--base', basePath], { apiBase });
    assert.equal(check.code, 1);
    assert.match(check.output, /⚠ bricole\s+bloc modifié à la main/);
    assert.match(check.output, /✗ neuf\s+pas d’AGENTS\.md · CLAUDE\.md n’importe pas AGENTS\.md/);
    assert.match(check.output, /✓ propre\s+à jour/);
    assert.deepEqual(writes, [], 'verifier n’écrit rien');
    assert.match((await runCli(['appliquer', '--base', basePath], { apiBase })).output, /ajoutez --oui/);
    assert.deepEqual(writes, []);
    const apply = await runCli(['appliquer', '--base', basePath, '--oui'], { apiBase });
    assert.equal(apply.code, 0, apply.output);
    assert.deepEqual(writes, [
      'branche neuf refs/heads/pauline/consignes',
      'PUT neuf/AGENTS.md sur pauline/consignes',
      'PUT neuf/CLAUDE.md sur pauline/consignes',
      `PR neuf docs: 🧾 consignes communes (Pauline ${fingerprint(BASE)})`,
    ]);
    assert.equal(files['neuf/CLAUDE.md@pauline/consignes'], '@AGENTS.md\n\nUtilise pnpm.\n');
    assert.equal(state(files['neuf/AGENTS.md@pauline/consignes'], BASE), 'up-to-date');
    writes.length = 0;
    await runCli(['appliquer', '--base', basePath, '--oui', '--sauf', 'neuf'], { apiBase });
    assert.deepEqual(writes, [], '--sauf laisse le dépôt de côté');
  } finally {
    server.close();
  }
});

test('profil appli-web : trois règles de plus, avant « En cas de doute » ; profil inconnu refusé', async () => {
  const plain = (await runCli(['base'])).output;
  const webBase = (await runCli(['base', '--profil', 'appli-web'])).output;
  assert.doesNotMatch(plain, /### Application web/);
  assert.match(webBase, /### Application web\n- Les requêtes SQL sont paramétrées[\s\S]*argon2 ou bcrypt[\s\S]*validées côté serveur[\s\S]*\n\n### En cas de doute/);
  assert.notEqual(webBase.split('\n')[0], plain.split('\n')[0], 'empreinte différente');
  const unknown = await runCli(['base', '--profil', 'mobile']);
  assert.equal(unknown.code, 1);
  assert.match(unknown.output, /Profil inconnu : mobile/);
});
