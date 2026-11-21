import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bloc, etat, integrer, claude, extraire, empreinte } from '../src/bloc.mjs';

const BIN = fileURLToPath(new URL('../bin/pauline.mjs', import.meta.url));
const BASE = '## Langue\n\nTout en français.';
const AUTRE = '## Langue\n\nTout en français, sans exception.';

test('un AGENTS.md neuf : titre, bloc commun, place pour le projet', () => {
  const t = integrer(null, BASE, 'demo');
  assert.match(t, /^# demo\n\n<!-- pauline:debut empreinte=[0-9a-f]{12} -->/);
  assert.match(t, /## Consignes de ce projet/);
  assert.equal(etat(t, BASE), 'a-jour');
});

test('un AGENTS.md existant : bloc inséré sous le titre, le reste intact', () => {
  const existant = '# Mon projet\n\nNe touchez pas au dossier legacy.\n';
  const t = integrer(existant, BASE, 'x');
  assert.ok(t.startsWith('# Mon projet\n\n<!-- pauline:debut'));
  assert.ok(t.endsWith('Ne touchez pas au dossier legacy.\n'));
  assert.equal(etat(existant, BASE), 'sans-bloc');
  assert.equal(etat(t, BASE), 'a-jour');
});

test('mise à jour : seul le bloc change, et deux passages donnent le même texte', () => {
  const v1 = integrer('# P\n\nPropre au projet.\n', BASE, 'p');
  assert.equal(etat(v1, AUTRE), 'perime');
  const v2 = integrer(v1, AUTRE, 'p');
  assert.match(v2, /sans exception/);
  assert.match(v2, /Propre au projet\./);
  assert.equal(integrer(v2, AUTRE, 'p'), v2);
});

test('bloc modifié à la main : repéré, pas confondu avec une base dépassée', () => {
  const t = integrer(null, BASE, 'p').replace('Tout en français.', 'Tout en anglais.');
  assert.equal(etat(t, BASE), 'modifie');
  assert.equal(etat(t, AUTRE), 'modifie');
});

test('fins de ligne Windows : même empreinte, toujours à jour', () => {
  assert.equal(empreinte(BASE.replace(/\n/g, '\r\n')), empreinte(BASE));
  assert.equal(etat(integrer(null, BASE, 'p').replace(/\n/g, '\r\n'), BASE), 'a-jour');
  assert.ok(extraire(bloc(BASE)));
});

test('CLAUDE.md importe AGENTS.md une seule fois, sans perdre son contenu', () => {
  assert.equal(claude(null), '@AGENTS.md\n');
  assert.equal(claude('Utilise pnpm.\n'), '@AGENTS.md\n\nUtilise pnpm.\n');
  assert.equal(claude('@AGENTS.md\n\nUtilise pnpm.\n'), '@AGENTS.md\n\nUtilise pnpm.\n');
});

const lancer = (args, { base, cwd } = {}) => new Promise((ok) => {
  const p = spawn(process.execPath, [BIN, ...args], { cwd, env: { ...process.env, ...(base ? { PAULINE_API_BASE: base } : {}), GITHUB_TOKEN: 'faux' } });
  let sortie = '';
  p.stdout.on('data', (d) => (sortie += d));
  p.stderr.on('data', (d) => (sortie += d));
  p.on('close', (code) => ok({ code, sortie }));
});

test('local : crée, garde le contenu du projet, refuse un bloc modifié sans --forcer', async () => {
  const d = join(mkdtempSync(join(tmpdir(), 'pauline-')), 'projet');
  mkdirSync(d);
  writeFileSync(join(d, 'CLAUDE.md'), 'Utilise pnpm.\n');
  const fb = join(d, 'base.md');
  writeFileSync(fb, BASE);
  let r = await lancer(['local', d, '--base', fb]);
  assert.equal(r.code, 0, r.sortie);
  assert.match(readFileSync(join(d, 'AGENTS.md'), 'utf8'), /^# projet\n/);
  assert.equal(readFileSync(join(d, 'CLAUDE.md'), 'utf8'), '@AGENTS.md\n\nUtilise pnpm.\n');
  assert.match((await lancer(['local', d, '--base', fb])).sortie, /Déjà à jour/);
  writeFileSync(join(d, 'AGENTS.md'), readFileSync(join(d, 'AGENTS.md'), 'utf8').replace('français', 'anglais'));
  r = await lancer(['local', d, '--base', fb]);
  assert.equal(r.code, 1);
  assert.match(r.sortie, /modifié à la main/);
  assert.equal((await lancer(['local', d, '--base', fb, '--forcer'])).code, 0);
  assert.match(readFileSync(join(d, 'AGENTS.md'), 'utf8'), /Tout en français\./);
});

/** Fausse API GitHub : trois dépôts (neuf, à jour, modifié à la main) ; enregistre les écritures. */
function fausseApi(baseTexte) {
  const depot = (name) => ({ name, full_name: `moi/${name}`, owner: { login: 'moi' }, visibility: 'public', archived: false, fork: false, default_branch: 'main' });
  const depots = { neuf: depot('neuf'), propre: depot('propre'), bricole: depot('bricole') };
  const fichiers = {
    'propre/AGENTS.md': integrer(null, baseTexte, 'propre'), 'propre/CLAUDE.md': '@AGENTS.md\n',
    'bricole/AGENTS.md': integrer(null, baseTexte, 'bricole').replace('français', 'anglais'),
    'neuf/CLAUDE.md': 'Utilise pnpm.\n',
  };
  const ecritures = [];
  const serveur = createServer((req, res) => {
    let corps = '';
    req.on('data', (c) => (corps += c));
    req.on('end', () => {
      const envoyer = (statut, donnees) => { res.writeHead(statut, { 'Content-Type': 'application/json' }); res.end(donnees === undefined ? '' : JSON.stringify(donnees)); };
      const [u, q = ''] = req.url.split('?');
      const j = corps ? JSON.parse(corps) : {};
      let m;
      if (u === '/user') return envoyer(200, { login: 'moi' });
      if (u === '/user/repos') return envoyer(200, Object.values(depots));
      if ((m = /^\/repos\/moi\/([^/]+)$/.exec(u))) return envoyer(200, depots[m[1]]);
      if ((m = /^\/repos\/moi\/([^/]+)\/contents\/(.+)$/.exec(u))) {
        const cle = `${m[1]}/${decodeURIComponent(m[2])}`;
        if (req.method === 'PUT') {
          ecritures.push(`PUT ${cle} sur ${j.branch}`);
          fichiers[`${cle}@${j.branch}`] = Buffer.from(j.content, 'base64').toString('utf8');
          return envoyer(200, {});
        }
        const ref = new URLSearchParams(q).get('ref');
        const texte = ref ? fichiers[`${cle}@${ref}`] : fichiers[cle];
        return texte === undefined ? envoyer(404, { message: 'Not Found' }) : envoyer(200, { content: Buffer.from(texte).toString('base64'), sha: 'abc' });
      }
      if ((m = /^\/repos\/moi\/([^/]+)\/git\/ref\/heads\/main$/.exec(u))) return envoyer(200, { object: { sha: 'tete' } });
      if ((m = /^\/repos\/moi\/([^/]+)\/git\/refs$/.exec(u))) { ecritures.push(`branche ${m[1]} ${j.ref}`); return envoyer(201, {}); }
      if ((m = /^\/repos\/moi\/([^/]+)\/pulls$/.exec(u))) {
        if (req.method === 'GET') return envoyer(200, []);
        ecritures.push(`PR ${m[1]} ${j.title}`);
        return envoyer(201, { html_url: `https://github.com/moi/${m[1]}/pull/1` });
      }
      return envoyer(404, { message: 'inconnu' });
    });
  });
  return new Promise((ok) => serveur.listen(0, () => ok({ serveur, base: `http://127.0.0.1:${serveur.address().port}`, ecritures, fichiers })));
}

test('verifier ne change rien ; appliquer ouvre une PR, sauf pour un bloc modifié à la main', async () => {
  const fb = join(mkdtempSync(join(tmpdir(), 'pauline-')), 'base.md');
  writeFileSync(fb, BASE);
  const { serveur, base, ecritures, fichiers } = await fausseApi(BASE);
  try {
    const v = await lancer(['verifier', '--base', fb], { base });
    assert.equal(v.code, 1);
    assert.match(v.sortie, /⚠ bricole\s+bloc modifié à la main/);
    assert.match(v.sortie, /✗ neuf\s+pas d’AGENTS\.md · CLAUDE\.md n’importe pas AGENTS\.md/);
    assert.match(v.sortie, /✓ propre\s+à jour/);
    assert.deepEqual(ecritures, [], 'verifier n’écrit rien');
    assert.match((await lancer(['appliquer', '--base', fb], { base })).sortie, /ajoutez --oui/);
    assert.deepEqual(ecritures, []);
    const a = await lancer(['appliquer', '--base', fb, '--oui'], { base });
    assert.equal(a.code, 0, a.sortie);
    assert.deepEqual(ecritures, [
      'branche neuf refs/heads/pauline/consignes',
      'PUT neuf/AGENTS.md sur pauline/consignes',
      'PUT neuf/CLAUDE.md sur pauline/consignes',
      `PR neuf docs: 🧾 consignes communes (Pauline ${empreinte(BASE)})`,
    ]);
    assert.equal(fichiers['neuf/CLAUDE.md@pauline/consignes'], '@AGENTS.md\n\nUtilise pnpm.\n');
    assert.equal(etat(fichiers['neuf/AGENTS.md@pauline/consignes'], BASE), 'a-jour');
    ecritures.length = 0;
    await lancer(['appliquer', '--base', fb, '--oui', '--sauf', 'neuf'], { base });
    assert.deepEqual(ecritures, [], '--sauf laisse le dépôt de côté');
  } finally {
    serveur.close();
  }
});
