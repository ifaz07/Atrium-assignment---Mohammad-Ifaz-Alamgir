import type { PoolClient } from 'pg';

export type OutboxMessage = {
  recipient: string;
  subject: string;
  bodyText: string;
  eventKey?: string;
};

export async function queueEmail(client: PoolClient, message: OutboxMessage): Promise<void> {
  await client.query(
    `insert into email_outbox (event_key, recipient, subject, body_text)
     values ($1, $2, $3, $4)
     on conflict (event_key) do nothing`,
    [message.eventKey ?? null, message.recipient, message.subject, message.bodyText]
  );
}

export async function queueAdministrators(
  client: PoolClient,
  message: Omit<OutboxMessage, 'recipient' | 'eventKey'>,
  eventKeyPrefix: string
): Promise<void> {
  const administrators = await client.query<{ id: number; email: string }>(
    "select id, email from person where kind = 'admin' and active = true"
  );

  for (const administrator of administrators.rows) {
    await queueEmail(client, {
      ...message,
      recipient: administrator.email,
      eventKey: `${eventKeyPrefix}:admin:${administrator.id}`
    });
  }
}
