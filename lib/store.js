// lib/store.js
// Couche d'accès aux données — PostgreSQL (compatible Neon).

const crypto = require("crypto");
const { pool } = require("./db");

const UPDATABLE_FIELDS = [
  "pris_en_charge_par",
  "escalade_sav",
  "numero_sav",
  "statut",
  "date_resolution",
  "resolution",
];

// Champs renvoyés à l'espace client pour la vérification de statut
// (on ne renvoie jamais les notes internes destinées au service informatique).
const PUBLIC_LOOKUP_FIELDS = [
  "numero",
  "date_creation",
  "module",
  "gravite",
  "statut",
  "date_resolution",
  "resolution",
];

function rowToTicket(row) {
  if (!row) return null;
  return {
    ...row,
    date_creation: row.date_creation ? toDateString(row.date_creation) : "",
    date_resolution: row.date_resolution ? toDateString(row.date_resolution) : "",
    captures: row.captures || [],
  };
}

function toDateString(d) {
  // pg renvoie les colonnes DATE comme des objets Date (heure locale du serveur) ;
  // on les reformate en 'YYYY-MM-DD' pour rester cohérent avec le frontend.
  if (typeof d === "string") return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

async function listTickets() {
  const { rows } = await pool.query("SELECT * FROM tickets ORDER BY created_at DESC");
  return rows.map(rowToTicket);
}

async function getTicket(id) {
  const { rows } = await pool.query("SELECT * FROM tickets WHERE id = $1", [id]);
  return rowToTicket(rows[0]);
}

async function getTicketByNumeroPublic(numero) {
  const { rows } = await pool.query("SELECT * FROM tickets WHERE numero = $1", [numero.trim()]);
  const ticket = rowToTicket(rows[0]);
  if (!ticket) return null;
  const publicTicket = {};
  for (const key of PUBLIC_LOOKUP_FIELDS) publicTicket[key] = ticket[key];
  return publicTicket;
}

async function nextTicketNumber(client, year) {
  // Verrou consultatif transactionnel : sérialise l'attribution du numéro
  // pour cette année sans bloquer les autres opérations sur la table.
  const lockKey = 7700000 + year;
  await client.query("SELECT pg_advisory_xact_lock($1)", [lockKey]);
  const { rows } = await client.query("SELECT COUNT(*)::int AS n FROM tickets WHERE numero LIKE $1", [
    `INC-${year}-%`,
  ]);
  const seq = rows[0].n + 1;
  return `INC-${year}-${String(seq).padStart(4, "0")}`;
}

async function createTicket(fields) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const year = new Date().getFullYear();
    const numero = await nextTicketNumber(client, year);
    const id = "tk_" + Date.now().toString(36) + crypto.randomBytes(4).toString("hex");
    const service = fields.service === "Autre" ? fields.service_autre || "Autre" : fields.service || "";

    const { rows } = await client.query(
      `INSERT INTO tickets
        (id, numero, demandeur, email, service, module, gravite, description,
         message_erreur, actions_tentees, captures)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        id,
        numero,
        fields.demandeur || "",
        fields.email || "",
        service,
        fields.module || "",
        fields.gravite || "Faible",
        fields.description || "",
        fields.message_erreur || "",
        fields.actions_tentees || "",
        JSON.stringify(fields.captures || []),
      ]
    );
    await client.query("COMMIT");
    return rowToTicket(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function updateTicket(id, patch) {
  const sets = [];
  const values = [];
  let i = 1;
  for (const key of UPDATABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      sets.push(`${key} = $${i++}`);
      values.push(patch[key] === "" && key === "date_resolution" ? null : patch[key]);
    }
  }
  if (sets.length === 0) return getTicket(id);
  sets.push(`updated_at = now()`);
  values.push(id);

  const { rows } = await pool.query(
    `UPDATE tickets SET ${sets.join(", ")} WHERE id = $${i} RETURNING *`,
    values
  );
  return rowToTicket(rows[0]);
}

async function markNotificationSent(id) {
  await pool.query("UPDATE tickets SET notification_envoyee = TRUE WHERE id = $1", [id]);
}

module.exports = {
  listTickets,
  getTicket,
  getTicketByNumeroPublic,
  createTicket,
  updateTicket,
  markNotificationSent,
};
