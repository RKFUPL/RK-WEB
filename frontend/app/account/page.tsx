'use client';

import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import { brandLogoUrl } from '@/lib/home-content';

type AccountUser = { id: string; email: string; username?: string; displayName?: string };
type AuthMode = 'login' | 'signup' | 'forgot';
type PasswordFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  minLength?: number;
};

function PasswordField({ label, value, onChange, required = true, minLength }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);

  return (
    <label className="block text-xs uppercase tracking-[0.25em] text-charcoal/55">
      {label}
      <span className="relative mt-3 block">
        <input
          type={visible ? 'text' : 'password'}
          required={required}
          minLength={minLength}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-full border-b border-black/15 px-0 py-3 pr-12 text-base normal-case tracking-normal outline-none focus:border-gold"
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          title={visible ? 'Hide password' : 'Show password'}
          className="absolute right-0 top-1/2 -translate-y-1/2 p-2 text-charcoal/55 transition hover:text-gold"
        >
          {visible ? (
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" />
              <circle cx="12" cy="12" r="2.5" />
            </svg>
          ) : (
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path d="M3 3l18 18" />
              <path d="M10.6 6.2A10.8 10.8 0 0 1 12 6c6.5 0 10 6 10 6a18.3 18.3 0 0 1-3.1 3.6M6.1 6.8C3.4 8.3 2 12 2 12s3.5 6 10 6c1.2 0 2.3-.2 3.3-.6" />
              <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
            </svg>
          )}
        </button>
      </span>
    </label>
  );
}

const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:5000';
const inaaraImage = 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785305219/RASHI_KAPOOR_-_27-3-240879_xr10ue.jpg';
const aakaarImage = 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785586504/Rashi_Kapoor2496_zwpkfq.jpg';

