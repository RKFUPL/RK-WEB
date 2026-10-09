'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiBaseUrl } from '@/lib/rbac';

type Asset = { key: string; collection: string; kind: string };
type Integration = {
  provider: string;
  status: 'connected' | 'not_connected' | 'error';
  configured: { client_id: boolean; client_secret: boolean; refresh_token: boolean };
  last_token_refresh_at?: string | null;
  last_file_retrieval_at?: string | null;
  last_error_category?: string | null;
  remediation?: string | null;
  approved_assets: Asset[];
  reconnect_available: boolean;
  oauth_configured: { client_id: boolean; client_secret: boolean; redirect_uri: boolean; redirect_uri_valid: boolean; token_encryption_key: boolean };
  reconnect_requirement?: string;
};

export default function WorkDriveIntegrationPage() {
  const [integration, setIntegration] = useState<Integration | null>(null);
  const [asset, setAsset] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

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
      const payload = await request('/api/admin/integrations/workdrive');
      setIntegration(payload.integration);
      setAsset((current) => current || payload.integration.approved_assets?.[0]?.key || '');
    } catch (reason) {
      setNotice({ kind: 'error', text: reason instanceof Error ? reason.message : 'Unable to load WorkDrive status.' });
    }
  }, [request]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('oauth') === 'connected') setNotice({ kind: 'success', text: 'WorkDrive connected successfully.' });
    if (params.get('oauth') === 'error') setNotice({ kind: 'error', text: `WorkDrive connection failed: ${params.get('reason') || 'oauth_failed'}.` });
  }, []);

  const run = async (path: string, body?: object) => {
    setBusy(true); setNotice(null);
    try {
      const payload = await request(path, {
        method: 'POST',
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
      });
      setIntegration(payload.integration);
      const detail = payload.result ? ` HTTP ${payload.result.status}, ${payload.result.content_type}.` : '';
      setNotice({ kind: 'success', text: `WorkDrive verification succeeded.${detail}` });
    } catch (reason) {
      setNotice({ kind: 'error', text: reason instanceof Error ? reason.message : 'WorkDrive verification failed.' });
      await load();
    } finally { setBusy(false); }
  };

  const connect = async () => {
    setBusy(true); setNotice(null);
    try {
      const payload = await request('/api/admin/integrations/workdrive/oauth/start', { method: 'POST' });
      window.location.assign(payload.authorization_url);
    } catch (reason) {
      setNotice({ kind: 'error', text: reason instanceof Error ? reason.message : 'Unable to start WorkDrive connection.' });
      setBusy(false);
    }
  };

  if (!integration) return <section className="rounded-2xl border border-black/[.06] bg-white p-8 shadow-sm">Loading WorkDrive integration…</section>;

  const connected = integration.status === 'connected';
  const tone = connected ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : integration.status === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-800';

  return <section className="space-y-6">
    <header><p className="text-[10px] uppercase tracking-[.2em] text-[#9a7a4d]">Admin Studio · Integrations</p><h1 className="mt-2 text-3xl font-semibold text-[#252525]">WorkDrive Connect</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-[#858b94]">Verify server-side Zoho WorkDrive access for approved collection covers and lookbooks. Credentials and tokens are never returned to this page.</p></header>
    {notice ? <div role="alert" className={`rounded-xl border px-4 py-3 text-sm ${notice.kind === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}>{notice.text}</div> : null}
    <article className={`rounded-2xl border p-6 shadow-sm md:p-8 ${tone}`}><div className="flex flex-wrap items-start justify-between gap-5"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em]">{integration.status.replace('_', ' ')}</p><h2 className="mt-2 text-xl font-semibold">Zoho WorkDrive</h2>{integration.last_error_category ? <p className="mt-2 text-sm">Error category: {integration.last_error_category}</p> : null}{integration.remediation ? <p className="mt-2 max-w-2xl text-sm opacity-80">{integration.remediation}</p> : null}</div><button disabled={busy} onClick={() => void run('/api/admin/integrations/workdrive/test-connection')} className="primary">Test Connection</button></div></article>
    <div className="grid gap-6 xl:grid-cols-2">
      <article className="card"><h2 className="card-title">Server configuration</h2><p className="card-copy">Only configuration presence is shown.</p><dl className="mt-5 divide-y divide-black/[.06]">{[['Client ID', integration.configured.client_id], ['Client secret', integration.configured.client_secret], ['Refresh token', integration.configured.refresh_token]].map(([label, value]) => <div key={String(label)} className="flex justify-between py-3 text-sm"><dt className="text-[#8a8f96]">{label}</dt><dd className="font-medium text-[#303238]">{value ? 'Configured' : 'Missing'}</dd></div>)}</dl>{integration.last_token_refresh_at ? <p className="mt-4 text-xs text-[#858b94]">Last token refresh: {new Date(integration.last_token_refresh_at).toLocaleString()}</p> : null}{integration.last_file_retrieval_at ? <p className="mt-2 text-xs text-[#858b94]">Last file retrieval: {new Date(integration.last_file_retrieval_at).toLocaleString()}</p> : null}</article>
      <article className="card"><h2 className="card-title">Test configured file access</h2><p className="card-copy">Only assets already configured in the Lookbooks manager can be tested.</p><select value={asset} onChange={(event) => setAsset(event.target.value)} className="mt-5 w-full rounded-lg border border-black/10 bg-white px-3 py-2.5 text-sm">{integration.approved_assets.map((item) => <option key={item.key} value={item.key}>{item.collection} — {item.kind}</option>)}</select><button disabled={busy || !asset} onClick={() => void run('/api/admin/integrations/workdrive/test-file', { asset })} className="primary mt-4">Test File Access</button></article>
    </div>
    <article className="card"><div className="flex flex-wrap items-center justify-between gap-5"><div><h2 className="card-title">{integration.status === 'not_connected' ? 'Connect WorkDrive' : 'Reconnect WorkDrive'}</h2><p className="card-copy">Authorize the Zoho India account that owns or can access the configured lookbook files. Tokens are stored encrypted on the server and are never returned to the browser.</p>{integration.reconnect_requirement ? <p className="mt-3 text-xs text-[#858b94]">{integration.reconnect_requirement}</p> : null}</div><button disabled={busy || !integration.reconnect_available} onClick={() => void connect()} className="primary">{integration.status === 'not_connected' ? 'Connect WorkDrive' : 'Reconnect WorkDrive'}</button></div></article>
    <style jsx>{`.card{border:1px solid rgba(0,0,0,.06);border-radius:1rem;background:#fff;padding:1.5rem;box-shadow:0 1px 2px rgba(0,0,0,.04)}.card-title{font-size:1.05rem;font-weight:600;color:#303238}.card-copy{margin-top:.5rem;font-size:.875rem;line-height:1.5;color:#858b94}.primary{border-radius:.5rem;background:#9a7a4d;padding:.65rem 1rem;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.14em;color:#fff}.primary:disabled{opacity:.4}`}</style>
  </section>;
}
