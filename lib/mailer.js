// lib/mailer.js
// Envoi de l'email de notification lorsqu'un ticket passe au statut « Résolu »,
// via l'API transactionnelle Brevo (https://api.brevo.com/v3/smtp/email).
// Aucune dépendance SMTP : un simple appel HTTP avec la clé API Brevo.
//
// Si BREVO_API_KEY n'est pas configuré (.env), l'envoi est ignoré et
// journalisé — utile en développement, sans faire échouer la mise à jour du ticket.

function isConfigured() {
  return Boolean(process.env.BREVO_API_KEY);
}

async function sendResolutionEmail(ticket) {
  if (!ticket.email) {
    console.log(`[mailer] Ticket ${ticket.numero} résolu, mais aucun email fourni — notification ignorée.`);
    return false;
  }

  const senderEmail = process.env.BREVO_SENDER_EMAIL || "support-silwane@doudah.com";
  const senderName = process.env.BREVO_SENDER_NAME || "Suivi Silwane — SARL BPI/ENH DOUDAH";
  const subject = `Votre déclaration ${ticket.numero} a été résolue`;
  const textContent = [
    `Bonjour${ticket.demandeur ? " " + ticket.demandeur : ""},`,
    "",
    `Votre déclaration ${ticket.numero} (module ${ticket.module || "—"}) a été marquée comme résolue par le service informatique.`,
    "",
    ticket.resolution ? `Résolution : ${ticket.resolution}` : "",
    "",
    `Vous pouvez consulter le détail à tout moment en saisissant votre numéro de ticket sur la page « Vérifier le statut ».`,
    "",
    "SARL BPI/ENH DOUDAH — Service Informatique",
  ]
    .filter(Boolean)
    .join("\n");
  const htmlContent = `<p>${textContent.replace(/\n/g, "<br>")}</p>`;

  if (!isConfigured()) {
    console.log(
      `[mailer] BREVO_API_KEY non configurée — email de résolution pour ${ticket.numero} non envoyé à ${ticket.email}.\n--- contenu prévu ---\n${textContent}\n---------------------`
    );
    return false;
  }

  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "api-key": process.env.BREVO_API_KEY,
      },
      body: JSON.stringify({
        sender: { email: senderEmail, name: senderName },
        to: [{ email: ticket.email, name: ticket.demandeur || undefined }],
        subject,
        textContent,
        htmlContent,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[mailer] Brevo a refusé l'envoi pour ${ticket.numero} (HTTP ${res.status}) : ${body}`);
      return false;
    }

    console.log(`[mailer] Email de résolution envoyé à ${ticket.email} pour ${ticket.numero} via Brevo.`);
    return true;
  } catch (err) {
    console.error(`[mailer] Échec de l'envoi pour ${ticket.numero} :`, err.message);
    return false;
  }
}

module.exports = { sendResolutionEmail, isConfigured };
