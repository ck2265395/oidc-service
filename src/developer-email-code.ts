import { createHmac, randomInt } from 'node:crypto';

export type DeveloperEmailCodePurpose = 'register' | 'bind' | 'reset';

interface EmailCodeRedis {
  set(key: string, value: string, options: { NX?: boolean; EX: number }): Promise<string | null>;
  getDel(key: string): Promise<string | null>;
  del(key: string): Promise<number>;
}

function token(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value, 'utf8').digest('hex');
}

export class DeveloperEmailCode {
  constructor(
    private readonly redis: EmailCodeRedis,
    private readonly secret: string,
    private readonly send: (email: string, code: string) => Promise<void>,
    private readonly createCode: () => string = () => String(randomInt(0, 1_000_000)).padStart(6, '0'),
  ) {
    if (secret.length < 32) throw new TypeError('Developer email code secret is too short');
  }

  private codeKey(purpose: DeveloperEmailCodePurpose, email: string, code: string): string {
    return `developer:email-code:${token(this.secret, `${purpose}\0${email}\0${code}`)}`;
  }

  async issue(purpose: DeveloperEmailCodePurpose, email: string, ip: string): Promise<'sent'> {
    const rateKey = `developer:email-code-rate:${token(this.secret, `${purpose}\0${email}\0${ip}`)}`;
    const claimed = await this.redis.set(rateKey, '1', { NX: true, EX: 60 });
    if (claimed !== 'OK') throw new Error('A verification code was sent recently');
    const code = this.createCode();
    if (!/^\d{6}$/.test(code)) throw new TypeError('Developer email code generator returned an invalid code');
    const key = this.codeKey(purpose, email, code);
    try {
      await this.redis.set(key, JSON.stringify({ purpose, email }), { EX: 600 });
      await this.send(email, code);
      return 'sent';
    } catch (error) {
      await Promise.allSettled([this.redis.del(key), this.redis.del(rateKey)]);
      throw error;
    }
  }

  async consume(purpose: DeveloperEmailCodePurpose, email: string, code: string): Promise<boolean> {
    if (!/^\d{6}$/.test(code)) return false;
    const raw = await this.redis.getDel(this.codeKey(purpose, email, code));
    if (!raw) return false;
    try {
      const value = JSON.parse(raw) as { purpose?: unknown; email?: unknown };
      return value.purpose === purpose && value.email === email;
    } catch {
      return false;
    }
  }
}
