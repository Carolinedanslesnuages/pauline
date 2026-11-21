/** Accès à l'API GitHub avec votre jeton (GITHUB_TOKEN, GH_TOKEN, ou celui de « gh »). */
import { execFileSync } from 'node:child_process';

export const BRANCHE = 'pauline/consignes';

export function jeton() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  try {
    return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    throw new Error('Aucun jeton GitHub : connectez-vous avec « gh auth login », ou définissez GITHUB_TOKEN.');
  }
}

export function client(token = jeton(), base = process.env.PAULINE_API_BASE || 'https://api.github.com') {
  async function appel(methode, chemin, corps) {
    const r = await fetch(base + chemin, {
      method: methode,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'pauline', ...(corps ? { 'Content-Type': 'application/json' } : {}) },
      body: corps ? JSON.stringify(corps) : undefined,
    });
    const texte = await r.text();
    return { statut: r.status, donnees: texte ? JSON.parse(texte) : null };
  }
  const verifie = (r, quoi) => {
    if (r.statut >= 300) throw new Error(`${quoi} : refusé par GitHub (${r.statut}${r.donnees && r.donnees.message ? ', ' + r.donnees.message : ''})`);
    return r.donnees;
  };
  const enc = (chemin) => chemin.split('/').map(encodeURIComponent).join('/');

  return {
    async moi() {
      return verifie(await appel('GET', '/user'), 'Jeton').login;
    },
    async depots(compte) {
      const tous = [];
      for (let page = 1; ; page++) {
        const l = verifie(await appel('GET', `/user/repos?per_page=100&page=${page}&affiliation=owner`), 'Liste des dépôts');
        tous.push(...l);
        if (l.length < 100) break;
      }
      return tous.filter((d) => d.owner.login.toLowerCase() === compte.toLowerCase());
    },
    async depot(nomComplet) {
      return verifie(await appel('GET', `/repos/${nomComplet}`), `Dépôt ${nomComplet}`);
    },
    /** Contenu d'un fichier (texte et sha), ou null s'il n'existe pas. */
    async fichier(nomComplet, chemin, ref) {
      const r = await appel('GET', `/repos/${nomComplet}/contents/${enc(chemin)}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`);
      if (r.statut === 404) return null;
      const d = verifie(r, `Lecture de ${chemin}`);
      return { texte: Buffer.from(d.content, 'base64').toString('utf8'), sha: d.sha };
    },
    /** Remet la branche de travail sur la tête de la branche principale. */
    async preparerBranche(nomComplet, principale) {
      const tete = verifie(await appel('GET', `/repos/${nomComplet}/git/ref/heads/${enc(principale)}`), 'Branche principale').object.sha;
      const r = await appel('POST', `/repos/${nomComplet}/git/refs`, { ref: `refs/heads/${BRANCHE}`, sha: tete });
      if (r.statut === 422) verifie(await appel('PATCH', `/repos/${nomComplet}/git/refs/heads/${enc(BRANCHE)}`, { sha: tete, force: true }), 'Branche de travail');
      else verifie(r, 'Branche de travail');
    },
    async ecrire(nomComplet, chemin, texte, message) {
      const existant = await this.fichier(nomComplet, chemin, BRANCHE);
      verifie(await appel('PUT', `/repos/${nomComplet}/contents/${enc(chemin)}`, { message, content: Buffer.from(texte, 'utf8').toString('base64'), branch: BRANCHE, ...(existant ? { sha: existant.sha } : {}) }), `Écriture de ${chemin}`);
    },
    /** Ouvre la PR, ou réutilise celle déjà ouverte. Renvoie son adresse. */
    async pr(nomComplet, compte, principale, titre, corps) {
      const ouvertes = verifie(await appel('GET', `/repos/${nomComplet}/pulls?state=open&head=${encodeURIComponent(`${compte}:${BRANCHE}`)}`), 'PR ouvertes');
      if (ouvertes.length) {
        verifie(await appel('PATCH', `/repos/${nomComplet}/pulls/${ouvertes[0].number}`, { title: titre, body: corps }), 'Mise à jour de la PR');
        return ouvertes[0].html_url;
      }
      return verifie(await appel('POST', `/repos/${nomComplet}/pulls`, { title: titre, head: BRANCHE, base: principale, body: corps }), 'Ouverture de la PR').html_url;
    },
  };
}
