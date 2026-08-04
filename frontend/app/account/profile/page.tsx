'use client';

import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { RbacGuard } from '@/components/rbac-guard';
import { apiBaseUrl, getCurrentUser, type AuthUser } from '@/lib/rbac';
import { brandLogoUrl } from '@/lib/home-content';

type Profile = AuthUser & {
  profileImage?: string | null;
  firstName?: string;
  lastName?: string;
  dob?: string | null;
  gender?: string;
  phone?: string;
  language?: string;
  currency?: string;
  region?: string;
  newsletter?: boolean;
  marketingEmails?: boolean;
  whatsappNotifications?: boolean;
};

type ProfileForm = {
  profileImage: string | null;
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  phone: string;
  dob: string;
  gender: string;
  language: string;
  currency: string;
  region: string;
  newsletter: boolean;
  marketingEmails: boolean;
  whatsappNotifications: boolean;
};

type Address = { id: string; label?: string; fullName: string; phone: string; line1: string; line2?: string; city: string; state: string; postalCode: string; country: string; isDefault: boolean };
const emptyForm: ProfileForm = { profileImage: null, firstName: '', lastName: '', username: '', email: '', phone: '', dob: '', gender: '', language: 'English', region: 'asia-india', currency: 'INR', newsletter: false, marketingEmails: false, whatsappNotifications: false };
const inputClass = 'mt-3 w-full border-b border-black/10 bg-transparent px-0 py-3 text-sm outline-none transition placeholder:text-charcoal/30 focus:border-gold';
const cardClass = 'border border-white/70 bg-white/65 p-6 shadow-[0_20px_60px_rgba(42,38,34,0.06)] backdrop-blur-xl md:p-8';
const regionCurrency: Record<string, string> = { 'asia-india': 'INR', us: 'USD', europe: 'EUR', 'anywhere-else': 'USD' };

function toForm(user: Profile): ProfileForm {
  return {
    profileImage: user.profileImage ?? null, firstName: user.firstName ?? '', lastName: user.lastName ?? '', username: user.username ?? '', email: user.email,
    phone: user.phone ?? '', dob: user.dob ?? '', gender: user.gender ?? '', language: user.language ?? 'English', region: user.region ?? 'asia-india', currency: user.currency ?? 'INR',
    newsletter: user.newsletter ?? false, marketingEmails: user.marketingEmails ?? false, whatsappNotifications: user.whatsappNotifications ?? false,
  };
}

function Field({ label, value, onChange, error, type = 'text', placeholder, max }: { label: string; value: string; onChange?: (value: string) => void; error?: string; type?: string; placeholder?: string; max?: string }) {
  return <label className="group relative block text-[10px] uppercase tracking-[0.25em] text-charcoal/55">{label}<input type={type} value={value} max={max} placeholder={placeholder} readOnly={!onChange} aria-invalid={Boolean(error)} onChange={(event) => onChange?.(event.target.value)} className={`${inputClass} ${error ? 'border-red-500 text-red-700' : ''}`} />{error ? <span role="tooltip" className="pointer-events-none absolute right-0 top-0 z-10 max-w-[15rem] -translate-y-2 rounded bg-red-600 px-3 py-2 text-[10px] normal-case tracking-normal text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">{error}</span> : null}</label>;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="flex cursor-pointer items-center justify-between gap-5 border-b border-black/5 py-4 text-sm text-charcoal/75"><span>{label}</span><button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className={`relative h-6 w-11 rounded-full transition ${checked ? 'bg-charcoal' : 'bg-charcoal/15'}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition ${checked ? 'left-6' : 'left-1'}`} /></button></label>;
}