export default function AccountPage() {
  const [mode, setMode] = useState<AuthMode>('login');
  const [otpStep, setOtpStep] = useState(false);
  const [identifier, setIdentifier] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [user, setUser] = useState<AccountUser | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const token = window.localStorage.getItem('rk_access_token');
    if (!token) return;
    fetch(`${apiBaseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => data?.user && setUser(data.user))
      .catch(() => window.localStorage.removeItem('rk_access_token'));
  }, []);

  const changeMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setOtpStep(false);
    setOtp('');
    setMessage('');
  };

  const submitLogin = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`${apiBaseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
      });
      const data = await response.json();
      if (!response.ok) {
        const errorMessage = data.error ?? 'Unable to sign in.';
        if (response.status === 404) window.alert(errorMessage);
        throw new Error(errorMessage);
      }
      window.localStorage.setItem('rk_access_token', data.accessToken);
      setUser(data.user);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to sign in.');
    } finally {
      setBusy(false);
    }
  };

  const requestSignupOtp = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`${apiBaseUrl}/api/auth/signup/request-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: fullName, username, email, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Unable to send signup code.');
      setOtpStep(true);
      setMessage('A six-digit signup code has been sent to your email.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to send signup code.');
    } finally {
      setBusy(false);
    }
  };

  const verifySignupOtp = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`${apiBaseUrl}/api/auth/signup/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'The signup code is invalid or expired.');
      window.localStorage.setItem('rk_access_token', data.accessToken);
      setUser(data.user);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to verify signup code.');
    } finally {
      setBusy(false);
    }
  };

  const requestRecoveryOtp = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`${apiBaseUrl}/api/auth/forgot-password/request-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Unable to send recovery code.');
      setOtpStep(true);
      setMessage('If the account exists, a recovery code has been sent.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to send recovery code.');
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`${apiBaseUrl}/api/auth/forgot-password/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, otp, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Unable to reset password.');
      changeMode('login');
      setMessage('Password updated. You can now sign in.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to reset password.');
    } finally {
      setBusy(false);
    }
  };

  if (user) {
    return (
      <main className="min-h-screen bg-ivory px-6 py-8 text-charcoal lg:px-10">
        <div className="mx-auto max-w-5xl">
          <img src={brandLogoUrl} alt="RK Logo" className="h-14 w-auto" />
          <div className="mt-24 max-w-lg border border-black/10 bg-white p-8">
            <p className="text-xs uppercase tracking-[0.3em] text-charcoal/45">Your profile</p>
            <h1 className="mt-4 font-display text-5xl leading-none">Welcome, {user.displayName || user.username || 'to RK'}.</h1>
            <div className="mt-8 space-y-3 text-sm text-charcoal/70">
              <p>{user.email}</p>
              {user.username ? <p>@{user.username}</p> : null}
            </div>
          </div>
        </div>
      </main>
    );
  }

  const isSignup = mode === 'signup';
  const isForgot = mode === 'forgot';
  const formSubmit = isSignup ? (otpStep ? verifySignupOtp : requestSignupOtp) : isForgot ? (otpStep ? resetPassword : requestRecoveryOtp) : submitLogin;

  return (
    <main className="min-h-screen bg-white text-charcoal">
      <div className="grid min-h-screen lg:grid-cols-2">
        <div className="relative min-h-[20rem] overflow-hidden lg:min-h-screen">
          <img src={isSignup ? inaaraImage : aakaarImage} alt={isSignup ? 'Inaara collection' : 'Aakaar collection'} className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-black/10" />
          <div className="absolute bottom-8 left-8 z-10 text-white lg:bottom-12 lg:left-12">
            <p className="text-xs uppercase tracking-[0.35em]">Rashi Kapoor</p>
            <p className="mt-3 font-display text-4xl">The house of modern Indian luxury.</p>
          </div>
        </div>

        <section className="flex items-center justify-center px-6 py-12 lg:px-20">
          <div className="w-full max-w-md">
            <a href="/" className="mb-12 flex justify-end">
              <img src={brandLogoUrl} alt="RK Logo" className="h-16 w-auto" />
            </a>
            <p className="mt-8 text-xs uppercase tracking-[0.35em] text-charcoal/45">{isSignup ? 'Create your profile' : isForgot ? 'Account recovery' : 'Welcome back'}</p>
            <h1 className="mt-4 font-display text-5xl leading-none md:text-6xl">{isSignup ? 'Get access to everything.' : isForgot ? 'Reset your password.' : 'Your account.'}</h1>
            <p className="mt-5 text-sm leading-7 text-charcoal/60">{isSignup ? 'Create a profile for collection notes, private previews, and a more personal RK experience.' : isForgot ? 'Enter your username or email to receive a password reset code.' : 'Sign in with your username or email and password.'}</p>

            <form onSubmit={formSubmit} className="mt-10 space-y-5">
              {isSignup ? (
                <>
                  <label className="block text-xs uppercase tracking-[0.25em] text-charcoal/55">Full name<input required value={fullName} onChange={(event) => setFullName(event.target.value)} disabled={otpStep} className="mt-3 w-full border-b border-black/15 px-0 py-3 text-base normal-case tracking-normal outline-none focus:border-gold" /></label>
                  <label className="block text-xs uppercase tracking-[0.25em] text-charcoal/55">Username<input required value={username} onChange={(event) => setUsername(event.target.value)} disabled={otpStep} className="mt-3 w-full border-b border-black/15 px-0 py-3 text-base normal-case tracking-normal outline-none focus:border-gold" /></label>
                  <label className="block text-xs uppercase tracking-[0.25em] text-charcoal/55">Email<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} disabled={otpStep} className="mt-3 w-full border-b border-black/15 px-0 py-3 text-base normal-case tracking-normal outline-none focus:border-gold" /></label>
                  {!otpStep ? <PasswordField label="Password" minLength={8} value={password} onChange={setPassword} /> : null}
                </>
              ) : (
                <>
                  <label className="block text-xs uppercase tracking-[0.25em] text-charcoal/55">Username or email<input required value={identifier} onChange={(event) => setIdentifier(event.target.value)} disabled={otpStep} className="mt-3 w-full border-b border-black/15 px-0 py-3 text-base normal-case tracking-normal outline-none focus:border-gold" /></label>
                  {!isForgot ? <PasswordField label="Password" value={password} onChange={setPassword} /> : null}
                </>
              )}
              {isForgot && otpStep ? <PasswordField label="New password" minLength={8} value={password} onChange={setPassword} /> : null}
              {isForgot && otpStep || isSignup && otpStep ? <label className="block text-xs uppercase tracking-[0.25em] text-charcoal/55">One-time code<input type="text" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, ''))} className="mt-3 w-full border-b border-black/15 px-0 py-3 text-base tracking-[0.35em] outline-none focus:border-gold" /></label> : null}
              <button type="submit" disabled={busy} className="w-full rounded-full bg-ink px-5 py-4 text-xs uppercase tracking-[0.28em] text-ivory transition hover:bg-gold disabled:opacity-50">{busy ? 'Please wait...' : isSignup ? (otpStep ? 'Verify signup code' : 'Send signup code') : isForgot ? (otpStep ? 'Reset password' : 'Send recovery code') : 'Sign in'}</button>
              {message ? <p className="text-sm text-charcoal/65">{message}</p> : null}
            </form>

            <div className="mt-8 flex flex-wrap items-center justify-between gap-4 text-xs tracking-[0.08em] text-charcoal/60">
              {mode === 'login' ? <button type="button" onClick={() => changeMode('forgot')} className="transition hover:text-gold">Forgot password?</button> : <button type="button" onClick={() => changeMode('login')} className="transition hover:text-gold">Back to sign in</button>}
              {mode !== 'signup' ? <button type="button" onClick={() => changeMode('signup')} className="font-semibold text-charcoal transition hover:text-gold">Create an account</button> : <button type="button" onClick={() => changeMode('login')} className="transition hover:text-gold">Already have an account?</button>}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
