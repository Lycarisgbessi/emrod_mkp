import nodemailer from 'nodemailer';
import { db } from './db';

/**
 * Optional transactional email (SMTP_URL env, e.g. smtps://user:pass@host:465).
 * Without it, messages are logged to the console — the platform keeps working,
 * buyers simply get their tracking token on-screen only.
 */
const SMTP_URL = process.env.SMTP_URL?.trim();
const SMTP_FROM = process.env.SMTP_FROM?.trim() || 'EMROD Marketplace <no-reply@emroddf.com>';

const transport = SMTP_URL ? nodemailer.createTransport(SMTP_URL) : null;

export const mailerEnabled = Boolean(transport);

function logEmail(to: string, subject: string, status: 'sent' | 'error' | 'skipped', error = ''): void {
  // Fire-and-forget: journalisation best-effort, jamais bloquante
  void db
    .prepare(
      `INSERT INTO email_log (id, to_email, subject, status, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      `mail_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      to,
      subject,
      status,
      error,
      new Date().toISOString()
    )
    .catch(() => {});
}

export function sendMail(opts: { to: string; subject: string; text: string; html: string }): void {
  if (!transport) {
    console.log(`[mailer] SMTP non configuré — courriel non envoyé à ${opts.to} : « ${opts.subject} »`);
    logEmail(opts.to, opts.subject, 'skipped', 'SMTP non configuré');
    return;
  }
  // Fire-and-forget: never block or fail an order because the SMTP relay hiccupped
  transport
    .sendMail({ from: SMTP_FROM, ...opts })
    .then(() => {
      console.log(`[mailer] Courriel envoyé à ${opts.to} : « ${opts.subject} »`);
      logEmail(opts.to, opts.subject, 'sent');
    })
    .catch((err: unknown) => {
      console.error('[mailer] Échec d’envoi :', opts.subject, err);
      logEmail(opts.to, opts.subject, 'error', err instanceof Error ? err.message : String(err));
    });
}

/** Builds the public tracking link from APP_URL (fallback: relative path shown as token). */
export function trackingUrl(token: string): string {
  const base = process.env.APP_URL?.trim().replace(/\/$/, '');
  return base ? `${base}/suivi/${encodeURIComponent(token)}` : `/suivi/${encodeURIComponent(token)}`;
}
