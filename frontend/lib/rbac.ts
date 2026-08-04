export type Role = 'customer' | 'staff' | 'admin';

export type AuthUser = {
  id: string;
  email: string;
  username?: string;
  displayName?: string;
  role: Role;
  isActive: boolean;
  emailVerified: boolean;
};

export const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:5000';

export async function getCurrentUser(): Promise<AuthUser | null> {
  if (typeof window === 'undefined') return null;
  const token = window.localStorage.getItem('rk_access_token');
  if (!token) return null;
  const response = await fetch(`${apiBaseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!response.ok) {
    if (response.status === 401) window.localStorage.removeItem('rk_access_token');
    return null;
  }
  return (await response.json()).user as AuthUser;
}

export function logout() {
  window.localStorage.removeItem('rk_access_token');
  window.location.assign('/account');
}
