import type { DeveloperAccount, DeveloperStatus, PasswordDigest } from './developer-identity.js';
import { hashDeveloperPassword, normalizeDeveloperEmail, verifyDeveloperPassword } from './developer-identity.js';

export interface DeveloperCredential {
  developerId: string;
  emailNormalized: string;
  passwordDigest: PasswordDigest;
  status: DeveloperStatus;
}

interface DeveloperAuthStore {
  createEmailAccount(input: { emailNormalized: string; emailDisplay: string; passwordDigest: PasswordDigest }): Promise<DeveloperAccount>;
  findCredentialByEmail(emailNormalized: string): Promise<DeveloperCredential | null>;
}

interface RegistrationCode {
  consume(purpose: 'register', email: string, code: string): Promise<boolean>;
}

export class DeveloperAuthError extends Error {
  constructor(readonly code: 'invalid_code' | 'invalid_credentials' | 'account_disabled') {
    super(code === 'invalid_code' ? 'Email verification code is invalid or expired' : code === 'account_disabled' ? 'Developer account is unavailable' : 'Email or password is incorrect');
    this.name = 'DeveloperAuthError';
  }
}

export class DeveloperAuthService {
  constructor(
    private readonly store: DeveloperAuthStore,
    private readonly codes: RegistrationCode,
    private readonly dummyDigest: PasswordDigest,
  ) {}

  async register(email: string, password: string, code: string): Promise<DeveloperAccount> {
    const normalized = normalizeDeveloperEmail(email);
    if (!(await this.codes.consume('register', normalized, code))) throw new DeveloperAuthError('invalid_code');
    const passwordDigest = await hashDeveloperPassword(password);
    return this.store.createEmailAccount({ emailNormalized: normalized, emailDisplay: email.trim(), passwordDigest });
  }

  async loginWithPassword(email: string, password: string): Promise<DeveloperCredential> {
    const normalized = normalizeDeveloperEmail(email);
    const credential = await this.store.findCredentialByEmail(normalized);
    const valid = await verifyDeveloperPassword(password, credential?.passwordDigest ?? this.dummyDigest);
    if (!credential || !valid) throw new DeveloperAuthError('invalid_credentials');
    if (credential.status === 'disabled') throw new DeveloperAuthError('account_disabled');
    return credential;
  }
}
