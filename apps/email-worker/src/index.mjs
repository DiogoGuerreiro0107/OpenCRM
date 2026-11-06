import "dotenv/config";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import axios from "axios";
import { uploadAttachment } from "./storage.mjs";
import { readLastUid, writeLastUid } from "./state.mjs";

const {
  EMAIL_ADDRESS,
  EMAIL_PASSWORD,
  IMAP_HOST,
  IMAP_PORT,
  IMAP_SECURE,
  BACKEND_URL,
  INTERNAL_API_KEY,
  SYNC_INTERVAL_MS,
} = process.env;

function log(...args) {
  console.log(`[email-worker] ${new Date().toISOString()}`, ...args);
}

async function ingest(payload) {
  await axios.post(`${BACKEND_URL}/email/ingest`, payload, {
    headers: { "x-internal-api-key": INTERNAL_API_KEY },
  });
}

async function moduleEnabled() {
  try {
    await axios.get(`${BACKEND_URL}/email/worker-status`, { headers: { "x-internal-api-key": INTERNAL_API_KEY } });
    return true;
  } catch (err) {
    if (err.response?.status === 404) return false; // módulo de email desligado no CRM
    throw err;
  }
}

async function syncOnce() {
  const lastUid = readLastUid();
  const client = new ImapFlow({
    host: IMAP_HOST,
    port: Number(IMAP_PORT),
    secure: IMAP_SECURE !== "false",
    auth: { user: EMAIL_ADDRESS, pass: EMAIL_PASSWORD },
    logger: false,
  });

  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  let maxUid = lastUid;

  try {
    const range = `${lastUid + 1}:*`;
    for await (const message of client.fetch(range, { source: true, uid: true }, { uid: true })) {
      if (message.uid <= lastUid) continue;

      try {
        const parsed = await simpleParser(message.source);
        const messageId = parsed.messageId ?? `uid-${message.uid}@${IMAP_HOST}`;

        const attachments = [];
        for (const att of parsed.attachments ?? []) {
          const storageKey = `${EMAIL_ADDRESS}/${message.uid}/${att.filename ?? "anexo"}`;
          await uploadAttachment(storageKey, att.content, att.contentType);
          attachments.push({
            filename: att.filename ?? "anexo",
            mimeType: att.contentType ?? "application/octet-stream",
            size: att.size ?? att.content.length,
            storageKey,
          });
        }

        await ingest({
          accountEmail: EMAIL_ADDRESS,
          messageId,
          fromAddress: parsed.from?.value?.[0]?.address ?? "desconhecido@invalido",
          fromName: parsed.from?.value?.[0]?.name || undefined,
          toAddresses: (parsed.to?.value ?? []).map((v) => v.address).filter(Boolean),
          subject: parsed.subject,
          textBody: parsed.text,
          htmlBody: parsed.html || undefined,
          sentAt: (parsed.date ?? new Date()).toISOString(),
          attachments,
        });

        log(`Sincronizado UID ${message.uid}: ${parsed.subject ?? "(sem assunto)"}`);
      } catch (err) {
        // 404 = o módulo de email foi desligado no CRM a meio do ciclo: parar SEM avançar o UID, para estas
        // mensagens não se perderem (voltam a ser lidas quando o módulo for ligado).
        if (err.response?.status === 404) throw err;
        log(`Erro ao processar UID ${message.uid}:`, err.message);
      }

      if (message.uid > maxUid) maxUid = message.uid;
    }
  } finally {
    lock.release();
    await client.logout(); // também quando o ciclo é interrompido (senão a ligação IMAP ficava aberta)
  }

  if (maxUid > lastUid) writeLastUid(maxUid);
}

let disabledLogged = false;

async function loop() {
  try {
    if (!(await moduleEnabled())) {
      if (!disabledLogged) log("Módulo de email desligado no CRM: a aguardar (não se lê o IMAP nem se avança o UID).");
      disabledLogged = true;
      return;
    }
    disabledLogged = false;
    await syncOnce();
  } catch (err) {
    if (err.response?.status === 404) {
      log("O módulo de email foi desligado a meio do ciclo: ciclo interrompido sem perder mensagens.");
      return;
    }
    log("Falha na sincronização:", err.message);
  }
}

log("A arrancar email-worker...");
await loop();
setInterval(loop, Number(SYNC_INTERVAL_MS ?? 60000));
