#!/usr/bin/env node
/** Pauline: the same agent guidelines (AGENTS.md, CLAUDE.md) in all your repositories. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { state, merge, claudeFile, fingerprint } from '../src/block.mjs';
import { client } from '../src/github.mjs';

const HELP = `Pauline · les mêmes consignes d'agent dans tous vos dépôts

  pauline base                     affiche la base de consignes et son empreinte
  pauline verifier [dépôts…]       état de chaque dépôt, sans rien changer
  pauline appliquer [dépôts…]      ouvre une PR par dépôt à mettre à jour
  pauline local [dossier]          met à jour AGENTS.md et CLAUDE.md d'un dossier (défaut : .)

  Sans dépôt nommé : tous vos dépôts publics (ni archivés, ni fourches).
  --base <fichier>   votre base de consignes (défaut : celle de Pauline)
  --profil appli-web ajoute les règles des applications web (SQL, mots de passe, validation)
  --sauf <a,b>       dépôts à laisser de côté
  --prives / --tous  dépôts privés, ou tous
  --forcer           remplacer un bloc modifié à la main
  --oui              sans demander confirmation

Seul le bloc entre « pauline:debut » et « pauline:fin » est géré : le reste d'AGENTS.md
(les consignes propres au projet) n'est jamais touché.`;

const STATE_LABELS = {
  missing: 'pas d’AGENTS.md',
  'no-block': 'AGENTS.md sans consignes communes',
  'up-to-date': 'à jour',
  outdated: 'consignes communes à mettre à jour',
  edited: 'bloc modifié à la main',
};

function parseOptions(args) {
  const options = { targets: [], visibility: 'public', excluded: [] };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--base') options.base = args[++index];
    else if (argument === '--profil') options.profile = args[++index];
    else if (argument === '--sauf') options.excluded = String(args[++index] || '').split(',').map((name) => name.trim().toLowerCase()).filter(Boolean);
    else if (argument === '--prives') options.visibility = 'private';
    else if (argument === '--tous') options.visibility = 'all';
    else if (argument === '--forcer') options.force = true;
    else if (argument === '--oui') options.yes = true;
    else if (argument.startsWith('--')) throw new Error(`Option inconnue : ${argument}. Tapez « pauline aide ».`);
    else options.targets.push(argument);
  }
  return options;
}

/** Profiles add a section to the base, before « En cas de doute ». Names are public (--profil). */
const PROFILES = { 'appli-web': 'appli-web.md' };

function readBase(options) {
  const base = readFileSync(options.base ? resolve(options.base) : new URL('../consignes/communes.md', import.meta.url), 'utf8');
  if (!options.profile) return base;
  if (!PROFILES[options.profile]) throw new Error(`Profil inconnu : ${options.profile}. Profils : ${Object.keys(PROFILES).join(', ')}.`);
  const section = readFileSync(new URL(`../consignes/${PROFILES[options.profile]}`, import.meta.url), 'utf8').trim();
  const doubtHeading = base.indexOf('### En cas de doute');
  return doubtHeading < 0 ? `${base.trimEnd()}\n\n${section}\n` : `${base.slice(0, doubtHeading)}${section}\n\n${base.slice(doubtHeading)}`;
}

async function confirm(options, question) {
  if (options.yes) return true;
  if (!process.stdin.isTTY) throw new Error('Pas de terminal pour confirmer : ajoutez --oui.');
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const accepted = /^o/i.test((await prompt.question(`${question} (o/N) `)).trim());
  prompt.close();
  return accepted;
}

async function collectStates(github, options, base) {
  const owner = await github.currentUser();
  let repositories;
  if (options.targets.length) {
    repositories = await Promise.all(options.targets.map((name) => github.repository(name.includes('/') ? name : `${owner}/${name}`)));
  } else {
    repositories = (await github.repositories(owner)).filter((repo) => !repo.archived && !repo.fork && (options.visibility === 'all' || repo.visibility === options.visibility));
  }
  repositories = repositories.filter((repo) => !options.excluded.includes(repo.name.toLowerCase())).sort((left, right) => left.name.localeCompare(right.name));
  const reports = [];
  for (const repo of repositories) {
    const agents = await github.file(repo.full_name, 'AGENTS.md');
    const claude = await github.file(repo.full_name, 'CLAUDE.md');
    reports.push({
      repo,
      agents,
      claude,
      state: state(agents && agents.text, base),
      claudeImports: !!claude && claudeFile(claude.text) === claude.text,
    });
  }
  return { owner, reports };
}

const isDone = (report) => report.state === 'up-to-date' && report.claudeImports;

