// lib/db.js
// Connexion PostgreSQL (compatible Neon) et migration de schéma minimale.

const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.error(
    "DATABASE_URL manquant. Renseignez la chaîne de connexion Neon/PostgreSQL dans le fichier .env (voir .env.example)."
  );
  process.exit(1);
}

// Neon exige une connexion chiffrée. `sslmode=require` dans l'URL suffit
// généralement, mais on force aussi l'option ici pour couvrir les
// certificats auto-signés de certains environnements de développement.
const useSsl = !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
});

pool.on("error", (err) => {
  console.error("Erreur inattendue du pool PostgreSQL :", err.message);
});

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS tickets (
    id                   TEXT PRIMARY KEY,
    numero               TEXT UNIQUE NOT NULL,
    date_creation        DATE NOT NULL DEFAULT CURRENT_DATE,
    demandeur            TEXT NOT NULL DEFAULT '',
    email                TEXT NOT NULL DEFAULT '',
    service              TEXT NOT NULL DEFAULT '',
    module               TEXT NOT NULL DEFAULT '',
    gravite              TEXT NOT NULL DEFAULT 'Faible',
    description          TEXT NOT NULL DEFAULT '',
    message_erreur       TEXT NOT NULL DEFAULT '',
    actions_tentees      TEXT NOT NULL DEFAULT '',
    captures             JSONB NOT NULL DEFAULT '[]'::jsonb,
    pris_en_charge_par   TEXT NOT NULL DEFAULT '',
    escalade_sav         TEXT NOT NULL DEFAULT 'Non',
    numero_sav           TEXT NOT NULL DEFAULT '',
    statut               TEXT NOT NULL DEFAULT 'Ouvert',
    date_resolution      DATE,
    resolution           TEXT NOT NULL DEFAULT '',
    notification_envoyee BOOLEAN NOT NULL DEFAULT FALSE,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_tickets_numero ON tickets (numero);
  CREATE INDEX IF NOT EXISTS idx_tickets_statut ON tickets (statut);
`;

async function migrate() {
  await pool.query(SCHEMA);
}

module.exports = { pool, migrate };