function ProfilePageContent() {
  const [user, setUser] = useState<Profile | null>(null);
  const [form, setForm] = useState<ProfileForm>(emptyForm);
  const [saved, setSaved] = useState<ProfileForm>(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [emailStep, setEmailStep] = useState<'idle' | 'code'>('idle');
  const [newEmail, setNewEmail] = useState('');
  const [emailOtp, setEmailOtp] = useState('');
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [addressOpen, setAddressOpen] = useState(false);
  const [addressBusy, setAddressBusy] = useState(false);
  const [addressForm, setAddressForm] = useState({ label: 'Home', fullName: '', phone: '', line1: '', line2: '', city: '', state: '', postalCode: '', country: 'India', isDefault: false });

  const token = () => window.localStorage.getItem('rk_access_token') ?? '';
  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(saved), [form, saved]);
  const initials = `${form.firstName.charAt(0)}${form.lastName.charAt(0)}`.toUpperCase() || form.username.slice(0, 2).toUpperCase() || 'RK';

  useEffect(() => {
    getCurrentUser().then((current) => {
      if (current) { const profile = current as Profile; const next = toForm(profile); setUser(profile); setForm(next); setSaved(next); fetch(`${apiBaseUrl}/api/auth/addresses`, { headers: { Authorization: `Bearer ${window.localStorage.getItem('rk_access_token') ?? ''}` } }).then((response) => response.ok ? response.json() : null).then((data) => data?.addresses && setAddresses(data.addresses)).catch(() => undefined); }
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(null), 4500); return () => window.clearTimeout(timer); }, [toast]);

  const setValue = <K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) => setForm((current) => ({ ...current, [key]: value }));

  const validate = () => {
    const next: Record<string, string> = {};
    if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(form.username)) next.username = 'Use 3–30 letters, numbers, dots, dashes, or underscores.';
    if (form.phone && !/^\+?[0-9\s().-]{7,20}$/.test(form.phone)) next.phone = 'Enter a valid phone number.';
    if (form.dob && new Date(`${form.dob}T00:00:00`) >= new Date()) next.dob = 'Date of birth cannot be in the future.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const chooseImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 3 * 1024 * 1024) { setToast({ type: 'error', text: 'Choose a JPG, PNG, or WebP image under 3 MB.' }); return; }
    const reader = new FileReader();
    reader.onload = () => setValue('profileImage', String(reader.result));
    reader.readAsDataURL(file);
  };

  const save = async () => {
    if (!validate()) return;
    setSaving(true); setToast(null);
    try {
      const response = await fetch(`${apiBaseUrl}/api/auth/profile`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` }, body: JSON.stringify(form) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'We could not save your profile.');
      const profile = data.user as Profile; const next = toForm(profile); setUser(profile); setForm(next); setSaved(next); setToast({ type: 'success', text: 'Your profile has been saved.' });
    } catch (error) { setToast({ type: 'error', text: error instanceof Error ? error.message : 'We could not save your profile.' }); } finally { setSaving(false); }
  };

  const deleteAccount = async () => {
    if (!window.confirm('Delete your account? This will sign you out and deactivate your profile.')) return;
    const response = await fetch(`${apiBaseUrl}/api/auth/profile`, { method: 'DELETE', headers: { Authorization: `Bearer ${token()}` } });
    if (!response.ok) { setToast({ type: 'error', text: 'We could not delete your account.' }); return; }
    window.localStorage.removeItem('rk_access_token'); window.location.assign('/account');
  };

  const requestEmailChange = async () => {
    if (!/^\S+@\S+\.\S+$/.test(newEmail)) { setToast({ type: 'error', text: 'Enter a valid new email address.' }); return; }
    const response = await fetch(`${apiBaseUrl}/api/auth/profile/email/request`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` }, body: JSON.stringify({ email: newEmail }) });
    const data = await response.json();
    if (!response.ok) { setToast({ type: 'error', text: data.error ?? 'Could not send verification code.' }); return; }
    setEmailStep('code'); setToast({ type: 'success', text: 'Verification code sent to your new email.' });
  };

  const verifyEmailChange = async () => {
    const response = await fetch(`${apiBaseUrl}/api/auth/profile/email/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` }, body: JSON.stringify({ otp: emailOtp }) });
    const data = await response.json();
    if (!response.ok) { setToast({ type: 'error', text: data.error ?? 'Invalid verification code.' }); return; }
    const profile = data.user as Profile; const next = toForm(profile); setUser(profile); setForm(next); setSaved(next); setEmailStep('idle'); setNewEmail(''); setEmailOtp(''); setToast({ type: 'success', text: 'Email address updated and verified.' });
  };

  const createAddress = async () => {
    setAddressBusy(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/auth/addresses`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` }, body: JSON.stringify(addressForm) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not save address.');
      setAddresses((current) => addressForm.isDefault ? [data.address, ...current.map((address) => ({ ...address, isDefault: false }))] : [...current, data.address]);
      setAddressForm({ label: 'Home', fullName: '', phone: '', line1: '', line2: '', city: '', state: '', postalCode: '', country: 'India', isDefault: false }); setAddressOpen(false); setToast({ type: 'success', text: 'Address saved.' });
    } catch (error) { setToast({ type: 'error', text: error instanceof Error ? error.message : 'Could not save address.' }); } finally { setAddressBusy(false); }
  };

  const removeAddress = async (id: string) => {
    const response = await fetch(`${apiBaseUrl}/api/auth/addresses/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token()}` } });
    if (response.ok) { setAddresses((current) => current.filter((address) => address.id !== id)); setToast({ type: 'success', text: 'Address removed.' }); }
  };

  if (loading) return <div className="mx-auto max-w-6xl animate-pulse"><div className="h-8 w-40 rounded bg-charcoal/10" /><div className="mt-8 h-32 rounded-2xl bg-charcoal/10" /><div className="mt-6 h-96 rounded-2xl bg-charcoal/10" /></div>;
  if (!user) return null;

  return <main className="min-h-screen bg-[radial-gradient(circle_at_top_right,_rgba(199,166,107,0.18),_transparent_35%),linear-gradient(135deg,#f8f6f2_0%,#f2eee7_100%)] px-5 py-8 text-charcoal md:px-10 lg:px-16">
    <header className="mx-auto flex max-w-6xl items-center"><a href="/" className="inline-flex"><img src={brandLogoUrl} alt="RK Logo" className="h-14 w-auto" /></a></header>
    <div className="mx-auto mt-16 max-w-6xl"><p className="text-[10px] uppercase tracking-[0.35em] text-gold">Personal space</p><div className="mt-3 flex flex-col justify-between gap-5 md:flex-row md:items-end"><div><h1 className="font-display text-6xl leading-none md:text-8xl">My profile.</h1><p className="mt-5 max-w-xl text-sm leading-7 text-charcoal/60">A quieter place to keep your RK experience personal.</p></div>{dirty ? <p className="text-xs text-charcoal/55">You have unsaved changes.</p> : null}</div></div>
    <div className="mx-auto mt-12 grid max-w-6xl gap-6 lg:grid-cols-[0.75fr_1.25fr]">
      <section className={`${cardClass} h-fit rounded-[2rem]`}><p className="text-[10px] uppercase tracking-[0.3em] text-charcoal/45">Profile picture</p><div className="mt-8 flex items-center gap-5"><div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full bg-charcoal text-2xl text-ivory">{form.profileImage ? <img src={form.profileImage} alt="Profile preview" className="h-full w-full object-cover" /> : initials}</div><div><p className="text-sm">{form.firstName || form.lastName ? `${form.firstName} ${form.lastName}` : 'Your initials'}</p><p className="mt-1 text-xs text-charcoal/45">JPG, PNG or WebP · 3 MB max</p><div className="mt-4 flex gap-4 text-[10px] uppercase tracking-[0.2em]"><label className="cursor-pointer text-gold hover:text-charcoal">{form.profileImage ? 'Change' : 'Upload'}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseImage} className="hidden" /></label>{form.profileImage ? <button type="button" onClick={() => setValue('profileImage', null)} className="text-charcoal/45 hover:text-red-600">Remove</button> : null}</div></div></div></section>
      <section className={`${cardClass} rounded-[2rem]`}><div className="flex items-end justify-between"><div><p className="text-[10px] uppercase tracking-[0.3em] text-charcoal/45">Personal information</p><h2 className="mt-3 font-display text-4xl">Tell us about you.</h2></div></div><div className="mt-10 grid gap-7 md:grid-cols-2"><Field label="First name" value={form.firstName} onChange={(value) => setValue('firstName', value)} /><Field label="Last name" value={form.lastName} onChange={(value) => setValue('lastName', value)} /><Field label="Username" value={form.username} onChange={(value) => setValue('username', value)} error={errors.username} /><Field label="Email" value={form.email} /><Field label="Phone number" value={form.phone} onChange={(value) => setValue('phone', value)} error={errors.phone} placeholder="+91 00000 00000" /><Field label="Date of birth · optional" type="date" value={form.dob} onChange={(value) => setValue('dob', value)} error={errors.dob} max={new Date().toISOString().slice(0, 10)} /><label className="block text-[10px] uppercase tracking-[0.25em] text-charcoal/55">Gender<select value={form.gender} onChange={(event) => setValue('gender', event.target.value)} className={inputClass}><option value="">Select</option><option value="male">Male</option><option value="female">Female</option><option value="prefer-not-to-say">Prefer not to say</option></select></label><label className="block text-[10px] uppercase tracking-[0.25em] text-charcoal/55">Region<select value={form.region} onChange={(event) => { const region = event.target.value; setForm((current) => ({ ...current, region, currency: regionCurrency[region] })); }} className={inputClass}><option value="asia-india">Asia (India)</option><option value="us">US</option><option value="europe">Europe</option><option value="anywhere-else">Anywhere else</option></select></label><label className="block text-[10px] uppercase tracking-[0.25em] text-charcoal/55">Currency<input value={form.currency} readOnly className={`${inputClass} cursor-not-allowed text-charcoal/50`} /></label></div></section>
      <section className={`${cardClass} rounded-[2rem] lg:col-start-2`}><div><p className="text-[10px] uppercase tracking-[0.3em] text-charcoal/45">Preferences</p><h2 className="mt-3 font-display text-4xl">Make it yours.</h2></div><div className="mt-7"><label className="block text-[10px] uppercase tracking-[0.25em] text-charcoal/55">Language<select value={form.language} onChange={(event) => setValue('language', event.target.value)} className={inputClass}><option>English</option><option>Hindi</option></select></label></div><div className="mt-5"><Toggle label="Newsletter subscription" checked={form.newsletter} onChange={(value) => setValue('newsletter', value)} /><Toggle label="Marketing emails" checked={form.marketingEmails} onChange={(value) => setValue('marketingEmails', value)} /><Toggle label="WhatsApp notifications" checked={form.whatsappNotifications} onChange={(value) => setValue('whatsappNotifications', value)} /></div></section>
      <section className={`${cardClass} rounded-[2rem] lg:col-span-2`}><div className="flex items-end justify-between"><div><p className="text-[10px] uppercase tracking-[0.3em] text-charcoal/45">Addresses</p><h2 className="mt-3 font-display text-4xl">Where should we send it?</h2></div><button type="button" onClick={() => setAddressOpen((current) => !current)} className="rounded-full bg-ink px-5 py-3 text-[10px] uppercase tracking-[0.2em] text-ivory transition hover:bg-gold">{addressOpen ? 'Close' : 'Add address'}</button></div>{addressOpen ? <div className="mt-8 grid gap-5 border-y border-black/5 py-7 md:grid-cols-3"><Field label="Label" value={addressForm.label} onChange={(value) => setAddressForm((current) => ({ ...current, label: value }))} /><Field label="Full name" value={addressForm.fullName} onChange={(value) => setAddressForm((current) => ({ ...current, fullName: value }))} /><Field label="Phone" value={addressForm.phone} onChange={(value) => setAddressForm((current) => ({ ...current, phone: value }))} placeholder="+91 00000 00000" /><Field label="Address line 1" value={addressForm.line1} onChange={(value) => setAddressForm((current) => ({ ...current, line1: value }))} /><Field label="Address line 2" value={addressForm.line2} onChange={(value) => setAddressForm((current) => ({ ...current, line2: value }))} /><Field label="City" value={addressForm.city} onChange={(value) => setAddressForm((current) => ({ ...current, city: value }))} /><Field label="State" value={addressForm.state} onChange={(value) => setAddressForm((current) => ({ ...current, state: value }))} /><Field label="Postal code" value={addressForm.postalCode} onChange={(value) => setAddressForm((current) => ({ ...current, postalCode: value }))} /><Field label="Country" value={addressForm.country} onChange={(value) => setAddressForm((current) => ({ ...current, country: value }))} /><label className="flex items-center gap-3 text-xs text-charcoal/65"><input type="checkbox" checked={addressForm.isDefault} onChange={(event) => setAddressForm((current) => ({ ...current, isDefault: event.target.checked }))} /> Make default</label><button type="button" disabled={addressBusy} onClick={createAddress} className="rounded-full bg-ink px-5 py-3 text-[10px] uppercase tracking-[0.2em] text-ivory disabled:opacity-40">{addressBusy ? 'Saving…' : 'Save address'}</button></div> : null}<div className="mt-7 grid gap-4 md:grid-cols-2">{addresses.length ? addresses.map((address) => <div key={address.id} className="border border-black/8 p-5"><div className="flex items-center justify-between"><p className="text-[10px] uppercase tracking-[0.2em] text-gold">{address.label || 'Address'} {address.isDefault ? '· Default' : ''}</p><button type="button" onClick={() => removeAddress(address.id)} className="text-[10px] uppercase tracking-[0.15em] text-charcoal/40 hover:text-red-600">Remove</button></div><p className="mt-4 text-sm">{address.fullName}</p><p className="mt-1 text-sm leading-6 text-charcoal/60">{address.line1}{address.line2 ? `, ${address.line2}` : ''}<br />{address.city}, {address.state} {address.postalCode}<br />{address.country} · {address.phone}</p></div>) : <p className="text-sm text-charcoal/50">No saved addresses yet.</p>}</div></section>
      <section className={`${cardClass} rounded-[2rem] lg:col-start-1 lg:row-start-3`}><p className="text-[10px] uppercase tracking-[0.3em] text-charcoal/45">Security</p><h2 className="mt-3 font-display text-4xl">Keep it yours.</h2><div className="mt-8 space-y-5"><button type="button" onClick={() => setToast({ type: 'success', text: 'Use Forgot password from the sign-in page to change your password.' })} className="flex w-full items-center justify-between border-b border-black/5 pb-5 text-left text-sm hover:text-gold">Change password <span>↗</span></button><div className="border-b border-black/5 pb-5"><div className="flex items-center justify-between text-sm"><span>Change email</span><span className="text-xs text-charcoal/45">Verification required</span></div>{emailStep === 'idle' ? <div className="mt-4 flex gap-3"><input value={newEmail} onChange={(event) => setNewEmail(event.target.value)} placeholder="new@email.com" className="min-w-0 flex-1 border-b border-black/15 bg-transparent py-2 text-sm outline-none focus:border-gold" /><button type="button" onClick={requestEmailChange} className="text-[10px] uppercase tracking-[0.16em] text-gold">Send code</button></div> : <div className="mt-4 flex gap-3"><input value={emailOtp} onChange={(event) => setEmailOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6-digit code" className="min-w-0 flex-1 border-b border-black/15 bg-transparent py-2 text-sm tracking-[0.25em] outline-none focus:border-gold" /><button type="button" onClick={verifyEmailChange} className="text-[10px] uppercase tracking-[0.16em] text-gold">Verify</button></div>}</div><button type="button" onClick={deleteAccount} className="text-sm text-red-700/70 hover:text-red-700">Delete account</button></div></section>
    </div>
    <div className="mx-auto mt-8 flex max-w-6xl flex-col-reverse gap-4 sm:flex-row sm:items-center sm:justify-between"><button type="button" onClick={() => { setForm(saved); setErrors({}); }} disabled={!dirty || saving} className="text-[10px] uppercase tracking-[0.22em] text-charcoal/45 transition hover:text-charcoal disabled:cursor-not-allowed disabled:opacity-30">Reset form</button><div className="flex gap-3"><button type="button" onClick={() => { setForm(saved); setErrors({}); }} disabled={!dirty || saving} className="rounded-full border border-black/15 px-7 py-4 text-[10px] uppercase tracking-[0.2em] transition hover:border-charcoal disabled:cursor-not-allowed disabled:opacity-30">Cancel changes</button><button type="button" onClick={save} disabled={!dirty || saving} className="rounded-full bg-ink px-8 py-4 text-[10px] uppercase tracking-[0.2em] text-ivory transition hover:bg-gold disabled:cursor-not-allowed disabled:opacity-30">{saving ? 'Saving…' : 'Save changes'}</button></div></div>
    {toast ? <div role="status" className={`fixed bottom-6 right-6 z-50 max-w-sm rounded-2xl px-5 py-4 text-sm text-white shadow-2xl ${toast.type === 'success' ? 'bg-charcoal' : 'bg-red-700'}`}>{toast.text}</div> : null}
  </main>;
}

export default function ProfilePage() {
  return <RbacGuard role="customer"><ProfilePageContent /></RbacGuard>;
}
