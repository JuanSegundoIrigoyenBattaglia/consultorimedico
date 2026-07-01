const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { logger } = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

exports.enviarConfirmacionTurno = onDocumentCreated("turnos/{turnoId}", async (event) => {
  const appointment = event.data.data();

  if (appointment.estado !== "pendiente") {
    return;
  }

  await notifyAppointment({
    appointment,
    subject: "Turno confirmado",
    message: `Tu turno fue confirmado para el ${appointment.fecha} a las ${appointment.horario}.`
  });
});

exports.enviarCancelacionTurno = onDocumentUpdated("turnos/{turnoId}", async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();

  if (before.estado === after.estado || after.estado !== "cancelado") {
    return;
  }

  await notifyAppointment({
    appointment: after,
    subject: "Turno cancelado",
    message: `Tu turno del ${after.fecha} a las ${after.horario} fue cancelado.`
  });
});

async function notifyAppointment({ appointment, subject, message }) {
  const tasks = [];

  if (process.env.BREVO_API_KEY && appointment.pacienteEmail) {
    tasks.push(sendEmail({ appointment, subject, message }));
  }

  if (
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_WHATSAPP_FROM &&
    appointment.telefono
  ) {
    tasks.push(sendWhatsApp({ appointment, message }));
  }

  if (!tasks.length) {
    logger.warn("No hay proveedor de notificaciones configurado.");
    return;
  }

  await Promise.allSettled(tasks);
}

async function sendEmail({ appointment, subject, message }) {
  const fromEmail = process.env.MAIL_FROM_EMAIL;
  const fromName = process.env.MAIL_FROM_NAME || "Consultorio odontologico";

  if (!fromEmail) {
    logger.warn("Falta MAIL_FROM_EMAIL para enviar email.");
    return;
  }

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": process.env.BREVO_API_KEY,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      sender: { email: fromEmail, name: fromName },
      to: [{ email: appointment.pacienteEmail, name: appointment.nombre }],
      subject,
      htmlContent: `
        <p>Hola ${escapeHtml(appointment.nombre)},</p>
        <p>${escapeHtml(message)}</p>
        <p>Consultorio odontologico</p>
      `
    })
  });

  if (!response.ok) {
    logger.error("No se pudo enviar email.", {
      status: response.status,
      body: await response.text()
    });
  }
}

async function sendWhatsApp({ appointment, message }) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM;
  const to = normalizeWhatsAppNumber(appointment.telefono);

  if (!to) {
    logger.warn("Telefono no valido para WhatsApp.", { telefono: appointment.telefono });
    return;
  }

  const form = new URLSearchParams({
    From: from,
    To: `whatsapp:${to}`,
    Body: message
  });

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: form
  });

  if (!response.ok) {
    logger.error("No se pudo enviar WhatsApp.", {
      status: response.status,
      body: await response.text()
    });
  }
}

function normalizeWhatsAppNumber(phone) {
  const digits = String(phone || "").replace(/\D/g, "");

  if (!digits) {
    return "";
  }

  if (digits.startsWith("54")) {
    return `+${digits}`;
  }

  return `+54${digits}`;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
