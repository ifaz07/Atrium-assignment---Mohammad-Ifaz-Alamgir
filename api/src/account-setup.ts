import crypto from 'node:crypto';
import { Request, Response } from 'express';
import { hashPassword } from './auth';
import { query, withTransaction } from './db';

export function createSetupToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashSetupToken(token: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret === 'change-me') throw new Error('SESSION_SECRET must be set to a private value');
  return crypto.createHmac('sha256', secret).update(`account-setup:${token}`).digest('hex');
}

export async function setPassword(req: Request, res: Response): Promise<void> {
  const token = typeof req.body?.token === 'string' ? req.body.token : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!token || password.length < 12) {
    res.status(400).json({ error: 'a valid setup token and a password of at least 12 characters are required' });
    return;
  }
  try {
    await withTransaction(async (client) => {
      const tokens = await client.query<{ id: number; person_id: number }>(
        `select id, person_id from account_setup_token
          where token_hash = $1 and used_at is null and expires_at > now() for update`,
        [hashSetupToken(token)]
      );
      if (tokens.rowCount === 0) throw new Error('invalid');
      await client.query('update person set password_hash = $1 where id = $2', [await hashPassword(password), tokens.rows[0].person_id]);
      await client.query('update account_setup_token set used_at = now() where id = $1', [tokens.rows[0].id]);
    }, 'serializable');
    res.json({ password_set: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'invalid') { res.status(400).json({ error: 'this setup link is invalid or expired' }); return; }
    console.error(error); res.status(500).json({ error: 'could not set password' });
  }
}
