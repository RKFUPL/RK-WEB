'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiBaseUrl } from '@/lib/rbac';
import { saleAccess, saleApi, saleButton, saleHeaders, type SaleCampaign } from './sale-admin-client';

export function SaleCampaignOverview() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const [campaign, setCampaign] = useState<SaleCampaign | null>(null);
  const [allowed, setAllowed] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [bannerPreview, setBannerPreview] = useState('');
  useEffect(() => { let active = true; void saleAccess().then(async access => { if (!active) return; setAllowed(access.allowed); if (!access.allowed) return; try { const data = await saleApi('/manage'); const found = (data.campaigns as SaleCampaign[]).find(item => item.id === campaignId); if (!found) throw new Error('Campaign not found.'); if (active) setCampaign(found); } catch (e) { if (active) setError(String(e)); } }); return () => { active = false; }; }, [campaignId]);
  useEffect(() => { let active = true; let objectUrl = ''; if (!campaign?.bannerUrl) { setBannerPreview(''); return; } void fetch(`${apiBaseUrl}/api/sales/manage/${campaign.id}/banner`, { credentials: 'include', headers: saleHeaders() }).then(response => response.ok ? response.blob() : null).then(blob => { if (active && blob) { objectUrl = URL.createObjectURL(blob); setBannerPreview(objectUrl); } }); return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); }; }, [campaign?.id, campaign?.bannerUrl, campaign?.revision]);
  async function action(publication: string) { if (!campaign) return; setBusy(true); setError(''); setNotice(''); try { const result = await saleApi(`/manage/${campaign.id}`, 'PUT', { revision: campaign.revision, publication }); setCampaign(result.campaign); setNotice(`Campaign ${publication}.`); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to update campaign.'); } finally { setBusy(false); } }
  if (!allowed) return <section className="rounded-2xl bg-[var(--admin-surface)] p-8">Sale access requires administrator permission.</section>;
  if (!campaign) return <section className="rounded-2xl bg-[var(--admin-surface)] p-8">{error || 'Loading campaign…'}</section>;
  return <section className="mx-auto max-w-5xl space-y-6 rounded-2xl bg-[var(--admin-surface)] p-5 sm:p-8">
    <Link href="/admin/sales" className="text-sm hover:underline">← Sale Management</Link>
    <header><p className="text-xs uppercase tracking-[.2em] text-red-700">Campaign overview</p><h1 className="mt-2 font-display text-3xl">{campaign.title}</h1><p className="mt-2 text-sm capitalize text-[var(--admin-muted)]">{campaign.type === 'custom' ? campaign.customType : campaign.type} · {campaign.state} · {campaign.publiclyVisible ? 'Storefront visible' : 'Not visible'}</p></header>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}{notice && <p role="status" className="text-sm text-green-800">{notice}</p>}
    <nav aria-label="Campaign sections" className="flex flex-wrap gap-2 border-b border-[var(--admin-border)] pb-4"><span className="rounded-lg bg-[var(--admin-muted)]/10 px-4 py-2 text-sm">Overview</span><Link className={saleButton} href={`/admin/sales/${campaign.id}/details`}>Edit Details</Link><Link className={saleButton} href={`/admin/sales/${campaign.id}/products`}>Manage Products</Link><Link className={saleButton} href={`/sale/${campaign.slug}`} target="_blank">Preview storefront</Link></nav>
    <div className="grid gap-4 sm:grid-cols-2"><div className="rounded-xl border border-[var(--admin-border)] p-4"><p className="text-xs uppercase tracking-wide text-[var(--admin-muted)]">Schedule</p><p className="mt-2">{new Date(campaign.startsAt).toLocaleString('en-IN', { timeZone: campaign.timezone })}</p><p>{new Date(campaign.endsAt).toLocaleString('en-IN', { timeZone: campaign.timezone })}</p><p className="mt-1 text-xs">{campaign.timezone}</p></div><div className="rounded-xl border border-[var(--admin-border)] p-4"><p className="text-xs uppercase tracking-wide text-[var(--admin-muted)]">Products assigned</p><p className="mt-2 text-2xl">{campaign.items?.length || 0}</p><p className="text-xs text-[var(--admin-muted)]">Manage assignments independently from campaign details.</p></div></div>
    {bannerPreview && <img src={bannerPreview} alt={`${campaign.title} campaign banner`} className="max-h-80 w-full object-contain" />}
    <div className="rounded-xl border border-[var(--admin-border)] p-5"><p className="text-xs uppercase tracking-wide text-[var(--admin-muted)]">Campaign preview</p><h2 className="mt-2 font-display text-2xl">{campaign.bannerHeading || campaign.title}</h2>{campaign.bannerSubtitle && <p className="mt-2">{campaign.bannerSubtitle}</p>}{campaign.description && <p className="mt-2 text-sm text-[var(--admin-muted)]">{campaign.description}</p>}<p className="mt-3 text-sm">/sale/{campaign.slug}</p></div>
    <div className="flex flex-wrap gap-2">{campaign.publication === 'published' ? <button className={saleButton} disabled={busy} onClick={() => void action('paused')}>Pause campaign</button> : campaign.publication !== 'archived' && <button className={saleButton} disabled={busy} onClick={() => void action('published')}>Publish campaign</button>}{campaign.publication !== 'archived' && <button className={`${saleButton} text-red-700`} disabled={busy} onClick={() => { if (confirm('Archive this campaign?')) void action('archived'); }}>Archive campaign</button>}</div>
  </section>;
}
