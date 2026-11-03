import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';

import { MAILER } from '../../common/tokens/injection-tokens.js';
import { createVerificationMailer } from '../../email-verification.js';
import { ConfigService } from '../config/config.service.js';

export type VerificationMailer = ReturnType<typeof createVerificationMailer>;

@Injectable()
export class EmailLifecycle implements OnApplicationShutdown {
  private closed = false;
  constructor(@Inject(MAILER) private readonly mailer: VerificationMailer | null) {}
  onApplicationShutdown(): void {
    if (this.closed) return;
    this.closed = true;
    this.mailer?.close();
  }
}

@Global()
@Module({
  providers: [
    { provide: MAILER, inject: [ConfigService], useFactory: (config: ConfigService): VerificationMailer | null => config.get().smtp ? createVerificationMailer(config.get().smtp!) : null },
    EmailLifecycle,
  ],
  exports: [MAILER],
})
export class EmailModule {}
