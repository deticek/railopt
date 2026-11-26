export const apiBaseUrl = 'http://127.0.0.1:8080/api';

export async function apiRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = sessionStorage.getItem('railopt-token');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers,
    signal: init.signal || AbortSignal.timeout(8000),
  });
}

export async function readApiError(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  return body.error || fallback;
}
