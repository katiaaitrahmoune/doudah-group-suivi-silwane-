// server.js
// Backend de l'outil "Suivi support — ERP Silwane" (SARL BPI/ENH DOUDAH).
//
// Deux espaces distincts servis par ce même serveur :
//   - Espace client   : /                  (public, aucune authentification)
//   - Espace SI        : /informatique       (protégé par un code d'accès)
//
// API JSON consommée par les deux pages :
//   POST   /api/tickets          créer un ticket (multipart/form-data)
//   GET    /api/tickets          lister les tickets       [réservé SI]
//   PATCH  /api/tickets/:id      mettre à jour un ticket   [réservé SI]
//   GET    /uploads/:file        récupérer une capture jointe [réservé SI]

const express = require("express");
const multer = require("multer");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// Petit chargeur de .env fait main (évite une dépendance supplémentaire).
// Doit s'exécuter avant tout require() qui lit process.env (lib/db, lib/mailer...).
(function loadEnvFile() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
})();

const store = require("./lib/store");
const { migrate } = require("./lib/db");
const mailer = require("./lib/mailer");

const app = express();
const PORT = process.env.PORT || 3000;
const IT_PASSCODE = process.env.IT_PASSCODE || "doudah-si-2026";
const SESSION_SECRET = process.env.SESSION_SECRET || "change-this-secret";

const UPLOAD_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ------------------------------------------------------------------ */
/* Authentification très simple pour l'espace « service informatique » */
/* Un seul code d'accès partagé (défini dans .env) protège le tableau  */
/* de bord SI et l'API de lecture/écriture des tickets.                */
/* Suffisant pour un outil interne à faible effectif ; si le nombre    */
/* d'agents SI augmente, relier ce contrôle aux comptes Silwane        */
/* existants plutôt que d'ajouter des mots de passe supplémentaires.   */
/* ------------------------------------------------------------------ */
const SESSION_COOKIE = "si_session";

function signSession() {
  const payload = `si:${Date.now()}`;
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

function isValidSession(token) {
  if (!token || typeof token !== "string") return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

function requireSiAuth(req, res, next) {
  if (isValidSession(req.cookies[SESSION_COOKIE])) return next();
  if (req.path.startsWith("/api/")) {
    return res.status(401).json({ error: "Authentification requise." });
  }
  return res.redirect("/informatique/login");
}

/* ------------------------------------------------------------------ */
/* Upload des captures d'écran jointes à une déclaration               */
/* ------------------------------------------------------------------ */
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safeExt = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, "");
    const name = crypto.randomBytes(8).toString("hex") + safeExt;
    cb(null, name);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024, files: 6 },
  fileFilter: (req, file, cb) => {
    if (!/^image\//.test(file.mimetype)) return cb(new Error("Seules les images sont acceptées."));
    cb(null, true);
  },
});

/* ------------------------------------------------------------------ */
/* Pages statiques                                                     */
/* ------------------------------------------------------------------ */
app.use("/assets", express.static(path.join(__dirname, "public", "assets")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/informatique/login", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.post("/informatique/login", (req, res) => {
  const { passcode } = req.body;
  if (passcode && passcode === IT_PASSCODE) {
    res.cookie(SESSION_COOKIE, signSession(), {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 12 * 60 * 60 * 1000, // 12h
    });
    return res.redirect("/informatique");
  }
  return res.redirect("/informatique/login?erreur=1");
});

app.post("/informatique/logout", (req, res) => {
  res.clearCookie(SESSION_COOKIE);
  res.redirect("/informatique/login");
});

app.get("/informatique", requireSiAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "informatique.html"));
});

// Les captures jointes ne sont accessibles qu'au service informatique.
app.use("/uploads", requireSiAuth, express.static(UPLOAD_DIR));

/* ------------------------------------------------------------------ */
/* API tickets                                                         */
/* ------------------------------------------------------------------ */
app.post("/api/tickets", upload.array("captures", 6), async (req, res) => {
  try {
    const captures = (req.files || []).map((f) => ({
      filename: f.filename,
      originalName: f.originalname,
    }));
    const ticket = await store.createTicket({ ...req.body, captures });
    res.status(201).json(ticket);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message || "Impossible de créer le ticket." });
  }
});

app.get("/api/tickets", requireSiAuth, async (req, res) => {
  const tickets = await store.listTickets();
  res.json(tickets);
});

// Vérification publique du statut d'un ticket par son numéro — aucune
// authentification requise, mais seul un sous-ensemble de champs "sûrs"
// est renvoyé (jamais les notes internes du service informatique).
app.get("/api/tickets/lookup", async (req, res) => {
  const numero = (req.query.numero || "").trim();
  if (!numero) return res.status(400).json({ error: "Numéro de ticket requis." });
  try {
    const ticket = await store.getTicketByNumeroPublic(numero);
    if (!ticket) return res.status(404).json({ error: "Aucun ticket ne correspond à ce numéro." });
    res.json(ticket);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur." });
  }
});

app.patch("/api/tickets/:id", requireSiAuth, async (req, res) => {
  const before = await store.getTicket(req.params.id);
  if (!before) return res.status(404).json({ error: "Ticket introuvable." });

  const updated = await store.updateTicket(req.params.id, req.body || {});

  // Notifie le demandeur par email au passage au statut "Résolu" (une seule fois).
  if (updated.statut === "Résolu" && before.statut !== "Résolu" && !updated.notification_envoyee) {
    const sent = await mailer.sendResolutionEmail(updated);
    if (sent) await store.markNotificationSent(updated.id);
  }

  res.json(updated);
});

/* ------------------------------------------------------------------ */
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Erreur serveur." });
});

async function start() {
  try {
    await migrate();
    console.log("Schéma PostgreSQL vérifié/créé.");
  } catch (err) {
    console.error("Échec de la migration du schéma :", err.message);
    process.exit(1);
  }
  if (!mailer.isConfigured()) {
    console.log("Brevo non configuré (BREVO_API_KEY manquante) — les emails de résolution seront journalisés, pas envoyés (voir .env).");
  }
  app.listen(PORT, () => {
    console.log(`Suivi Silwane — serveur démarré sur http://localhost:${PORT}`);
    console.log(`  Espace client       : http://localhost:${PORT}/`);
    console.log(`  Espace informatique : http://localhost:${PORT}/informatique`);
  });
}

start();
