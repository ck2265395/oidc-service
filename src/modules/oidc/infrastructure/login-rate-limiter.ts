import { createHmac } from 'node:crypto';


export class LoginRateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('Login attempt limit exceeded');
    this.name = 'LoginRateLimitError';
  }
}

const INCREMENT_SCRIPT = [
  "local accountCount = redis.call('INCR', KEYS[1])",
  "if accountCount == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end",
  "local ipCount = redis.call('INCR', KEYS[2])",
  "if ipCount == 1 then redis.call('EXPIRE', KEYS[2], ARGV[1]) end",
  "local accountTtl = redis.call('TTL', KEYS[1])",
  "local ipTtl = redis.call('TTL', KEYS[2])",
  "if accountCount > tonumber(ARGV[2]) or ipCount > tonumber(ARGV[3]) then",
  "  return {0, math.max(accountTtl, ipTtl), accountCount, ipCount}",
  "end",
  "return {1, 0, accountCount, ipCount}",
].join('\n');

interface RedisEvalClient {
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
}

export class RedisLoginRateLimiter {
  constructor(
    private readonly redis: RedisEvalClient,
    private readonly key: string,
    private readonly windowSeconds = 900,
    private readonly accountLimit = 10,
    private readonly ipLimit = 100,
  ) {}

  async consume(
    accountUuid: string | null,
    loginType: 'username' | 'email',
    identifier: string,
    sourceAddress: string,
  ): Promise<void> {
    const normalizedIdentifier = loginType + ':' + identifier.trim().toLocaleLowerCase('en-US');
    const subject = accountUuid ? 'account:' + accountUuid : 'identifier:' + normalizedIdentifier;
    const accountKey = 'dt:auth:account:' + this.digest(subject);
    const ipKey = 'dt:auth:ip:' + this.digest(sourceAddress || 'unknown');
    const result = await this.redis.eval(INCREMENT_SCRIPT, {
      keys: [accountKey, ipKey],
      arguments: [String(this.windowSeconds), String(this.accountLimit), String(this.ipLimit)],
    });
    if (!Array.isArray(result) || result.length < 2 || Number(result[0]) !== 1) {
      const ttl = Array.isArray(result) ? Number(result[1]) : Number.NaN;
      throw new LoginRateLimitError(Number.isSafeInteger(ttl) && ttl > 0 ? ttl : this.windowSeconds);
    }
  }

  private digest(value: string): string {
    return createHmac('sha256', this.key).update(value, 'utf8').digest('hex');
  }
}
