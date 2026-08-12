'use client';

import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import { brandLogoUrl } from '@/lib/home-content';

type AccountUser = { id: string; email: string; username?: string; displayName?: string; role: 'customer' | 'staff' | 'admin' };
type AuthMode = 'login' | 'signup' | 'forgot';
type PasswordFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  minLength?: number;
  error?: string;
  onBlur?: () => void;
};

function PasswordField({ label, value, onChange, required = true, minLength, error, onBlur }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);

  return (
    <label className={`group relative block text-xs uppercase tracking-[0.25em] ${error ? 'text-red-600' : 'text-charcoal/55'}`}>
      {label}
      <span className="relative mt-3 block">
        <input
          type={visible ? 'text' : 'password'}
          required={required}
          minLength={minLength}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          aria-invalid={Boolean(error)}
          className={`w-full border-b px-0 py-3 pr-12 text-base normal-case tracking-normal outline-none focus:border-gold ${error ? 'border-red-500' : 'border-black/15'}`}
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
      {error ? <span role="tooltip" className="pointer-events-none absolute right-0 top-0 z-10 max-w-[15rem] -translate-y-2 rounded bg-red-600 px-3 py-2 text-[10px] normal-case tracking-normal text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">{error}</span> : null}
    </label>
  );
}

type SignupField = 'fullName' | 'username' | 'email' | 'phone' | 'region' | 'password';

function signupFieldError(field: SignupField, value: string) {
  if (!value.trim()) return field === 'fullName' ? 'Full name is required.' : field === 'username' ? 'Username is required.' : field === 'email' ? 'Email is required.' : field === 'phone' ? 'Phone number is required.' : field === 'region' ? 'Region is required.' : 'Password is required.';
  if (field === 'email' && !/^\S+@\S+\.\S+$/.test(value.trim())) return 'Enter a valid email address.';
  if (field === 'phone' && !/^\+?[0-9\s().-]{7,20}$/.test(value.trim())) return 'Enter a valid phone number.';
  if (field === 'password' && value.length < 8) return 'Password must be at least 8 characters.';
  return '';
}

const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || '';
const inaaraImage = 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785305219/RASHI_KAPOOR_-_27-3-240879_xr10ue.jpg';
const aakaarImage = 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785586504/Rashi_Kapoor2496_zwpkfq.jpg';