function print(reports) {
  const width = Math.max(...reports.map((report) => report.repo.name.length));
  for (const report of reports) {
    const notes = [report.state === 'up-to-date' ? null : STATE_LABELS[report.state], report.claudeImports ? null : 'CLAUDE.md n’importe pas AGENTS.md'].filter(Boolean);
    const symbol = isDone(report) ? '✓' : report.state === 'edited' ? '⚠' : '✗';
    console.log(`${symbol} ${report.repo.name.padEnd(width)}  ${isDone(report) ? 'à jour' : notes.join(' · ')}`);
  }
}

function runLocal(options, base) {
  const folder = resolve(options.targets[0] || '.');
  const agentsPath = join(folder, 'AGENTS.md');
  const claudePath = join(folder, 'CLAUDE.md');
  const agents = existsSync(agentsPath) ? readFileSync(agentsPath, 'utf8') : null;
  const current = state(agents, base);
  if (current === 'edited' && !options.force) {
    throw new Error('Le bloc de consignes communes a été modifié à la main. Reportez vos changements dans la base, ou relancez avec --forcer.');
  }
  if (current !== 'up-to-date') writeFileSync(agentsPath, merge(agents, base, basename(folder)));
  const claude = existsSync(claudePath) ? readFileSync(claudePath, 'utf8') : null;
  if (claudeFile(claude) !== claude) writeFileSync(claudePath, claudeFile(claude));
  console.log(current === 'up-to-date' && claudeFile(claude) === claude ? 'Déjà à jour.' : `AGENTS.md et CLAUDE.md à jour dans ${folder}.`);
}

const plural = (count, word) => `${count} ${word}${count > 1 ? 's' : ''}`;

async function runRemote(command, options, base) {
  const github = client();
  const { owner, reports } = await collectStates(github, options, base);
  if (!reports.length) return console.log('Aucun dépôt.');
  print(reports);
  const pending = reports.filter((report) => !isDone(report));
  const blocked = pending.filter((report) => report.state === 'edited' && !options.force);
  const blockedNote = blocked.length ? ` (dont ${plural(blocked.length, 'bloc')} modifié${blocked.length > 1 ? 's' : ''} à la main : --forcer pour les remplacer)` : '';
  console.log(`\n${plural(reports.length, 'dépôt')} · ${reports.length - pending.length} à jour · ${pending.length} à mettre à jour${blockedNote}`);
  if (command === 'verifier') {
    if (pending.length) process.exitCode = 1;
    return;
  }
  const updates = pending.filter((report) => !blocked.includes(report));
  if (!updates.length) return;
  if (!(await confirm(options, `\nOuvrir une PR dans ${plural(updates.length, 'dépôt')} ?`))) return console.log('Rien n’a été changé.');
  const title = `docs: 🧾 consignes communes (Pauline ${fingerprint(base)})`;
  const body = `Mise à jour des consignes communes d'agent par [Pauline](https://github.com/Carolinedanslesnuages/pauline).\n\n- \`AGENTS.md\` : seul le bloc entre \`pauline:debut\` et \`pauline:fin\` change ; les consignes propres au projet sont intactes.\n- \`CLAUDE.md\` importe \`AGENTS.md\` (\`@AGENTS.md\`), pour que Claude Code lise les mêmes consignes.\n\nEmpreinte de la base : \`${fingerprint(base)}\`.`;
  let failures = 0;
  for (const report of updates) {
    const { repo } = report;
    try {
      await github.prepareBranch(repo.full_name, repo.default_branch);
      if (report.state !== 'up-to-date') await github.write(repo.full_name, 'AGENTS.md', merge(report.agents && report.agents.text, base, repo.name), title);
      if (!report.claudeImports) await github.write(repo.full_name, 'CLAUDE.md', claudeFile(report.claude && report.claude.text), 'docs: 🧾 CLAUDE.md importe AGENTS.md (Pauline)');
      console.log(`  ✓ ${repo.name} : ${await github.pullRequest(repo.full_name, owner, repo.default_branch, title, body)}`);
    } catch (error) {
      failures++;
      console.log(`  ✗ ${repo.name} : ${error.message}`);
    }
  }
  if (failures) process.exitCode = 1;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || ['aide', '--aide', '-h', '--help'].includes(command)) return console.log(HELP);
  const options = parseOptions(rest);
  const base = readBase(options);
  if (command === 'base') return console.log(`Empreinte : ${fingerprint(base)}\n\n${base}`);
  if (command === 'local') return runLocal(options, base);
  if (['verifier', 'appliquer'].includes(command)) return runRemote(command, options, base);
  throw new Error(`Commande inconnue : ${command}. Tapez « pauline aide ».`);
}

main().catch((error) => {
  console.error(`pauline : ${error.message}`);
  process.exit(1);
});
