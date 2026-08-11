import crypto from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
import { query } from './db';

export const SESSION_COOKIE = 'atrium_session';

const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 12;

function sessionSecret(): string {
  return process.env.SESSION_SECRET || 'change-me';
}

export function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

export function signSession(personId: number, issuedAt: number = Date.now()): string {
  const payload = `${personId}.${issuedAt}`;
  const mac = crypto.createHmac('sha256', sessionSecret()).update(payload).digest('hex');
  return `${payload}.${mac}`;
}

export function readSession(cookie: string | undefined): { personId: number; issuedAt: number } | null {
  if (!cookie) return null;

  const parts = cookie.split('.');
  if (parts.length !== 3) return null;

  const payload = `${parts[0]}.${parts[1]}`;
  const mac = crypto.createHmac('sha256', sessionSecret()).update(payload).digest('hex');
  if (mac !== parts[2]) return null;

  const personId = Number(parts[0]);
  const issuedAt = Number(parts[1]);
  if (!Number.isInteger(personId) || !Number.isFinite(issuedAt)) return null;
  if (Date.now() - issuedAt > SESSION_MAX_AGE_MS) return null;

  return { personId, issuedAt };
}

export function requireSession(req: Request, res: Response, next: NextFunction): void {
  const session = readSession(req.cookies ? req.cookies[SESSION_COOKIE] : undefined);
  if (!session) {
    res.status(401).json({ error: 'not signed in' });
    return;
  }
  res.locals.personId = session.personId;
  next();
}

export async function login(req: Request, res: Response): Promise<void> {
  const email = req.body ? req.body.email : undefined;
  const password = req.body ? req.body.password : undefined;

  if (!email || !password) {
    res.status(400).json({ error: 'email and password are required' });
    return;
  }

  try {
    const people = await query(
      'select id, email, full_name, kind, password_hash from person where email = $1',
      [email]
    );

    if (people.length === 0) {
      res.status(401).json({ error: 'no such user' });
      return;
    }

    const person = people[0];
    if (hashPassword(password) !== person.password_hash) {
      res.status(401).json({ error: 'wrong password' });
      return;
    }

    res.cookie(SESSION_COOKIE, signSession(person.id), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE_MS
    });

    res.json({
      id: person.id,
      email: person.email,
      full_name: person.full_name,
      kind: person.kind
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'could not sign in' });
  }
}

export function logout(_req: Request, res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ signed_out: true });
}

export async function me(_req: Request, res: Response): Promise<void> {
  try {
    const people = await query(
      'select id, email, full_name, kind, credits, active from person where id = $1',
      [res.locals.personId]
    );

    if (people.length === 0) {
      res.status(401).json({ error: 'not signed in' });
      return;
    }

    res.json(people[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'could not load the current user' });
  }
}
