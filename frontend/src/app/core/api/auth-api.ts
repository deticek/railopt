import { apiBaseUrl, apiRequest, readApiError } from './api-client';

export interface AuthSession {
  token: string;
  user: {
    id?: string | null;
    name?: string;
    username?: string;
    email?: string;
    role?: number;
    permissions?: string[];
  };
}

async function readSession(response: Response): Promise<AuthSession> {
  if (!response.ok) throw new Error(await readApiError(response, 'Prijava ni uspela.'));
  return response.json() as Promise<AuthSession>;
}

export async function login(email: string, password: string): Promise<AuthSession> {
  return readSession(
    await fetch(`${apiBaseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(8000),
    }),
  );
}

export async function loginAsDeveloper(): Promise<AuthSession> {
  return readSession(
    await fetch(`${apiBaseUrl}/auth/dev-session`, {
      method: 'POST',
      signal: AbortSignal.timeout(8000),
    }),
  );
}

export async function logout(): Promise<void> {
  await apiRequest('/auth/logout', { method: 'POST' }).catch(() => undefined);
}

export async function listUsers(): Promise<
  Array<{ id: string; username: string; email: string; role: number; active: boolean }>
> {
  const response = await apiRequest('/users');
  if (!response.ok)
    throw new Error(await readApiError(response, 'Seznama uporabnikov ni mogoče prebrati.'));
  return response.json();
}

export async function createUser(user: {
  username: string;
  email: string;
  password: string;
  role: number;
}): Promise<void> {
  const response = await apiRequest('/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(user),
  });
  if (!response.ok)
    throw new Error(await readApiError(response, 'Uporabnika ni bilo mogoče ustvariti.'));
}
