import { createHash, randomBytes } from 'node:crypto';

import type { RedisClientType } from 'redis';

import type { ApplicationService } from './platform.js';

interface VerificationPayload {
  accountUuid: string;
  contactEmail: string;
}

export class EmailVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmailVerificationError';
  }
}

function verificationKey(token: string): string {
  return 'dt:developer-email-verification:' + createHash('sha256').update(token).digest('hex');
}

function rateLimitKey(accountUuid: string): string {
  return 'dt:developer-email-verification-rate:' + createHash('sha256').update(accountUuid).digest('hex');
}

export class DeveloperEmailVerification {
  constructor(
    private readonly redis: RedisClientType,
    private readonly applications: ApplicationService,
    private readonly issuer: string,
    private readonly sendMail: (to: string, link: string) => Promise<void>,
  ) {}

  async request(accountUuid: string): Promise<'sent' | 'already_verified'> {
    const profile = await this.applications.getDeveloperProfile(accountUuid);
    if (!profile) throw new EmailVerificationError('Register a developer profile first');
    if (profile.contactEmailVerified) return 'already_verified';

    const rateKey = rateLimitKey(accountUuid);
    const claimed = await this.redis.set(rateKey, '1', { NX: true, EX: 300 });
    if (claimed !== 'OK') throw new EmailVerificationError('A verification email was sent recently');

    const token = randomBytes(32).toString('base64url');
    const payload: VerificationPayload = {
      accountUuid: profile.accountUuid,
      contactEmail: profile.contactEmail,
    };
    const tokenKey = verificationKey(token);
    try {
      await this.redis.set(tokenKey, JSON.stringify(payload), { EX: 1800 });
      const link = new URL('/api/v1/developer/verify-email', this.issuer);
      link.searchParams.set('token', token);
      await this.sendMail(profile.contactEmail, link.toString());
      return 'sent';
    } catch {
      await Promise.allSettled([this.redis.del(tokenKey), this.redis.del(rateKey)]);
      throw new EmailVerificationError('Email delivery is unavailable');
    }
  }

  async consume(token: string): Promise<boolean> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
    const raw = await this.redis.getDel(verificationKey(token));
    if (!raw) return false;
    let payload: unknown;
    try {
      payload = JSON.parse(raw) as unknown;
    } catch {
      return false;
    }
    if (
      typeof payload !== 'object' || payload === null || Array.isArray(payload) ||
      typeof (payload as Record<string, unknown>).accountUuid !== 'string' ||
      typeof (payload as Record<string, unknown>).contactEmail !== 'string'
    ) return false;
    const value = payload as VerificationPayload;
    if (value.accountUuid.length < 1 || value.accountUuid.length > 255 || value.contactEmail.length > 254) return false;
    return this.applications.verifyDeveloperEmail(value.accountUuid, value.contactEmail);
  }
}

export function createVerificationMailer(config: {
  host: string;
  port: number;
  secure: boolean;
  user: string | null;
  password: string | null;
  from: string;
}): (to: string, link: string) => Promise<void> {
  // Loaded only when SMTP is enabled so deployments without a mail relay can still start.
  return async (to, link) => {
    const nodemailer = await import('nodemailer');
    const transport = nodemailer.default.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      requireTLS: !config.secure,
      auth: config.user && config.password ? { user: config.user, pass: config.password } : undefined,
      tls: { minVersion: 'TLSv1.2' },
    });
    try {
      await transport.sendMail({
        from: config.from,
        to,
        subject: 'Verify your DT Identity contact email',
        text: 'Open this link to verify your DT Identity contact email. This link expires in 30 minutes:\n' + link,
        html: '<p>Open this link to verify your DT Identity contact email. This link expires in 30 minutes:</p><p><a href="' +
          link.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!) +
          '">Verify contact email</a></p>',
      });
    } finally {
      transport.close();
    }
  };
}
