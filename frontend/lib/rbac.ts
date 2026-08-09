export type Role = 'customer' | 'staff' | 'admin';

export type AuthUser = {
  id: string;
  email: string;
  username?: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  role: Role;
  isActive: boolean;
  emailVerified: boolean;
};

export const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || '';

const cachedUserKey = 'rk_auth_user';

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

async function requestCurrentUser(token: string): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await fetch(`${apiBaseUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
    } catch (error) {
      lastError = error;
      if (attempt < 2) await wait(1000 * (attempt + 1));
    }
  }
  throw lastError;
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  if (typeof window === 'undefined') return null;
  const token = window.localStorage.getItem('rk_access_token');
  if (!token) return null;
  try {
    const response = await requestCurrentUser(token);
    if (response.ok) {
      const user = (await response.json()).user as AuthUser;
      window.localStorage.setItem(cachedUserKey, JSON.stringify(user));
      return user;
    }
    if (response.status === 401) {
      window.localStorage.removeItem('rk_access_token');
      window.localStorage.removeItem(cachedUserKey);
      return null;
    }
  } catch {
    // Keep the token and cached identity through a Render cold start or a
    // temporary network failure. It can be validated again on the next load.
  }
  const cached = window.localStorage.getItem(cachedUserKey);
  return cached ? (JSON.parse(cached) as AuthUser) : null;
}

export function logout() {
  window.localStorage.removeItem('rk_access_token');
  window.localStorage.removeItem(cachedUserKey);
  window.location.assign('/account');
}
