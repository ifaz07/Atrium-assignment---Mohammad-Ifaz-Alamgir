import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

let transporter: Transporter | null = null;

export function mailTransport(): Transporter {
  if (transporter) return transporter;

  const port = Number(process.env.SMTP_PORT || 1025);
  const user = process.env.SMTP_USER;
  const password = process.env.SMTP_PASSWORD;

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'localhost',
    port,
    secure: port === 465,
    auth: user ? { user, pass: password || '' } : undefined
  });

  return transporter;
}
