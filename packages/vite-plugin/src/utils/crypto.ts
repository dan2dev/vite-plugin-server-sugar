import { createHash } from 'node:crypto';

export function hash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 8);
}

export function toKebabCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[\s_.]+/g, '-')
    .toLowerCase()
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function backendConstName(endpoint: string): string {
  const safe = endpoint.replace(/[^A-Za-z0-9_$]/g, '_');
  return `__backend_${safe}_${hash(endpoint)}`;
}

export function websocketConstName(endpoint: string): string {
  const safe = endpoint.replace(/[^A-Za-z0-9_$]/g, '_');
  return `__ws_${safe}_${hash(endpoint)}`;
}
