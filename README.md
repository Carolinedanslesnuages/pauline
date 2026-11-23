# Pauline

Les mêmes consignes d'agent dans tous vos dépôts : une base commune, maintenue à un seul endroit.

Le nom rend hommage à Pauline Kergomard (1838-1925), inspectrice générale des écoles maternelles
à partir de 1881, qui a joué un rôle éminent dans leur mise en place : un même cadre pour toutes.

Les assistants de code lisent un fichier de consignes à la racine du projet : `AGENTS.md` pour la
plupart, `CLAUDE.md` pour Claude Code. D'un dépôt à l'autre, ces fichiers divergent vite : une
règle ajoutée ici, oubliée là. Pauline garde **un bloc commun** identique partout, et laisse
intactes les consignes propres à chaque projet.

```markdown
# mon-projet

<!-- pauline:debut empreinte=3f9a1c0b7e21 -->
## Langue
…les consignes communes…
<!-- pauline:fin -->

## Consignes de ce projet

Les migrations se font avec `npm run migrer`, jamais à la main.
```

## Utilisation

```sh
npx @carolinedanslesnuages/pauline verifier
```

| Commande | Ce qu'elle fait |
|---|---|
| `pauline base` | Affiche la base de consignes et son empreinte. |
| `pauline verifier [dépôts…]` | Donne l'état de chaque dépôt, sans rien changer. |
| `pauline appliquer [dépôts…]` | Ouvre une PR par dépôt à mettre à jour, après confirmation. |
| `pauline local [dossier]` | Met à jour `AGENTS.md` et `CLAUDE.md` d'un dossier sur votre ordinateur. |

Sans dépôt nommé, Pauline prend tous vos dépôts publics, ni archivés ni fourches.

| Option | Rôle |
|---|---|
| `--base <fichier>` | Votre propre base de consignes (par défaut, [celle de Pauline](consignes/communes.md)). |
| `--profil appli-web` | Ajoute les règles des applications web. |
| `--sauf <a,b>` | Dépôts à laisser de côté. |
| `--prives`, `--tous` | Dépôts privés, ou tous les dépôts. |
| `--forcer` | Remplacer un bloc modifié à la main. |
| `--oui` | Ne pas demander confirmation. |

Le jeton GitHub vient de `GITHUB_TOKEN`, `GH_TOKEN`, ou de `gh auth token`.

## Ce que Pauline fait, et ne fait pas

- **Seul le bloc commun change.** Tout ce qui est hors des marqueurs `pauline:debut` et
  `pauline:fin` est conservé tel quel.
- **`AGENTS.md` absent** : Pauline le crée avec le titre du projet, le bloc commun et une
  section « Consignes de ce projet » à remplir.
- **`AGENTS.md` sans bloc** : le bloc est inséré sous le premier titre.
- **`CLAUDE.md`** : Pauline y ajoute `@AGENTS.md` en première ligne, pour que Claude Code lise
  les mêmes consignes. Le reste du fichier est conservé.
- **Bloc modifié à la main** : l'empreinte notée dans le marqueur ne correspond plus au contenu.
  Pauline le signale et n'y touche pas : reportez la modification dans la base, ou relancez
  avec `--forcer`.
- **Jamais de commit direct** sur la branche principale : chaque mise à jour arrive par une PR,
  sur la branche `pauline/consignes`, que vous relisez et fusionnez vous-même.

`pauline verifier` sort en erreur (code 1) quand un dépôt n'est pas à jour : il peut servir de
contrôle en intégration continue.

## Le profil « applications web »

```sh
pauline appliquer mon-appli --profil appli-web
```

Ajoute à la base trois règles qui ne concernent que les applications web : requêtes SQL
paramétrées, mots de passe hachés avec argon2 ou bcrypt, données validées côté serveur
([`consignes/appli-web.md`](consignes/appli-web.md)). Les outils en ligne de commande n'en ont
pas besoin : ils gardent une base plus courte, mieux suivie par les agents. Utilisez le même
profil pour `verifier` et `appliquer`, sinon le bloc paraît à mettre à jour.

## La skill « analyse-projet »

[`skills/analyse-projet`](skills/analyse-projet/SKILL.md) est une liste de contrôle pour
analyser un projet existant (sécurité, performance, gestion des erreurs, qualité, état du
projet) et le format du compte rendu (gravité, emplacement, correction). C'est une skill, pas
une consigne commune : l'agent ne la charge que quand on lui demande une analyse, au lieu de la
lire dans chaque dépôt.

```sh
cp -r skills/analyse-projet ~/.claude/skills/
```

## La base de consignes

[`consignes/communes.md`](consignes/communes.md) contient les consignes de Pauline : langue,
commits et PR, taille du code et tests, accessibilité (RGAA), dépendances, sécurité et données,
et que faire en cas de doute. Elles sont écrites pour des projets en français. Pour les vôtres,
écrivez votre fichier et passez-le avec `--base`.

## Pourquoi Pauline

[Pauline Kergomard](https://fr.wikipedia.org/wiki/Pauline_Kergomard) (1838-1925), inspectrice
générale des écoles maternelles, a donné à toutes les écoles maternelles de France un même cadre
et une même pédagogie, tout en laissant à chaque classe sa vie propre. Un socle commun, et la
liberté du reste.

## Développer Pauline

```sh
npm test
```

Les tests utilisent une fausse API GitHub : ils vérifient que `verifier` n'écrit rien, que
`appliquer` ouvre une PR avec les bons fichiers, et qu'un bloc modifié à la main est respecté.

## Licence

[MIT](LICENSE).
