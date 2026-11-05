import { createHash } from 'node:crypto';

function sha256(source: string): string {
  return createHash('sha256').update(source).digest('hex');
}

export function migrationChecksums(source: string): { canonical: string; accepted: ReadonlySet<string> } {
  const normalized = source.replace(/\r\n/g, '\n');
  const canonical = sha256(normalized);
  return {
    canonical,
    accepted: new Set([canonical, sha256(normalized.replace(/\n/g, '\r\n'))]),
  };
}
