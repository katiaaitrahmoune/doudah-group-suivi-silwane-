# Suivi support — ERP Silwane
SARL BPI/ENH DOUDAH — Service Informatique

Outil de déclaration et de suivi des pannes rencontrées sur l'ERP Silwane, avec deux
espaces séparés :

- **Espace client** (`/`) — formulaire public de déclaration de panne, et une
  page pour **vérifier le statut** d'une déclaration à partir de son numéro de
  ticket. Aucune authentification.
- **Espace informatique** (`/informatique`) — registre des tickets, filtres, et
  fiche de traitement (prise en charge, escalade SAV, statut, résolution).
  Protégé par un code d'accès partagé.

Les données sont stockées dans une base **PostgreSQL** (compatible [Neon](https://neon.tech)).

## Installation

Prérequis : [Node.js](https://nodejs.org) 18+ et une base PostgreSQL (Neon ou locale).

### 1. Créer la base sur Neon

1. Créer un compte sur [neon.tech](https://neon.tech) et un nouveau projet.
2. Dans **Connection Details**, copier la *connection string* (choisir
   "Pooled connection" pour un usage en production). Elle ressemble à :
   ```
   postgresql://<user>:<password>@<host>-pooler.<region>.aws.neon.tech/<db>?sslmode=require
   ```
3. Aucune commande SQL à lancer manuellement : le serveur crée la table
   `tickets` automatiquement au démarrage (`lib/db.js`). Le fichier `schema.sql`
   est fourni pour référence si vous préférez l'exécuter vous-même (onglet
   *SQL Editor* de Neon).

### 2. Configurer et démarrer le serveur

```bash
cd suivi-silwane
npm install
cp .env.example .env
# éditer .env : coller DATABASE_URL (Neon), changer IT_PASSCODE et SESSION_SECRET
npm start
```

Le serveur démarre sur **http://localhost:3000** :

- Espace client : http://localhost:3000/
- Espace informatique : http://localhost:3000/informatique (code d'accès défini dans `.env`)

### 3. (Optionnel) Notifications par email — Brevo

Quand un ticket passe au statut **Résolu**, un email est envoyé automatiquement
au demandeur *s'il a renseigné son email* à la déclaration. Sans clé API Brevo,
cet envoi est simplement journalisé dans la console (rien n'échoue).

1. Créer un compte gratuit sur [brevo.com](https://www.brevo.com) (300 emails/jour offerts).
2. Vérifier un expéditeur : **Paramètres > Expéditeurs & IP > Ajouter un expéditeur**
   (ex. `support-silwane@doudah.com`, ou une adresse déjà vérifiée sur le domaine `doudah.com`).
3. Générer une clé API : **Paramètres > Clés API (SMTP & API) > Générer une nouvelle clé API**.
4. Renseigner dans `.env` :
   ```
   BREVO_API_KEY=xkeysib-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   BREVO_SENDER_EMAIL=support-silwane@doudah.com
   BREVO_SENDER_NAME=Suivi Silwane — SARL BPI/ENH DOUDAH
   ```

L'envoi passe par l'API transactionnelle de Brevo (`lib/mailer.js`, simple appel
HTTP — aucune dépendance SMTP à installer).

## Structure du projet

```
suivi-silwane/
  server.js                serveur Express (routes, auth, API)
  lib/
    db.js                    connexion PostgreSQL + création du schéma
    store.js                 requêtes SQL (tickets)
    mailer.js                envoi de l'email de résolution (API Brevo)
  schema.sql                 schéma de référence (créé aussi automatiquement)
  uploads/                   captures d'écran jointes aux tickets
  public/
    client.html                déclaration + vérification de statut (utilisateur)
    informatique.html           registre & traitement (service informatique)
    login.html                    écran d'accès de l'espace informatique
    assets/doudah-logo.png
  .env.example
```

## API

| Méthode | Route                        | Accès       | Description                                  |
|---------|------------------------------|-------------|-----------------------------------------------|
| POST    | `/api/tickets`               | public      | Créer un ticket (multipart/form-data)          |
| GET     | `/api/tickets/lookup?numero=`| public      | Statut d'un ticket par son numéro (champs limités) |
| GET     | `/api/tickets`                | espace SI   | Lister tous les tickets                        |
| PATCH   | `/api/tickets/:id`             | espace SI   | Mettre à jour le suivi d'un ticket (déclenche l'email si passage à "Résolu") |
| GET     | `/uploads/:fichier`             | espace SI   | Récupérer une capture jointe                    |

`/api/tickets/lookup` ne renvoie jamais les champs internes réservés au service
informatique (demandeur, email, prise en charge, escalade SAV...) — uniquement
numéro, date, module, gravité, statut, date de résolution et le commentaire de
résolution.

## Notes de conception

- **Base de données** : PostgreSQL (Neon en production, n'importe quel Postgres
  en développement). Le schéma est créé automatiquement au démarrage
  (`CREATE TABLE IF NOT EXISTS`) — aucune migration manuelle nécessaire pour ce
  volume de données.
- **Numérotation des tickets** : format `INC-<année>-<0001>`, généré de façon
  sûre en cas d'accès concurrents grâce à un verrou transactionnel PostgreSQL
  (`pg_advisory_xact_lock`).
- **Vérification de statut côté client** : recherche par numéro de ticket
  uniquement (comme un suivi de colis) — pas de mot de passe, car l'outil est
  interne à l'entreprise et le numéro seul n'expose aucune information sensible.
- **Notification par email** : envoyée via l'API transactionnelle Brevo, une
  seule fois, à la première bascule vers "Résolu" (`notification_envoyee`
  empêche les doublons si le statut est modifié plusieurs fois). Sans email
  renseigné à la déclaration, le client doit revenir vérifier via son numéro
  de ticket.
- **Authentification SI** : un code d'accès partagé, volontairement simple pour
  un service informatique à faible effectif. Si plusieurs agents SI doivent être
  distingués nommément dans l'historique des tickets, relier cette authentification
  aux comptes utilisateurs Silwane existants (cf. Volet 1 du stage) plutôt que
  d'ajouter des mots de passe supplémentaires.
- **Captures d'écran** : limitées aux images, 8 Mo et 6 fichiers par ticket ;
  stockées sur disque (`uploads/`), leurs métadonnées dans une colonne JSONB ;
  uniquement consultables depuis l'espace informatique.
- **Identité visuelle** : couleurs et logo repris de SARL BPI/ENH DOUDAH
  (vert institutionnel, liseré or, badge du logo).
