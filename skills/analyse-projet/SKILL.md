---
name: analyse-projet
description: Liste de contrôle pour analyser ou relire un projet existant qu'on ne connaît pas (sécurité, performance, erreurs, qualité, état du projet) et format du compte rendu. À utiliser quand on demande d'analyser, d'auditer ou de faire le point sur un projet ou un dépôt.
license: MIT
---

# Analyser un projet existant

Avant de proposer quoi que ce soit, parcourir cette liste. Chaque problème est signalé avec son
fichier et sa ligne. La sécurité passe d'abord. Ne rien corriger pendant l'analyse : la
correction vient après, quand la personne a lu le compte rendu.

## 1. Sécurité

- **HTML injecté** : du contenu venu de l'utilisateur ou d'une base inséré sans échappement
  (`innerHTML`, `v-html`, `dangerouslySetInnerHTML`, gabarits non échappés).
- **Requêtes SQL** construites en assemblant du texte au lieu d'être paramétrées.
- **Validation côté serveur** : chaque donnée reçue est-elle vérifiée par le serveur, même si
  le client la vérifie déjà ?
- **Mots de passe** : hachés avec argon2 ou bcrypt ? Jamais journalisés ?
- **Secrets** : présents dans le code, les tests, l'historique git ou les journaux ? `.env` est-il
  dans `.gitignore` ?
- **TLS** : vérification des certificats désactivée (`rejectUnauthorized: false`,
  `verify=False`) ? Adresses en `http://` pour des données sensibles ?
- **CORS** : `Access-Control-Allow-Origin: *` sur une API qui utilise des cookies ou des jetons ?
- **Droits** : chaque route protégée vérifie-t-elle qui appelle, et pas seulement qu'on est
  connecté ?

## 2. Performance

- **Requêtes N+1** : une requête par élément dans une boucle, au lieu d'une seule requête.
- **Pagination** : des listes qui peuvent grandir sans limite ?
- **Poids envoyé** : images, JavaScript, polices (Solange le mesure).

## 3. Gestion des erreurs

- **`catch` vide** ou qui avale l'erreur sans rien dire.
- **Promesses sans `catch`**, ou `await` sans gestion d'erreur là où l'échec est possible.
- **Traces exposées** : pile d'appels ou message technique renvoyé à l'utilisateur.

## 4. Qualité du code

- **Duplication** : le même bloc à plusieurs endroits.
- **Nombres magiques** : des valeurs sans nom (`if (status === 3)`).
- **Sur-ingénierie** : des couches ou des abstractions sans usage réel.
- **Fichiers trop longs** : plusieurs responsabilités dans un même fichier.

## 5. État du projet

- **Tests** : existent-ils, passent-ils, que couvrent-ils ?
- **Commits** : lisibles, au format Conventional Commits ?
- **README** : dit-il comment installer, lancer et tester ?
- **Sauvegardes** : les données de production sont-elles sauvegardées, et la restauration
  a-t-elle déjà été essayée ?

## Compte rendu

Un tableau, du plus grave au moins grave :

| Gravité | Emplacement | Problème | Correction proposée |
|---|---|---|---|
| Critique | `src/auth.ts:42` | Requête SQL construite avec la saisie de l'utilisateur | Requête paramétrée |

- **Critique** : faille exploitable ou perte de données possible.
- **Importante** : bug probable, ou risque réel sous charge.
- **Mineure** : qualité, lisibilité, dette.

Finir par ce qui n'a pas pu être vérifié (pas d'accès à la base, tests non lancés…).
