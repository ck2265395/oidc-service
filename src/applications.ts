export type ClientType = 'web' | 'spa' | 'native';
export type RuntimeEnvironment = 'development' | 'production';
export type AllowedScope = 'openid' | 'profile' | 'email';

export interface ApplicationDraft {
  name: string;
  description: string;
  purpose: string;
  homepageUrl: string;
  privacyUrl: string;
  termsUrl: string;
  iconUrl: string | null;
  redirectUris: string[];
  postLogoutRedirectUris: string[];
  scopes: AllowedScope[];
  groupId: string | null;
}

export class ApplicationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApplicationValidationError';
  }
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordAt(value: unknown): UnknownRecord {
  if (!isRecord(value)) throw new ApplicationValidationError('Application data must be an object');
  return value;
}

function textAt(value: unknown, field: string, maximum: number): string {
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    value.length < 1 ||
    value.length > maximum
  ) {
    throw new ApplicationValidationError(`${field} is required and must be at most ${maximum} characters`);
  }
  return value;
}

function httpsUrlAt(value: unknown, field: string): string {
  const raw = textAt(value, field, 2048);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ApplicationValidationError(`${field} must be a valid HTTPS URL`);
  }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.hash) {
    throw new ApplicationValidationError(`${field} must be a public HTTPS URL without credentials or fragment`);
  }
  return raw;
}

function isLoopback(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname.toLowerCase());
}

function validateRedirectUri(value: unknown, field: string, type: ClientType, environment: RuntimeEnvironment): string {
  const raw = textAt(value, field, 2048);
  if (raw.includes('*') || raw.includes('#') || /[\u0000-\u0020\u007f]/.test(raw)) {
    throw new ApplicationValidationError(`${field} contains a forbidden character`);
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ApplicationValidationError(`${field} must be an absolute redirect URI`);
  }
  if (url.username || url.password || url.hash) {
    throw new ApplicationValidationError(`${field} must not contain credentials or a fragment`);
  }

  if (url.protocol === 'https:') {
    if (!url.hostname) throw new ApplicationValidationError(`${field} must include a host`);
    return raw;
  }

  if (url.protocol === 'http:') {
    if (environment === 'development' && isLoopback(url.hostname)) return raw;
    throw new ApplicationValidationError(`${field} must use HTTPS outside a local development callback`);
  }

  if (type === 'native') {
    const scheme = url.protocol.slice(0, -1);
    const labels = scheme.split('.');
    if (
      labels.length >= 2 &&
      labels.every((label) => /^[a-z][a-z0-9-]*$/i.test(label)) &&
      !url.hostname
    ) {
      return raw;
    }
  }

  throw new ApplicationValidationError(`${field} uses an unsupported URI scheme`);
}

function uriListAt(
  value: unknown,
  field: string,
  type: ClientType,
  environment: RuntimeEnvironment,
): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) {
    throw new ApplicationValidationError(`${field} must contain between 1 and 10 URIs`);
  }

  const uris = value.map((item) => validateRedirectUri(item, field, type, environment));
  if (new Set(uris).size !== uris.length) {
    throw new ApplicationValidationError(`${field} contains a duplicate URI`);
  }
  return uris;
}

function scopesAt(value: unknown): AllowedScope[] {
  if (!Array.isArray(value) || value.length < 1 || value.some((scope) => typeof scope !== 'string')) {
    throw new ApplicationValidationError('scopes must be a list of supported values');
  }

  const allowed = new Set<AllowedScope>(['openid', 'profile', 'email']);
  const scopes = value as string[];
  if (new Set(scopes).size !== scopes.length) {
    throw new ApplicationValidationError('scopes must not contain duplicates');
  }
  if (!scopes.includes('openid')) {
    throw new ApplicationValidationError('scopes must include openid');
  }
  if (scopes.some((scope) => !allowed.has(scope as AllowedScope))) {
    throw new ApplicationValidationError('scopes contain an unsupported value');
  }

  return scopes as AllowedScope[];
}

export function validateApplicationDraft(
  input: unknown,
  type: ClientType,
  environment: RuntimeEnvironment,
): ApplicationDraft {
  if (!['web', 'spa', 'native'].includes(type)) {
    throw new ApplicationValidationError('client type is unsupported');
  }
  if (!['development', 'production'].includes(environment)) {
    throw new ApplicationValidationError('runtime environment is unsupported');
  }

  const value = recordAt(input);
  const iconUrl = value.iconUrl === null || value.iconUrl === undefined
    ? null
    : httpsUrlAt(value.iconUrl, 'iconUrl');

  let groupId: string | null = null;
  if (value.groupId !== null && value.groupId !== undefined) {
    groupId = textAt(value.groupId, 'groupId', 128);
  }

  return {
    name: textAt(value.name, 'name', 100),
    description: textAt(value.description, 'description', 1000),
    purpose: textAt(value.purpose, 'purpose', 1000),
    homepageUrl: httpsUrlAt(value.homepageUrl, 'homepageUrl'),
    privacyUrl: httpsUrlAt(value.privacyUrl, 'privacyUrl'),
    termsUrl: httpsUrlAt(value.termsUrl, 'termsUrl'),
    iconUrl,
    redirectUris: uriListAt(value.redirectUris, 'redirectUris', type, environment),
    postLogoutRedirectUris: uriListAt(value.postLogoutRedirectUris, 'postLogoutRedirectUris', type, environment),
    scopes: scopesAt(value.scopes),
    groupId,
  };
}

export function tokenEndpointAuthMethod(type: ClientType): 'client_secret_basic' | 'none' {
  return type === 'web' ? 'client_secret_basic' : 'none';
}