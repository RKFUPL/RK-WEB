'use client';

import { FormEvent, useEffect, useState } from 'react';
import { apiBaseUrl, getCurrentUser, logout, type AuthUser } from '@/lib/rbac';

export default function ForcedPasswordChangePage() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getCurrentUser().then((currentUser) => {
      if (!currentUser) {
        window.location.replace('/account');
      } else if (!currentUser.must_change_password) {
        window.location.replace(currentUser.role === 'admin' ? '/admin' : currentUser.role === 'staff' ? '/staff' : '/account/orders');
      } else {
        setUser(currentUser);
      }
    });
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(''); setMessage('');
    if (password.length < 8) { setError('Your new password must be at least 8 characters.'); return; }
    if (password !== confirmPassword) { setError('The new passwords do not match.'); return; }
    if (password === currentPassword) { setError('Choose a password different from your current password.'); return; }
    setBusy(true);
    try {
      const token = window.localStorage.getItem('rk_access_token') ?? '';
      const response = await fetch(`${apiBaseUrl}/api/auth/password/change`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        credentials: 'include',
        body: JSON.stringify({ currentPassword, password, confirmPassword }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Unable to update your password.');
      if (payload.accessToken) {
        window.localStorage.setItem('rk_access_token', payload.accessToken);
        window.localStorage.setItem('rk_auth_token', payload.accessToken);
      }
      if (payload.user) window.localStorage.setItem('rk_auth_user', JSON.stringify(payload.user));
      setMessage('Your password has been updated. Redirecting…');
      window.setTimeout(() => { window.location.replace(payload.user?.role === 'admin' ? '/admin' : payload.user?.role === 'staff' ? '/staff' : '/account/orders'); }, 500);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update your password.');
    } finally { setBusy(false); }
  };

  if (!user) return <main className="flex min-h-screen items-center justify-center bg-ivory px-6 text-sm text-charcoal/60">Checking your account…</main>;
  return <main className="flex min-h-screen items-center justify-center bg-ivory px-6 py-12 text-charcoal">
    <section className="w-full max-w-xl rounded-[2rem] border border-black/[.07] bg-white p-8 shadow-[0_24px_80px_rgba(33,29,25,.08)] sm:p-12">
      <p className="text-[10px] uppercase tracking-[.3em] text-gold">Account security</p>
      <h1 className="mt-5 font-display text-5xl leading-none sm:text-6xl">Choose a new password.</h1>
      <p className="mt-6 text-sm leading-7 text-charcoal/60">For your security, update the temporary password before continuing to your RK Fashion workspace.</p>
      <p className="mt-3 text-xs text-charcoal/45">Signed in as {user.email}</p>
      <form onSubmit={submit} className="mt-10 space-y-6">
        <Field label="Current password" value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" />
        <Field label="New password" value={password} onChange={setPassword} autoComplete="new-password" />
        <Field label="Confirm new password" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" />
        {error ? <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}
        {message ? <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</p> : null}
        <button type="submit" disabled={busy} className="w-full rounded-full bg-ink px-6 py-4 text-[10px] uppercase tracking-[.22em] text-ivory transition hover:bg-gold disabled:cursor-not-allowed disabled:opacity-50">{busy ? 'Updating password…' : 'Update password'}</button>
      </form>
      <button type="button" onClick={() => void logout()} className="mt-6 w-full text-center text-[10px] uppercase tracking-[.2em] text-charcoal/45 transition hover:text-red-700">Sign out</button>
    </section>
  </main>;
}

function Field({ label, value, onChange, autoComplete }: { label: string; value: string; onChange: (value: string) => void; autoComplete: string }) {
  return <label className="block text-[10px] uppercase tracking-[.22em] text-charcoal/55">{label}<input required type="password" minLength={8} value={value} autoComplete={autoComplete} onChange={(event) => onChange(event.target.value)} className="mt-3 w-full border-b border-black/15 bg-transparent px-0 py-3 text-base normal-case tracking-normal outline-none transition focus:border-gold" /></label>;
}
