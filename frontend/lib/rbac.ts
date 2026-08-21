export type Role = 'customer' | 'staff' | 'admin';

export type AuthUser = {
  id: string;
  email: string;
  username?: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  role: Role;
  permissions?: StaffPermission[];
  isActive: boolean;
  emailVerified: boolean;
};

export type StaffPermission = 'products:manage' | 'inventory:manage' | 'quotes:manage' | 'orders:manage' | 'customers:manage';

export const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || '';

const cachedUserKey = 'rk_auth_user';
let currentUserRequest: Promise<AuthUser | null> | null = null;
let currentUserToken = '';

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
  if (currentUserRequest && currentUserToken === token) return currentUserRequest;
  currentUserToken = token;
  currentUserRequest = getCurrentUserRequest(token).finally(() => {
    currentUserRequest = null;
    currentUserToken = '';
  });
  return currentUserRequest;
}

async function getCurrentUserRequest(token: string): Promise<AuthUser | null> {
  try {
    const response = await requestCurrentUser(token);
    if (response.ok) {
      const user = (await response.json()).user as AuthUser;
      window.localStorage.setItem(cachedUserKey, JSON.stringify(user));
      window.localStorage.setItem('rk_auth_token', token);
      return user;
    }
    if (response.status === 401) {
      window.localStorage.removeItem('rk_access_token');
      window.localStorage.removeItem(cachedUserKey);
      window.localStorage.removeItem('rk_auth_token');
      return null;
    }
    return null;
  } catch {
    // The database response is authoritative. Do not render a stale cached
    // account when the current identity cannot be verified.
  }
  return null;
}

function clearAuthState() {
  window.localStorage.removeItem('rk_access_token');
  window.localStorage.removeItem('rk_auth_token');
  window.localStorage.removeItem(cachedUserKey);
}

export async function logout() {
  const token = window.localStorage.getItem('rk_access_token');
  try {
    if (token) {
      await fetch(`${apiBaseUrl}/api/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    }
  } finally {
    clearAuthState();
    window.location.assign('/account');
  }
}
