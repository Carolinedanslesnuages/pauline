/**
 * Le bloc de consignes communes dans AGENTS.md, entre deux marques :
 *
 *   <!-- pauline:debut empreinte=1a2b3c4d5e6f -->
 *   … la base …
 *   <!-- pauline:fin -->
 *
 * L'empreinte est celle du contenu écrit par Pauline : si le bloc ne lui correspond plus, il a été
 * modifié à la main, et Pauline refuse de l'écraser sans --forcer. Le reste du fichier (les
 * consignes propres au projet) n'est jamais touché.
 */
import { createHash } from 'node:crypto';

const DEBUT = /<!-- pauline:debut empreinte=([0-9a-f]{12}) -->\n/;
const FIN = '<!-- pauline:fin -->';

export const empreinte = (texte) => createHash('sha256').update(texte.replace(/\r\n/g, '\n').trim()).digest('hex').slice(0, 12);

export function bloc(base) {
  const propre = base.replace(/\r\n/g, '\n').trim();
  return `<!-- pauline:debut empreinte=${empreinte(propre)} -->\n${propre}\n${FIN}`;
}

/** Découpe AGENTS.md : { avant, contenu, apres, notee } ou null s'il n'y a pas de bloc. */
export function extraire(texte) {
  const t = texte.replace(/\r\n/g, '\n');
  const d = DEBUT.exec(t);
  if (!d) return null;
  const debutContenu = d.index + d[0].length;
  const f = t.indexOf(FIN, debutContenu);
  if (f < 0) return null;
  return { avant: t.slice(0, d.index), contenu: t.slice(debutContenu, f), apres: t.slice(f + FIN.length), notee: d[1] };
}

/**
 * État d'un dépôt pour cette base :
 *   absent      pas d'AGENTS.md
 *   sans-bloc   AGENTS.md sans bloc Pauline
 *   a-jour      bloc identique à la base
 *   perime      bloc écrit par Pauline, mais d'une ancienne base
 *   modifie     bloc changé à la main depuis que Pauline l'a écrit
 */
export function etat(agents, base) {
  if (agents == null) return 'absent';
  const b = extraire(agents);
  if (!b) return 'sans-bloc';
  if (empreinte(b.contenu) !== b.notee) return 'modifie';
  return b.notee === empreinte(base) ? 'a-jour' : 'perime';
}

/** Nouveau AGENTS.md : le bloc à jour, le reste intact. */
export function integrer(agents, base, projet) {
  if (agents == null) return `# ${projet}\n\n${bloc(base)}\n\n## Consignes de ce projet\n\nLes consignes propres à ce projet viennent ici.\n`;
  const t = agents.replace(/\r\n/g, '\n');
  const b = extraire(t);
  if (b) return `${b.avant}${bloc(base)}${b.apres}`;
  // Pas encore de bloc : juste après le titre principal s'il y en a un, sinon tout en haut.
  const titre = /^# .*\n/m.exec(t);
  if (titre && titre.index === t.search(/\S/)) {
    const fin = titre.index + titre[0].length;
    return `${t.slice(0, fin)}\n${bloc(base)}\n${t.slice(fin).replace(/^\n*/, '\n')}`;
  }
  return `${bloc(base)}\n\n${t}`;
}

/** CLAUDE.md qui importe AGENTS.md (Claude Code lit ainsi les mêmes consignes). */
export function claude(contenu) {
  if (contenu == null || !contenu.trim()) return '@AGENTS.md\n';
  if (/^@AGENTS\.md\s*$/m.test(contenu)) return contenu;
  return `@AGENTS.md\n\n${contenu}`;
}
