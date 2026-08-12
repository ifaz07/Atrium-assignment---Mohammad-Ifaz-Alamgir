import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import { Request, Response, NextFunction } from 'express';
import { query } from './db';

export const SESSION_COOKIE = 'atrium_session';

const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 12;

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;

  if (!secret || secret === 'change-me') {
    throw new Error('SESSION_SECRET must be set to a private value');
  }

  return secret;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export function createSessionToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return crypto.createHmac('sha256', sessionSecret()).update(token).digest('hex');
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}

type SessionPerson = {
  id: number;
  email: string;
  full_name: string;
  kind: 'admin' | 'coach' | 'participant';
  credits: number;
};

async function currentSessionPerson(token: string | undefined): Promise<SessionPerson | null> {
  if (!token) return null;

  const people = await query<SessionPerson>(
    `select person.id, person.email, person.full_name, person.kind, person.credits
       from app_session
       join person on person.id = app_session.person_id
      where app_session.token_hash = $1
        and app_session.expires_at > now()
        and person.active = true`,
    [hashSessionToken(token)]
  );

  return people[0] ?? null;
}

export async function requireSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const person = await currentSessionPerson(req.cookies ? req.cookies[SESSION_COOKIE] : undefined);

    if (!person) {
      res.status(401).json({ error: 'not signed in' });
      return;
    }

    res.locals.personId = person.id;
    res.locals.person = person;
    next();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'could not validate the session' });
  }
}

export async function login(req: Request, res: Response): Promise<void> {
  const email = req.body ? req.body.email : undefined;
  const password = req.body ? req.body.password : undefined;

  if (!email || !password) {
    res.status(400).json({ error: 'email and password are required' });
    return;
  }

  try {
    const people = await query<SessionPerson & { password_hash: string; active: boolean }>(
      'select id, email, full_name, kind, credits, password_hash, active from person where lower(email) = lower($1)',
      [String(email).trim()]
    );

    const person = people[0];
    if (!person || !person.active || !(await verifyPassword(String(password), person.password_hash))) {
      res.status(401).json({ error: 'invalid email or password' });
      return;
    }

    const token = createSessionToken();
    await query(
      'insert into app_session (person_id, token_hash, expires_at) values ($1, $2, now() + ($3 * interval \'1 millisecond\'))',
      [person.id, hashSessionToken(token), SESSION_MAX_AGE_MS]
    );

    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE_MS,
      secure: process.env.NODE_ENV === 'production'
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

export async function logout(req: Request, res: Response): Promise<void> {
  const token = req.cookies ? req.cookies[SESSION_COOKIE] : undefined;

  if (token) {
    await query('delete from app_session where token_hash = $1', [hashSessionToken(token)]);
  }

  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ signed_out: true });
}

export function me(_req: Request, res: Response): void {
  res.json(res.locals.person);
}