export default function AccountPage() {
  const [mode, setMode] = useState<AuthMode>('login');
  const [otpStep, setOtpStep] = useState(false);
  const [identifier, setIdentifier] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [region, setRegion] = useState('');
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [user, setUser] = useState<AccountUser | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<SignupField, string>>>({});

  useEffect(() => {
    if (!user) return;
    if (user.role !== 'customer') {
      window.location.replace(user.role === 'admin' ? '/admin' : '/staff');
      return;
    }
    window.location.replace('/');
  }, [user]);

  useEffect(() => {
    const token = window.localStorage.getItem('rk_access_token');
    if (!token) {
      setAuthChecking(false);
      return;
    }
    fetch(`${apiBaseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => {
        if (response.status === 401) {
          window.localStorage.removeItem('rk_access_token');
          window.localStorage.removeItem('rk_auth_token');
          window.localStorage.removeItem('rk_auth_user');
          return null;
        }
        return response.ok ? response.json() : null;
      })
      .then((data) => data?.user && setUser(data.user))
      .catch(() => undefined)
      .finally(() => setAuthChecking(false));
  }, []);

  const changeMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setOtpStep(false);
    setOtp('');
    setMessage('');
    setFieldErrors({});
  };

  const validateSignup = () => {
    const nextErrors: Partial<Record<SignupField, string>> = {};
    (['fullName', 'username', 'email', 'phone', 'region', 'password'] as SignupField[]).forEach((field) => {
      const value = field === 'fullName' ? fullName : field === 'username' ? username : field === 'email' ? email : field === 'phone' ? phone : field === 'region' ? region : password;
      const error = signupFieldError(field, value);
      if (error) nextErrors[field] = error;
    });
    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const updateSignupField = (field: SignupField, value: string) => {
    if (field === 'fullName') setFullName(value);
    if (field === 'username') setUsername(value);
    if (field === 'email') setEmail(value);
    if (field === 'phone') setPhone(value);
    if (field === 'region') setRegion(value);
    if (field === 'password') setPassword(value);
    if (fieldErrors[field]) setFieldErrors((current) => ({ ...current, [field]: signupFieldError(field, value) || undefined }));
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
      window.localStorage.setItem('rk_auth_token', data.accessToken);
      window.localStorage.setItem('rk_auth_user', JSON.stringify(data.user));
      window.location.replace('/');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to sign in.');
    } finally {
      setBusy(false);
    }
  };

  const requestSignupOtp = async (event: FormEvent) => {
    event.preventDefault();
    if (!validateSignup()) return;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`${apiBaseUrl}/api/auth/signup/request-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: fullName, username, email, phone, region, password }),
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
      window.localStorage.setItem('rk_auth_token', data.accessToken);
      window.localStorage.setItem('rk_auth_user', JSON.stringify(data.user));
      window.location.replace('/');
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

  if (authChecking || user) return <main className="min-h-screen bg-ivory" aria-label="Loading account" />;

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
            <div className="mb-12 flex justify-end">
              <a href="/" className="inline-flex">
                <img src={brandLogoUrl} alt="RK Logo" className="rk-logo h-16 w-auto" />
              </a>
            </div>
            <p className="mt-8 text-xs uppercase tracking-[0.35em] text-charcoal/45">{isSignup ? 'Create your profile' : isForgot ? 'Account recovery' : 'Welcome back'}</p>
            <h1 className="mt-4 font-display text-5xl leading-none md:text-6xl">{isSignup ? 'Get access to everything.' : isForgot ? 'Reset your password.' : 'Your account.'}</h1>
            <p className="mt-5 text-sm leading-7 text-charcoal/60">{isSignup ? 'Create a profile for collection notes, private previews, and a more personal RK experience.' : isForgot ? 'Enter your username or email to receive a password reset code.' : 'Sign in with your username or email and password.'}</p>

            <form onSubmit={formSubmit} noValidate={isSignup} className="mt-10 space-y-5">
              {isSignup ? (
                <>
                  {(['fullName', 'username', 'email', 'phone'] as const).map((field) => {
                    const labels = { fullName: 'Full name', username: 'Username', email: 'Email', phone: 'Phone number' };
                    const values = { fullName, username, email, phone };
                    return <label key={field} className={`group relative block text-xs uppercase tracking-[0.25em] ${fieldErrors[field] ? 'text-red-600' : 'text-charcoal/55'}`}>{labels[field]}<input type={field === 'email' ? 'email' : 'text'} required value={values[field]} onChange={(event) => updateSignupField(field, event.target.value)} onBlur={() => setFieldErrors((current) => ({ ...current, [field]: signupFieldError(field, values[field]) || undefined }))} disabled={otpStep} aria-invalid={Boolean(fieldErrors[field])} className={`mt-3 w-full border-b px-0 py-3 text-base normal-case tracking-normal outline-none focus:border-gold ${fieldErrors[field] ? 'border-red-500' : 'border-black/15'}`} />{fieldErrors[field] ? <span role="tooltip" className="pointer-events-none absolute right-0 top-0 z-10 max-w-[15rem] -translate-y-2 rounded bg-red-600 px-3 py-2 text-[10px] normal-case tracking-normal text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">{fieldErrors[field]}</span> : null}</label>;
                  })}
                  <label className={`block text-xs uppercase tracking-[0.25em] ${fieldErrors.region ? 'text-red-600' : 'text-charcoal/55'}`}>Region<select required value={region} onChange={(event) => updateSignupField('region', event.target.value)} disabled={otpStep} className={`mt-3 w-full border-b bg-transparent px-0 py-3 text-base normal-case tracking-normal outline-none focus:border-gold ${fieldErrors.region ? 'border-red-500' : 'border-black/15'}`}><option value="">Select your region</option><option value="asia-india">Asia (India) · INR</option><option value="us">United States · USD</option><option value="europe">Europe · EUR</option><option value="anywhere-else">Anywhere else · USD</option></select>{fieldErrors.region ? <span className="text-[10px] normal-case tracking-normal text-red-600">{fieldErrors.region}</span> : null}</label>
                  {!otpStep ? <PasswordField label="Password" minLength={8} value={password} error={fieldErrors.password} onChange={(value) => updateSignupField('password', value)} onBlur={() => setFieldErrors((current) => ({ ...current, password: signupFieldError('password', password) || undefined }))} /> : null}
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
