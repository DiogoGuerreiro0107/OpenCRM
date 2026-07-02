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
        log(`Erro ao processar UID ${message.uid}:`, err.message);
      }

      if (message.uid > maxUid) maxUid = message.uid;
    }
  } finally {
    lock.release();
  }

  await client.logout();

  if (maxUid > lastUid) writeLastUid(maxUid);
}

async function loop() {
  try {
    await syncOnce();
  } catch (err) {
    log("Falha na sincronização:", err.message);
  }
}

log("A arrancar email-worker...");
await loop();
setInterval(loop, Number(SYNC_INTERVAL_MS ?? 60000));
