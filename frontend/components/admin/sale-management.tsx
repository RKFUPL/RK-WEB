'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { saleAccess, saleApi, saleButton, type SaleCampaign } from './sale-admin-client';

export function SaleManagement() {
  const [campaigns, setCampaigns] = useState<SaleCampaign[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [visible, setVisible] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [admin, setAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    const result = await saleApi('/manage');
    setCampaigns(result.campaigns || []);
    setSummary(result.summary || {});
    setVisible(result.salePageEnabled === true);
  }, []);

  useEffect(() => {
    let active = true;
    void saleAccess().then(async access => {
      if (!active) return;
      setAllowed(access.allowed); setAdmin(access.admin);
      if (access.allowed) try { await load(); } catch (e) { if (active) setError(String(e)); }
    });
    return () => { active = false; };
  }, [load]);

  async function run(action: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to update campaign.'); }
    finally { setBusy(false); }
  }

  async function setPublication(campaign: SaleCampaign, publication: string) {
    await run(async () => {
      await saleApi(`/manage/${campaign.id}`, 'PUT', { revision: campaign.revision, publication });
      await load(); setNotice(`Campaign ${publication === 'published' ? 'published' : publication}.`);
    });
  }

  if (!allowed) return <section className="rounded-2xl bg-[var(--admin-surface)] p-8"><h1 className="font-display text-3xl">Sale Management</h1><p className="mt-4">Sale access requires administrator permission.</p></section>;
  return <section className="space-y-6 rounded-2xl bg-[var(--admin-surface)] p-5 sm:p-8">
    <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs uppercase tracking-[.2em] text-red-700">Merchandising</p><h1 className="mt-2 font-display text-3xl">Sale Management</h1><p className="mt-2 text-sm text-[var(--admin-muted)]">Campaign details and sale products are managed separately.</p></div><Link className={saleButton} href="/admin/sales/new">Create campaign</Link></header>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}{notice && <p role="status" className="text-sm text-green-800">{notice}</p>}
    {admin && <label className="flex items-center gap-3 text-sm"><input type="checkbox" disabled={busy} checked={visible} onChange={e => { const next = e.currentTarget.checked; const previous = visible; setVisible(next); void run(async () => { try { const result = await saleApi('/visibility', 'PUT', { enabled: next }); setVisible(result.enabled); } catch (error) { setVisible(previous); throw error; } }); }} />Show Sale page on storefront</label>}
    <p className="text-xs text-[var(--admin-muted)]">SALE appears only when visibility is enabled and an eligible campaign is live. Overlapping campaigns use the lowest eligible price; equal prices use the stable campaign ID.</p>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{['live', 'scheduled', 'expired'].map(state => <div key={state} className="rounded-xl border border-[var(--admin-border)] p-4"><p className="text-xs capitalize">{state} campaigns</p><p className="mt-2 text-2xl">{summary[state] ?? campaigns.filter(c => c.state === state).length}</p></div>)}<div className="rounded-xl border border-[var(--admin-border)] p-4"><p className="text-xs">Products currently on sale</p><p className="mt-2 text-2xl">{summary.products ?? 0}</p></div></div>
    <div className="overflow-x-auto"><table className="w-full min-w-[880px] text-left text-sm"><thead><tr>{['Campaign', 'Type', 'Schedule', 'Products', 'Status / Visibility', 'Created by / Updated', 'Actions'].map(h => <th key={h} className="border-b p-3 font-medium">{h}</th>)}</tr></thead><tbody>{campaigns.map(c => <tr key={c.id}><td className="border-b p-3"><Link className="hover:underline" href={`/admin/sales/${c.id}`}>{c.title}</Link></td><td className="border-b p-3 capitalize">{c.type === 'custom' ? c.customType : c.type}</td><td className="border-b p-3 text-xs">{new Date(c.startsAt).toLocaleString('en-IN', { timeZone: c.timezone })}<br />{new Date(c.endsAt).toLocaleString('en-IN', { timeZone: c.timezone })}<br />{c.timezone}</td><td className="border-b p-3">{c.items?.length || 0}</td><td className="border-b p-3 capitalize">{c.state}<p className="text-xs">{c.publiclyVisible ? 'Visible' : 'Hidden'}</p></td><td className="border-b p-3 text-xs">{c.createdByLabel || c.createdBy || '—'}<br />{c.updatedAt && new Date(c.updatedAt).toLocaleString()}</td><td className="border-b p-3"><div className="flex flex-wrap gap-2"><Link className={saleButton} href={`/admin/sales/${c.id}/details`}>Edit Details</Link><Link className={saleButton} href={`/admin/sales/${c.id}/products`}>Manage Products</Link><Link className={saleButton} href={`/admin/sales/${c.id}`}>Preview</Link>{c.publication === 'published' ? <button className={saleButton} disabled={busy} onClick={() => void setPublication(c, 'paused')}>Pause</button> : c.publication !== 'archived' && <button className={saleButton} disabled={busy} onClick={() => void setPublication(c, 'published')}>Publish</button>}{c.publication !== 'archived' && <button className={`${saleButton} text-red-700`} disabled={busy} onClick={() => { if (confirm('Archive this campaign?')) void setPublication(c, 'archived'); }}>Archive</button>}</div></td></tr>)}</tbody></table></div>
    {!campaigns.length && <p className="rounded-xl border border-[var(--admin-border)] p-6 text-sm text-[var(--admin-muted)]">No campaigns yet. Create a campaign to begin.</p>}
  </section>;
}
