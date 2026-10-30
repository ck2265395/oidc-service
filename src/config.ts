export type RuntimeMode = 'development' | 'test' | 'production';

export interface ServiceConfig {
  mode: RuntimeMode;
  issuer: string;
  port: number;
  secrets: {
    cookie: string;
    fingerprint: string;
    subject: string;
    encryption: string;
  };
  admin: {
    username: string;
    passwordHash: string;
  };
  databases: {
    oidc: string;
    accounts: string;
  };
  redisUrl: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function objectAt(value: unknown, path: string): UnknownRecord {
  if (!isRecord(value)) {
    throw new ConfigError(`${path} must be an object`);
  }
  return value;
}

function stringAt(value: unknown, path: string, minLength = 1): string {
  if (typeof value !== 'string' || value.trim().length < minLength) {
    throw new ConfigError(`${path} is required`);
  }
  return value;
}

function urlAt(value: unknown, path: string, protocols: string[]): string {
  const raw = stringAt(value, path);
  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError(`${path} must be a valid URL`);
  }

  if (!protocols.includes(url.protocol) || url.username || url.password) {
    throw new ConfigError(`${path} must use an allowed URL scheme without embedded credentials`);
  }

  return raw;
}

function secretAt(value: unknown, path: string): string {
  const secret = stringAt(value, path, 43);
  const alphabet = /^[A-Za-z0-9_-]+$/.test(secret);
  const diversity = new Set(secret).size;

  if (!alphabet || diversity < 16 || /^(replace|change|example|your)[-_]/i.test(secret)) {
    throw new ConfigError(`${path} must be a strong base64url secret`);
  }
  return secret;
}

export function loadConfig(input: unknown): ServiceConfig {
  const root = objectAt(input, 'config');
  const modeValue = stringAt(root.mode, 'mode');
  if (!['development', 'test', 'production'].includes(modeValue)) {
    throw new ConfigError('mode must be development, test, or production');
  }
  const mode = modeValue as RuntimeMode;

  const issuer = urlAt(root.issuer, 'issuer', ['https:', ...(mode === 'production' ? [] : ['http:'])]);
  const issuerUrl = new URL(issuer);
  if (issuerUrl.search || issuerUrl.hash || issuerUrl.username || issuerUrl.password) {
    throw new ConfigError('issuer must not contain query, fragment, or credentials');
  }

  if (!Number.isInteger(root.port) || Number(root.port) < 1 || Number(root.port) > 65535) {
    throw new ConfigError('port must be an integer between 1 and 65535');
  }

  const secretsInput = objectAt(root.secrets, 'secrets');
  const admin = objectAt(root.admin, 'admin');
  const databases = objectAt(root.databases, 'databases');
  const secrets = {
    cookie: secretAt(secretsInput.cookie, 'secrets.cookie'),
    fingerprint: secretAt(secretsInput.fingerprint, 'secrets.fingerprint'),
    subject: secretAt(secretsInput.subject, 'secrets.subject'),
    encryption: secretAt(secretsInput.encryption, 'secrets.encryption'),
  };

  if (new Set(Object.values(secrets)).size !== Object.keys(secrets).length) {
    throw new ConfigError('secrets must be independent');
  }

  const username = stringAt(admin.username, 'admin.username');
  if (username.length > 128) {
    throw new ConfigError('admin.username is too long');
  }

  const passwordHash = stringAt(admin.passwordHash, 'admin.passwordHash');
  if (!/^scrypt\$\d+\$\d+\$\d+\$[^$]+\$[^$]+$/.test(passwordHash)) {
    throw new ConfigError('admin.passwordHash must be a precomputed scrypt hash');
  }

  return {
    mode,
    issuer: issuer.replace(/\/$/, ''),
    port: Number(root.port),
    secrets,
    admin: { username, passwordHash },
    databases: {
      oidc: urlAt(databases.oidc, 'databases.oidc', ['postgres:', 'postgresql:']),
      accounts: urlAt(databases.accounts, 'databases.accounts', ['postgres:', 'postgresql:']),
    },
    redisUrl: urlAt(root.redisUrl, 'redisUrl', ['redis:', 'rediss:']),
  };
}