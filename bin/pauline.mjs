#!/usr/bin/env node
/** Pauline : les mêmes consignes d'agent (AGENTS.md, CLAUDE.md) dans tous vos dépôts. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { etat, integrer, claude, empreinte } from '../src/bloc.mjs';
import { client } from '../src/github.mjs';

const AIDE = `Pauline · les mêmes consignes d'agent dans tous vos dépôts

  pauline base                     affiche la base de consignes et son empreinte
  pauline verifier [dépôts…]       état de chaque dépôt, sans rien changer
  pauline appliquer [dépôts…]      ouvre une PR par dépôt à mettre à jour
  pauline local [dossier]          met à jour AGENTS.md et CLAUDE.md d'un dossier (défaut : .)

  Sans dépôt nommé : tous vos dépôts publics (ni archivés, ni fourches).
  --base <fichier>   votre base de consignes (défaut : celle de Pauline)
  --sauf <a,b>       dépôts à laisser de côté
  --prives / --tous  dépôts privés, ou tous
  --forcer           remplacer un bloc modifié à la main
  --oui              sans demander confirmation

Seul le bloc entre « pauline:debut » et « pauline:fin » est géré : le reste d'AGENTS.md
(les consignes propres au projet) n'est jamais touché.`;

const LIBELLES = {
  absent: 'pas d’AGENTS.md',
  'sans-bloc': 'AGENTS.md sans consignes communes',
  'a-jour': 'à jour',
  perime: 'consignes communes à mettre à jour',
  modifie: 'bloc modifié à la main',
};

function options(args) {
  const o = { cibles: [], visibilite: 'public', sauf: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--base') o.base = args[++i];
    else if (a === '--sauf') o.sauf = String(args[++i] || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
    else if (a === '--prives') o.visibilite = 'private';
    else if (a === '--tous') o.visibilite = 'all';
    else if (a === '--forcer') o.forcer = true;
    else if (a === '--oui') o.oui = true;
    else if (a.startsWith('--')) throw new Error(`Option inconnue : ${a}. Tapez « pauline aide ».`);
    else o.cibles.push(a);
  }
  return o;
}

const lireBase = (o) => readFileSync(o.base ? resolve(o.base) : new URL('../consignes/communes.md', import.meta.url), 'utf8');

async function confirmer(o, question) {
  if (o.oui) return true;
  if (!process.stdin.isTTY) throw new Error('Pas de terminal pour confirmer : ajoutez --oui.');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ok = /^o/i.test((await rl.question(`${question} (o/N) `)).trim());
  rl.close();
  return ok;
}

async function etats(gh, o, base) {
  const compte = await gh.moi();
  let depots;
  if (o.cibles.length) depots = await Promise.all(o.cibles.map((n) => gh.depot(n.includes('/') ? n : `${compte}/${n}`)));
  else depots = (await gh.depots(compte)).filter((d) => !d.archived && !d.fork && (o.visibilite === 'all' || d.visibility === o.visibilite));
  depots = depots.filter((d) => !o.sauf.includes(d.name.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name));
  const lignes = [];
  for (const d of depots) {
    const agents = await gh.fichier(d.full_name, 'AGENTS.md');
    const cl = await gh.fichier(d.full_name, 'CLAUDE.md');
    const e = etat(agents && agents.texte, base);
    const claudeOk = !!cl && claude(cl.texte) === cl.texte;
    lignes.push({ depot: d, agents, cl, etat: e, claudeOk });
  }
  return { compte, lignes };
}

function afficher(lignes) {
  const larg = Math.max(...lignes.map((l) => l.depot.name.length));
  for (const l of lignes) {
    const ok = l.etat === 'a-jour' && l.claudeOk;
    const notes = [LIBELLES[l.etat], ...(l.claudeOk ? [] : ['CLAUDE.md n’importe pas AGENTS.md'])];
    console.log(`${ok ? '✓' : l.etat === 'modifie' ? '⚠' : '✗'} ${l.depot.name.padEnd(larg)}  ${ok ? 'à jour' : notes.filter((x) => x !== 'à jour').join(' · ')}`);
  }
}

async function principal() {
  const [commande, ...reste] = process.argv.slice(2);
  if (!commande || ['aide', '--aide', '-h', '--help'].includes(commande)) return console.log(AIDE);
  const o = options(reste);
  const base = lireBase(o);

  if (commande === 'base') return console.log(`Empreinte : ${empreinte(base)}\n\n${base}`);

  if (commande === 'local') {
    const dossier = resolve(o.cibles[0] || '.');
    const fa = join(dossier, 'AGENTS.md');
    const fc = join(dossier, 'CLAUDE.md');
    const agents = existsSync(fa) ? readFileSync(fa, 'utf8') : null;
    const e = etat(agents, base);
    if (e === 'modifie' && !o.forcer) throw new Error('Le bloc de consignes communes a été modifié à la main. Reportez vos changements dans la base, ou relancez avec --forcer.');
    if (e !== 'a-jour') writeFileSync(fa, integrer(agents, base, basename(dossier)));
    const cl = existsSync(fc) ? readFileSync(fc, 'utf8') : null;
    if (claude(cl) !== cl) writeFileSync(fc, claude(cl));
    return console.log(e === 'a-jour' && claude(cl) === cl ? 'Déjà à jour.' : `AGENTS.md et CLAUDE.md à jour dans ${dossier}.`);
  }

  if (!['verifier', 'appliquer'].includes(commande)) throw new Error(`Commande inconnue : ${commande}. Tapez « pauline aide ».`);
  const gh = client();
  const { compte, lignes } = await etats(gh, o, base);
  if (!lignes.length) return console.log('Aucun dépôt.');
  afficher(lignes);
  const aFaire = lignes.filter((l) => !(l.etat === 'a-jour' && l.claudeOk));
  const bloques = aFaire.filter((l) => l.etat === 'modifie' && !o.forcer);
  console.log(`\n${lignes.length} dépôt${lignes.length > 1 ? 's' : ''} · ${lignes.length - aFaire.length} à jour · ${aFaire.length} à mettre à jour${bloques.length ? ` (dont ${bloques.length} bloc${bloques.length > 1 ? 's' : ''} modifié${bloques.length > 1 ? 's' : ''} à la main : --forcer pour les remplacer)` : ''}`);
  if (commande === 'verifier') {
    if (aFaire.length) process.exitCode = 1;
    return;
  }
  const cibles = aFaire.filter((l) => !bloques.includes(l));
  if (!cibles.length) return;
  if (!(await confirmer(o, `\nOuvrir une PR dans ${cibles.length} dépôt${cibles.length > 1 ? 's' : ''} ?`))) return console.log('Rien n’a été changé.');
  const titre = `docs: 🧾 consignes communes (Pauline ${empreinte(base)})`;
  const corps = `Mise à jour des consignes communes d'agent par [Pauline](https://github.com/Carolinedanslesnuages/pauline).\n\n- \`AGENTS.md\` : seul le bloc entre \`pauline:debut\` et \`pauline:fin\` change ; les consignes propres au projet sont intactes.\n- \`CLAUDE.md\` importe \`AGENTS.md\` (\`@AGENTS.md\`), pour que Claude Code lise les mêmes consignes.\n\nEmpreinte de la base : \`${empreinte(base)}\`.`;
  let echecs = 0;
  for (const l of cibles) {
    try {
      const principale = l.depot.default_branch;
      await gh.preparerBranche(l.depot.full_name, principale);
      if (l.etat !== 'a-jour') await gh.ecrire(l.depot.full_name, 'AGENTS.md', integrer(l.agents && l.agents.texte, base, l.depot.name), titre);
      if (!l.claudeOk) await gh.ecrire(l.depot.full_name, 'CLAUDE.md', claude(l.cl && l.cl.texte), 'docs: 🧾 CLAUDE.md importe AGENTS.md (Pauline)');
      console.log(`  ✓ ${l.depot.name} : ${await gh.pr(l.depot.full_name, compte, principale, titre, corps)}`);
    } catch (e) {
      echecs++;
      console.log(`  ✗ ${l.depot.name} : ${e.message}`);
    }
  }
  if (echecs) process.exitCode = 1;
}

principal().catch((e) => {
  console.error(`pauline : ${e.message}`);
  process.exit(1);
});
