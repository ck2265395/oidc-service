export interface ApiEnvelope<T> { code: number; desc: string; data: T }

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function decode<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as ApiEnvelope<T> | { error?: { message?: string } } | null;
  if (!response.ok || !body || !('data' in body)) {
    const message = body && 'error' in body ? body.error?.message : undefined;
    throw new ApiError(response.status, message || '请求失败，请稍后重试');
  }
  return body.data;
}

export async function apiGet<T>(path: string): Promise<T> {
  return decode<T>(await fetch(path, { credentials: 'same-origin', headers: { accept: 'application/json' } }));
}

let developerCsrf = '';

export async function developerMutation<T>(path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body: unknown): Promise<T> {
  if (!developerCsrf) developerCsrf = (await apiGet<{ token: string }>('/api/v1/developer/csrf')).token;
  const execute = () => fetch(path, {
    method,
    credentials: 'same-origin',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'x-csrf-token': developerCsrf },
    body: JSON.stringify(body),
  });
  let response = await execute();
  if (response.status === 403) {
    developerCsrf = (await apiGet<{ token: string }>('/api/v1/developer/csrf')).token;
    response = await execute();
  }
  return decode<T>(response);
}

export async function consoleMutation<T>(path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', csrfToken: string, body?: unknown): Promise<T> {
  return decode<T>(await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
}
