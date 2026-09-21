

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
