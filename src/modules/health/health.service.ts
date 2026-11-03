import { Inject, Injectable, Optional } from '@nestjs/common';

import { ACCOUNT_POOL, OIDC_POOL, REDIS_COMMAND, REDIS_SUBSCRIBER } from '../../common/tokens/injection-tokens.js';

interface Probe { query?(sql: string): Promise<unknown>; ping?(): Promise<unknown>; }

@Injectable()
export class HealthService {
  constructor(
    @Optional() @Inject(OIDC_POOL) private readonly oidc?: Probe,
    @Optional() @Inject(ACCOUNT_POOL) private readonly accounts?: Probe,
    @Optional() @Inject(REDIS_COMMAND) private readonly command?: Probe,
    @Optional() @Inject(REDIS_SUBSCRIBER) private readonly subscriber?: Probe,
  ) {}

  async ready(): Promise<void> {
    if (!this.oidc?.query || !this.accounts?.query || !this.command?.ping || !this.subscriber?.ping) {
      throw new Error('Readiness dependencies are not configured');
    }
    await Promise.all([
      this.oidc.query('SELECT 1'), this.accounts.query('SELECT 1'), this.command.ping(), this.subscriber.ping(),
    ]);
  }
}
