'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { campaignWallTime } from '@/lib/sales';
import { apiBaseUrl } from '@/lib/rbac';
import { saleAccess, saleApi, saleButton, saleField, saleHeaders, type SaleCampaign } from './sale-admin-client';

const emptyCampaign = (): Partial<SaleCampaign> => ({ title: '', type: 'festive', customType: '', slug: '', description: '', startsAt: '', endsAt: '', timezone: 'Asia/Kolkata', publication: 'draft', bannerHeading: '', bannerSubtitle: '', ctaLabel: '', ctaDestination: '' });

export function SaleCampaignDetails({ create = false }: { create?: boolean }) {
  const params = useParams<{ campaignId?: string }>();
  const router = useRouter();
  const id = params?.campaignId || '';
  const [campaign, setCampaign] = useState<Partial<SaleCampaign>>(create ? emptyCampaign() : {});
  const [allowed, setAllowed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [posterUrl, setPosterUrl] = useState('');
  const [bannerAltText, setBannerAltText] = useState('');
  const [bannerPreview, setBannerPreview] = useState('');
  const [videoMetadata, setVideoMetadata] = useState('');
  const [videoPreviewError, setVideoPreviewError] = useState('');
  const [runnerPreview,setRunnerPreview] = useState('');
  useEffect(()=>{if(!allowed)return;const controller=new AbortController();const timer=setTimeout(()=>{void saleApi('/manage/announcement-preview','POST',campaign,controller.signal).then(result=>setRunnerPreview(result.message)).catch(()=>{if(!controller.signal.aborted)setRunnerPreview('Enter a valid announcement schedule to preview the message.');});},250);return()=>{clearTimeout(timer);controller.abort();};},[allowed,campaign]);

  useEffect(() => { let active = true; void saleAccess().then(async access => { if (!active) return; setAllowed(access.allowed); if (!access.allowed || create) return; try { const data = await saleApi('/manage'); const found = (data.campaigns as SaleCampaign[]).find(item => item.id === id); if (!found) throw new Error('Campaign not found.'); if (active) setCampaign(found); } catch (e) { if (active) setError(String(e)); } }); return () => { active = false; }; }, [create, id]);

  useEffect(() => { let objectUrl = ''; let active = true; setVideoMetadata(''); setVideoPreviewError(''); if (!campaign.bannerUrl || !campaign.id) { setBannerPreview(''); return; }
    if (/^https:\/\//i.test(campaign.bannerUrl)) { setBannerPreview(campaign.bannerUrl); return () => { active = false; }; }
    const previewPath = campaign.bannerMediaType === 'video' ? 'banner-media' : 'banner';
    void fetch(`${apiBaseUrl}/api/sales/manage/${campaign.id}/${previewPath}`, { credentials: 'include', headers: saleHeaders() }).then(r => r.ok ? r.blob() : null).then(blob => { if (active && blob) { objectUrl = URL.createObjectURL(blob); setBannerPreview(objectUrl); } }); return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); }; }, [campaign.id, campaign.bannerUrl, campaign.bannerMediaType, campaign.revision]);

  function change(key: keyof SaleCampaign, value: string | boolean) { setCampaign(current => ({ ...current, [key]: value })); }
  async function run(action: () => Promise<void>) { setBusy(true); setError(''); setNotice(''); try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save campaign.'); } finally { setBusy(false); } }
  async function save() {
    await run(async () => {
      const campaignFields = {
        title: campaign.title, type: campaign.type, customType: campaign.customType, description: campaign.description,
        slug: campaign.slug, startsAt: campaign.startsAt, endsAt: campaign.endsAt, timezone: campaign.timezone,
        publication: create ? 'draft' : campaign.publication || 'draft', bannerHeading: campaign.bannerHeading,
        bannerSubtitle: campaign.bannerSubtitle, ctaLabel: campaign.ctaLabel, ctaDestination: campaign.ctaDestination,
        showAnnouncementRunner: campaign.showAnnouncementRunner ?? false,
        announcementFeatured: campaign.announcementFeatured ?? false,
        announcementStartsAt: campaign.announcementStartsAt || null,
      };
      const result = await saleApi(campaign.id ? `/manage/${campaign.id}` : '/manage', campaign.id ? 'PUT' : 'POST', campaign.id ? { ...campaignFields, revision: campaign.revision } : campaignFields);
      const saved = result.campaign as SaleCampaign; setCampaign(saved); setNotice('Campaign details saved.');
      if (!campaign.id) router.push(`/admin/sales/${saved.id}`);
    });
  }
  async function uploadBanner(body: FormData | object) {
    if (!campaign.id) return;
    await run(async () => { const value = body instanceof FormData ? body : { ...body, revision: campaign.revision }; if (value instanceof FormData) value.set('revision', String(campaign.revision)); const result = await saleApi(`/manage/${campaign.id}/banner`, 'POST', value); setCampaign(result.campaign); setNotice('Banner verified and saved.'); });
  }
  if (!allowed) return <section className="rounded-2xl bg-[var(--admin-surface)] p-8">Sale access requires administrator permission.</section>;
  const title = create ? 'Create campaign' : campaign.title || 'Campaign details';
  return <section className="mx-auto max-w-5xl space-y-6 rounded-2xl bg-[var(--admin-surface)] p-5 sm:p-8">
    <nav className="flex flex-wrap gap-3 text-sm"><Link href="/admin/sales" className="hover:underline">← Sale Management</Link>{campaign.id && <Link href={`/admin/sales/${campaign.id}`} className="hover:underline">Overview</Link>}</nav>
    <header><p className="text-xs uppercase tracking-[.2em] text-red-700">Campaign details</p><h1 className="mt-2 font-display text-3xl">{title}</h1><p className="mt-2 text-sm text-[var(--admin-muted)]">{create ? 'New campaigns are saved as drafts. Add products and publish separately.' : 'Edit campaign information, schedule and banner. Product assignments are kept separate.'}</p></header>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}{notice && <p role="status" className="text-sm text-green-800">{notice}</p>}
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="text-xs">Campaign title<input aria-label="Campaign title" className={`${saleField} mt-2`} value={campaign.title || ''} onChange={e => change('title', e.target.value)} /></label>
      <label className="text-xs">Campaign type<select aria-label="Campaign type" className={`${saleField} mt-2`} value={campaign.type || 'festive'} onChange={e => change('type', e.target.value)}>{['festive','annual','thrift','clearance','seasonal','wedding','custom'].map(t => <option key={t} value={t}>{t}</option>)}</select></label>
      {campaign.type === 'custom' && <label className="text-xs">Custom type<input className={`${saleField} mt-2`} value={campaign.customType || ''} onChange={e => change('customType', e.target.value)} /></label>}
      <label className="text-xs">Description / subtitle<input className={`${saleField} mt-2`} value={campaign.description || ''} onChange={e => change('description', e.target.value)} /></label>
      {!campaign.id && <label className="text-xs">URL slug<input className={`${saleField} mt-2`} value={campaign.slug || ''} onChange={e => change('slug', e.target.value)} placeholder="Generated from title if blank" /></label>}
      <label className="text-xs">Time zone<input className={`${saleField} mt-2`} value={campaign.timezone || 'Asia/Kolkata'} onChange={e => change('timezone', e.target.value)} /></label>
      {(['startsAt','endsAt'] as const).map(key => <label className="text-xs" key={key}>{key === 'startsAt' ? 'Start date and time' : 'End date and time'}<input aria-label={key === 'startsAt' ? 'Start date and time' : 'End date and time'} className={`${saleField} mt-2`} type="datetime-local" value={campaign[key] ? campaignWallTime(campaign[key]!, campaign.timezone || 'Asia/Kolkata') : ''} onChange={e => change(key, e.target.value)} /><span className="mt-1 block text-[var(--admin-muted)]">{campaign.timezone || 'Asia/Kolkata'}</span></label>)}
      <label className="text-xs">Banner heading<input className={`${saleField} mt-2`} value={campaign.bannerHeading || ''} onChange={e => change('bannerHeading', e.target.value)} /></label>
      <label className="text-xs">Banner subtitle<input className={`${saleField} mt-2`} value={campaign.bannerSubtitle || ''} onChange={e => change('bannerSubtitle', e.target.value)} /></label>
      <label className="text-xs">CTA heading / label<input className={`${saleField} mt-2`} value={campaign.ctaLabel || ''} onChange={e => change('ctaLabel', e.target.value)} /></label>
      <label className="text-xs">CTA destination<input className={`${saleField} mt-2`} value={campaign.ctaDestination || ''} onChange={e => change('ctaDestination', e.target.value)} placeholder="/collections/aakaar" /></label>
    </div>
    <section aria-label="Announcement Runner" className="space-y-4 rounded-xl border border-[var(--admin-border)] p-4">
      <h2 className="font-display text-xl">Announcement Runner</h2>
      <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={campaign.showAnnouncementRunner??false} onChange={e=>change('showAnnouncementRunner',e.target.checked)}/>Enable announcement runner</label>
      <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={campaign.announcementFeatured??false} onChange={e=>change('announcementFeatured',e.target.checked)}/>Feature this campaign in the runner</label>
      <label className="block text-xs">Announcement start date and time<input aria-label="Announcement start date and time" type="datetime-local" className={`${saleField} mt-2`} value={campaign.announcementStartsAt?campaignWallTime(campaign.announcementStartsAt,campaign.timezone||'Asia/Kolkata'):''} onChange={e=>change('announcementStartsAt',e.target.value)}/><span className="mt-1 block text-[var(--admin-muted)]">{campaign.timezone||'Asia/Kolkata'}</span></label>
      <p className="text-xs leading-6 text-[var(--admin-muted)]">The runner may begin before the sale. Pre-launch clicks open a banner-only teaser; launch switches to the live Sale page automatically. Pausing or ending a campaign removes its runner. Featured campaigns take priority; ties use launch time and campaign ID.</p>
      <p className="text-sm" aria-live="polite">Schedule message preview: {runnerPreview||'Enter the campaign schedule.'}</p>
    </section>
    <p className="text-xs text-[var(--admin-muted)]">Sale URL: /sale/{campaign.slug || 'generated-on-save'}</p>
    <div className="flex flex-wrap gap-2"><button className={saleButton} disabled={busy} onClick={() => void save()}>{create ? 'Save draft' : 'Save details'}</button>{campaign.id && <Link className={saleButton} href={`/admin/sales/${campaign.id}/products`}>Manage Products</Link>}</div>
    {campaign.id && <section className="space-y-4 rounded-xl border border-[var(--admin-border)] p-4"><h2 className="font-display text-xl">Campaign Banner Media</h2>
      {bannerPreview && (campaign.bannerMediaType === 'video' ? <video aria-label="Campaign banner preview" className="max-h-72 w-full bg-black object-contain" controls playsInline preload="metadata" poster={campaign.bannerPosterUrl || undefined} onLoadedMetadata={event => { const video = event.currentTarget; setVideoMetadata(`${Math.round(video.duration)} sec · ${video.videoWidth} × ${video.videoHeight}`); setVideoPreviewError(''); }} onError={() => setVideoPreviewError('This browser could not play the video. Try a browser-compatible H.264 MP4.')}><source src={bannerPreview} type={campaign.bannerMimeType || undefined}/></video> : <img src={bannerPreview} alt={campaign.bannerAltText || 'Campaign banner preview'} className="max-h-56 w-full object-contain" />)}
      {videoMetadata && <p className="text-xs text-[var(--admin-muted)]">Video · {videoMetadata}</p>}{videoPreviewError && <p role="status" className="text-xs text-amber-800">{videoPreviewError}{campaign.bannerPosterUrl ? ' The poster remains available as a fallback.' : ''}</p>}
      {campaign.bannerUrl && <p className="text-xs text-[var(--admin-muted)]">Type: {(campaign.bannerMediaType || 'image') === 'video' ? 'Video' : 'Image'} · Format: {campaign.bannerMimeType || 'image/jpeg'}{campaign.bannerMediaSize ? ` · ${(campaign.bannerMediaSize / (1024 * 1024)).toFixed(2)} MB` : ''}{campaign.bannerSourceHost ? ` · ${campaign.bannerSourceHost}` : campaign.bannerMediaSource ? ` · ${campaign.bannerMediaSource}` : ''}</p>}
      <label className="block text-xs">Upload image or video (JPG, PNG, WebP up to 5 MB · MP4, MOV, WebM, M4V up to 100 MB)<input aria-label="Upload campaign media" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm,video/x-m4v,.m4v" className="mt-2 block max-w-full text-xs" disabled={busy} onChange={e => { const file = e.currentTarget.files?.[0]; if (file) { const body = new FormData(); body.append('file', file); body.append('posterUrl', posterUrl); body.append('altText', bannerAltText); void uploadBanner(body); } }} /></label>
      <div className="flex flex-col gap-2 sm:flex-row"><input aria-label="Campaign media URL" className={`${saleField} flex-1`} value={mediaUrl} onChange={e => setMediaUrl(e.target.value)} placeholder="Media URL (WorkDrive or direct HTTPS link)" /><button className={saleButton} disabled={busy || !mediaUrl} onClick={() => void uploadBanner({ mediaUrl, posterUrl, altText: bannerAltText })}>Verify and use media</button>{campaign.bannerUrl && <button className={saleButton} disabled={busy} onClick={() => void run(async () => { const result = await saleApi(`/manage/${campaign.id}/banner`, 'DELETE', { revision: campaign.revision }); setCampaign(result.campaign); setNotice('Banner media removed.'); })}>Remove banner</button>}</div>
      <label className="block text-xs">Image alt text<input aria-label="Campaign banner alt text" className={`${saleField} mt-2`} value={bannerAltText} onChange={e => setBannerAltText(e.target.value)} placeholder="Describe the campaign image" /></label>
      {campaign.bannerMediaType === 'video' && <p className="text-xs text-[var(--admin-muted)]">Play the preview to confirm it works in your browser. Codec support varies for MOV; H.264 MP4 is recommended. Uploaded media is not transcoded.</p>}
      <label className="block text-xs">Optional public image poster URL<input aria-label="Video poster image URL" className={`${saleField} mt-2`} value={posterUrl} onChange={e => setPosterUrl(e.target.value)} placeholder="Poster image HTTPS URL (optional)" /></label>
    </section>}
  </section>;
}
