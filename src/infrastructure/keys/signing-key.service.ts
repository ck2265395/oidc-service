import { readFile } from 'node:fs/promises';

import { Global, Injectable, Module, type OnModuleInit } from '@nestjs/common';
import type { JWKS } from 'oidc-provider';

import { OIDC_SIGNING_KEYS } from '../../common/tokens/injection-tokens.js';

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid protected signing key');
  return value as Record<string, unknown>;
}

@Injectable()
export class SigningKeyService implements OnModuleInit {
  private value: JWKS | null = null;
  async onModuleInit(): Promise<void> {
    if (this.value) return;
    const path = process.env.OIDC_SIGNING_KEY_FILE;
    if (!path) throw new Error('OIDC_SIGNING_KEY_FILE must point to protected key material');
    const root = record(JSON.parse(await readFile(path, 'utf8')) as unknown);
    const signing = record(root.signingKey); const privateJwk = record(signing.privateJwk); const kid = signing.kid;
    if (privateJwk.kty !== 'RSA' || typeof privateJwk.n !== 'string' || typeof privateJwk.d !== 'string' || typeof kid !== 'string' || kid.length < 16) {
      throw new Error('Invalid protected signing key');
    }
    this.value = { keys: [{ ...privateJwk, kid, alg: 'RS256', use: 'sig' }] } as JWKS;
  }
  get(): JWKS { if (!this.value) throw new Error('Signing keys are not initialized'); return this.value; }
}

@Global()
@Module({
  providers: [
    SigningKeyService,
    { provide: OIDC_SIGNING_KEYS, inject: [SigningKeyService], useFactory: (keys: SigningKeyService): SigningKeyService => keys },
  ],
  exports: [OIDC_SIGNING_KEYS],
})
export class SigningKeyModule {}
