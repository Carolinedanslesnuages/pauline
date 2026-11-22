### Application web
- Les requêtes SQL sont paramétrées (requête préparée ou ORM), jamais construites en
  assemblant du texte.
- Les mots de passe sont hachés avec argon2 ou bcrypt, jamais stockés ni journalisés en clair.
- Les données reçues sont validées côté serveur, même quand le client les vérifie déjà.
