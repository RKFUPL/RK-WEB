'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiBaseUrl } from '@/lib/rbac';

type Integration = {
  provider: string;
  provider_name: string;
  status: 'connected' | 'not_connected' | 'disconnected' | 'error';
  smtp: { host: string; port: number; security: string };
  mailbox: string;
  senders: Record<string, string>;
  username_configured: boolean;
  password_configured: boolean;
  connected_at?: string | null;
  verified_at?: string | null;
  last_error?: string | null;
};

const senderLabels: Record<string, string> = { otp: 'OTP', orders: 'Orders', logistics: 'Logistics' };

export default function EmailIntegrationPage() {
  const [integration, setIntegration] = useState<Integration | null>(null);
  const [recipient, setRecipient] = useState('');
  const [sender, setSender] = useState('otp');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);

  const request = useCallback(async (path: string, init?: RequestInit) => {
    const token = window.localStorage.getItem('rk_access_token') ?? '';
    const response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
      cache: 'no-store',
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? 'Request failed.');
    return payload;
  }, []);

  const load = useCallback(async () => {
    try {
      const payload = await request('/api/admin/integrations/email');
      setIntegration(payload.integration);
    } catch (reason) {
      setNotice({ kind: 'error', text: reason instanceof Error ? reason.message : 'Unable to load the email integration.' });
    }
  }, [request]);

  useEffect(() => { void load(); }, [load]);

  const runAction = async (path: string, success: string) => {
    setBusy(true); setNotice(null);
    try {
      const payload = await request(path, { method: 'POST' });
      setIntegration(payload.integration);
      setNotice({ kind: 'success', text: success });
    } catch (reason) {
      setNotice({ kind: 'error', text: reason instanceof Error ? reason.message : 'The request could not be completed.' });
    } finally { setBusy(false); }
  };

  const disconnect = async () => {
    await runAction('/api/admin/integrations/email/disconnect', 'Zoho Mail disconnected.');
    setDisconnectOpen(false);
  };

  const sendTest = async () => {
    setBusy(true); setNotice(null);
    try {
      await request('/api/admin/integrations/email/test-send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipient, sender }),
      });
      setNotice({ kind: 'success', text: 'Test email sent successfully.' });
      setTestOpen(false); setRecipient(''); setSender('otp');
    } catch (reason) {
      setNotice({ kind: 'error', text: reason instanceof Error ? reason.message : 'Unable to send the test email.' });
    } finally { setBusy(false); }
  };

  if (!integration) return <section className="rounded-2xl border border-black/[.06] bg-white p-8 shadow-sm">Loading email integration…</section>;

  const connected = integration.status === 'connected';
  const errored = integration.status === 'error';
  const tone = connected ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : errored ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-800';
  const statusTitle = connected ? 'Zoho Mail is connected' : errored ? 'Zoho Mail connection error' : 'Zoho Mail is not connected';

  return <section className="space-y-6">
    <header>
      <p className="text-[10px] uppercase tracking-[.2em] text-[#9a7a4d]">Admin Studio · Integrations</p>
      <h1 className="mt-2 text-3xl font-semibold text-[#252525]">Email</h1>
      <p className="mt-1 text-lg text-[#6f7379]">Zoho Mail</p>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-[#858b94]">Connect Zoho Mail to send OTPs, account notifications, order emails, and logistics communications from your RK Fashion email addresses.</p>
    </header>

    {notice ? <div role="alert" className={`rounded-xl border px-4 py-3 text-sm ${notice.kind === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}>{notice.text}</div> : null}

    <div className={`rounded-2xl border p-6 shadow-sm md:p-8 ${tone}`}>
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div><span className="text-[10px] font-semibold uppercase tracking-[.18em]">{integration.status.replace('_', ' ')}</span><h2 className="mt-2 text-xl font-semibold">{statusTitle}</h2><p className="mt-2 text-sm opacity-80">{connected ? `Authenticated as ${integration.mailbox}` : 'SMTP credentials must be configured securely on the server before connecting.'}</p></div>
        <div className="flex flex-wrap gap-2">
          {!connected ? <button disabled={busy} onClick={() => void runAction('/api/admin/integrations/email/connect', 'Zoho Mail connected successfully.')} className="primary">Connect Zoho Mail</button> : null}
          <button disabled={busy} onClick={() => void runAction('/api/admin/integrations/email/test-connection', 'Zoho Mail connection verified.')} className="secondary">Test Connection</button>
          {connected ? <button disabled={busy} onClick={() => setTestOpen(true)} className="secondary">Send Test Email</button> : null}
        </div>
      </div>
      {integration.verified_at ? <p className="mt-5 text-xs opacity-75">Last verified {new Date(integration.verified_at).toLocaleString()}</p> : null}
      {integration.last_error ? <p className="mt-4 text-sm">{integration.last_error}</p> : null}
    </div>

    <div className="grid gap-6 xl:grid-cols-2">
      <article className="card"><h2 className="card-title">Zoho Mail configuration</h2><p className="card-copy">Credentials stay server-side. This page only reports whether they are configured.</p><dl className="mt-6 divide-y divide-black/[.06]">{[
        ['Provider', integration.provider_name], ['SMTP host', integration.smtp.host], ['SMTP port', integration.smtp.port], ['Security', integration.smtp.security], ['Authenticated mailbox', integration.mailbox], ['Username', integration.username_configured ? 'Configured' : 'Not configured'], ['Password / App Password', integration.password_configured ? 'Configured' : 'Not configured'],
      ].map(([label, value]) => <div key={String(label)} className="flex items-center justify-between gap-5 py-3 text-sm"><dt className="text-[#8a8f96]">{label}</dt><dd className="text-right font-medium text-[#303238]">{value}</dd></div>)}</dl></article>

      <article className="card"><h2 className="card-title">Sender aliases</h2><p className="card-copy">Approved sender identities enforced by the mail service.</p><div className="mt-6 space-y-3">{Object.entries(integration.senders).map(([key, address]) => <div key={key} className="rounded-xl border border-black/[.06] bg-[#faf9f7] px-4 py-3"><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-[#9a7a4d]">{senderLabels[key] ?? key}</p><p className="mt-1 break-all text-sm font-medium text-[#303238]">{address}</p></div>)}</div><p className="mt-5 text-xs leading-5 text-[#858b94]">These addresses are configured as Zoho Mail aliases of the authenticated mailbox.</p></article>
    </div>

    {connected ? <article className="card border-red-100"><h2 className="card-title">Disconnect Zoho Mail</h2><p className="card-copy">This removes only the saved connection state. It does not change credentials, aliases, users, OTP records, or orders.</p><button disabled={busy} onClick={() => setDisconnectOpen(true)} className="mt-5 rounded-lg border border-red-200 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[.14em] text-red-600 disabled:opacity-40">Disconnect Zoho Mail</button></article> : null}

    {testOpen ? <Modal title="Send Test Email" onClose={() => !busy && setTestOpen(false)}><p className="text-sm text-[#747980]">Send a test email using the selected Zoho Mail sender.</p><label className="field"><span>Recipient email</span><input autoFocus type="email" value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="name@example.com" /></label><label className="field"><span>Sender</span><select value={sender} onChange={(event) => setSender(event.target.value)}>{Object.entries(integration.senders).map(([key, address]) => <option key={key} value={key}>{senderLabels[key]} — {address}</option>)}</select></label><div className="modal-actions"><button className="secondary" disabled={busy} onClick={() => setTestOpen(false)}>Cancel</button><button className="primary" disabled={busy || !recipient} onClick={() => void sendTest()}>Send Test Email</button></div></Modal> : null}
    {disconnectOpen ? <Modal title="Disconnect Zoho Mail?" onClose={() => !busy && setDisconnectOpen(false)}><p className="text-sm leading-6 text-[#747980]">OTP and other application emails will no longer be sent through Zoho Mail until the connection is restored.</p><div className="modal-actions"><button className="secondary" disabled={busy} onClick={() => setDisconnectOpen(false)}>Cancel</button><button disabled={busy} onClick={() => void disconnect()} className="rounded-lg bg-red-600 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[.14em] text-white disabled:opacity-40">Disconnect</button></div></Modal> : null}

    <style jsx>{`.card{border:1px solid rgba(0,0,0,.06);border-radius:1rem;background:#fff;padding:1.5rem;box-shadow:0 1px 2px rgba(0,0,0,.04)}.card-title{font-size:1.05rem;font-weight:600;color:#303238}.card-copy{margin-top:.5rem;font-size:.875rem;line-height:1.5;color:#858b94}.primary,.secondary{border-radius:.5rem;padding:.65rem 1rem;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.14em}.primary{background:#9a7a4d;color:white}.secondary{border:1px solid currentColor;background:white;color:#8a693f}.primary:disabled,.secondary:disabled{opacity:.4}.field{display:block;margin-top:1.25rem}.field span{display:block;margin-bottom:.4rem;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.14em;color:#8a8f96}.field input,.field select{width:100%;border:1px solid rgba(0,0,0,.12);border-radius:.55rem;padding:.7rem .8rem;font-size:.875rem}.modal-actions{margin-top:1.5rem;display:flex;justify-content:flex-end;gap:.6rem}`}</style>
  </section>;
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div role="dialog" aria-modal="true" aria-labelledby="email-modal-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><h2 id="email-modal-title" className="text-xl font-semibold text-[#303238]">{title}</h2><button type="button" aria-label="Close" onClick={onClose} className="text-xl text-[#8a8f96]">×</button></div><div className="mt-4">{children}</div></div></div>;
}
