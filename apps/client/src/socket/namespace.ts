import { WS_NAMESPACE } from '@online-exam/shared';

// Namespace /exam shares the default /socket.io Engine.IO transport path.
export function examSocketUrl(origin?: string): string {
  if (!origin) return WS_NAMESPACE;
  const url = new URL(origin);
  url.pathname = WS_NAMESPACE;
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}
