import { pool } from '../db';
import { mailTransport } from './transport';

type PendingEmail = {
  id: string;
  recipient: string;
  subject: string;
  body_text: string;
};

type SendEmail = (message: { from: string; to: string; subject: string; text: string }) => Promise<unknown>;

async function sendThroughConfiguredTransport(message: Parameters<SendEmail>[0]): Promise<unknown> {
  return mailTransport().sendMail(message);
}

export async function deliverPendingEmails(limit = 25, sendEmail: SendEmail = sendThroughConfiguredTransport): Promise<number> {
  const client = await pool.connect();
  const claimed: PendingEmail[] = [];

  try {
    await client.query('begin');
    const result = await client.query<PendingEmail>(
      `select id, recipient, subject, body_text
         from email_outbox
        where status in ('pending', 'sending') and available_at <= now()
        order by id
        for update skip locked
        limit $1`,
      [limit]
    );

    for (const message of result.rows) {
      await client.query("update email_outbox set status = 'sending', attempts = attempts + 1, available_at = now() + interval '5 minutes' where id = $1", [message.id]);
      claimed.push(message);
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }

  for (const message of claimed) {
    try {
      await sendEmail({
        from: process.env.MAIL_FROM || 'no-reply@atrium.local',
        to: message.recipient,
        subject: message.subject,
        text: message.body_text
      });
      await pool.query("update email_outbox set status = 'sent', sent_at = now(), last_error = null where id = $1", [message.id]);
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      await pool.query(
        `update email_outbox
            set status = 'pending', last_error = $1,
                available_at = now() + make_interval(secs => least(300, 5 * attempts))
          where id = $2`,
        [details.slice(0, 1000), message.id]
      );
    }
  }

  return claimed.length;
}

export function startEmailWorker(): NodeJS.Timeout {
  void deliverPendingEmails().catch(console.error);
  return setInterval(() => void deliverPendingEmails().catch(console.error), 5000);
}
