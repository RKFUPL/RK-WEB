'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

type Template = {
  name: string; category: string; language: string; parameters: string[]; approved: boolean; enabled: boolean;
  observedStatus?: string; statusStale?: boolean; componentsVerified?: boolean;
  components?: { type: string; text?: string; format?: string }[];
  metaComponents?: { type: string; text?: string; format?: string; buttons?: { type: string; text: string; url?: string }[] }[];
};
type Options = {
  collections?: { id: string; name: string; slug: string; path: string; productCount: number }[];
  templates?: Record<string, Template>;
  unavailableTemplates?: Record<string, { name: string; language: string; category: string; reason: string }>;
  marketingEnabled?: boolean; couponIntegrationAvailable?: boolean;
};
type Preview = {
  template: Template; recipientCount: number; excluded: Record<string, number>;
  samples: { recipient: string; body: string; variables: Record<string, string> }[];
  previewDigest: string; canAuthorize: boolean; disabledReasons: string[];
  destinationUrl: string; destinationReachable: boolean;
};
type Props = { request: (path: string, init?: RequestInit) => Promise<unknown> };
const reasons: Record<string, string> = {
  marketing_automation_disabled: 'Marketing campaigns are disabled.',
  template_not_approved_or_enabled: 'This draft is preview-only until the exact Meta template is approved and locally enabled.',
  no_eligible_recipients: 'No customers in this audience have eligible marketing consent and complete variables.',
  public_destination_unavailable: 'The public destination could not be verified.',
  coupon_integration_unavailable: 'Unavailable – Coupon integration not configured.',
  campaign_expiry_required: 'Set a future campaign expiry.',
  canonical_url_not_configured: 'The canonical destination domain is not configured.',
};
const field = 'mt-2 block w-full rounded-lg border border-black/25 bg-white p-2.5 text-sm text-gray-950 placeholder:text-gray-500';
const statusLabel = (template: Template) => {
  const status = template.observedStatus ?? 'MISSING_OR_UNKNOWN';
  if (status === 'PENDING' || status === 'IN_REVIEW') return 'PENDING / IN_REVIEW';
  if (status === 'NOT_CHECKED' || status === 'NOT_SUBMITTED') return 'MISSING_OR_UNKNOWN';
  return status;
};

export function WhatsAppCampaigns({ request }: Props) {
  const [options, setOptions] = useState<Options>({});
  const [form, setForm] = useState({ event: 'new_collection_drop', collectionId: '', description: '', expiresAt: '', scheduledAt: '', audience: 'all_marketing_consent' });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [templateSearch, setTemplateSearch] = useState('');
  const [templateOpen, setTemplateOpen] = useState(false);
  const [activeOption, setActiveOption] = useState(0);
  const requestId = useRef('');
  const draftRequestId = useRef('');
  const picker = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    void request('/campaigns/options').then(data => { if (active) setOptions(data as Options); })
      .catch(() => { if (active) setNotice('Campaign choices could not be loaded.'); });
    return () => { active = false; };
  }, [request]);
  useEffect(() => {
    const close = (event: PointerEvent) => { if (picker.current && !picker.current.contains(event.target as Node)) setTemplateOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);

  const entries = useMemo(() => Object.entries(options.templates ?? {}), [options.templates]);
  const selected = entries.find(([event]) => event === form.event)?.[1];
  const choices = entries.filter(([, template]) => `${template.name} ${template.category} ${template.language} ${statusLabel(template)}`.toLowerCase().includes(templateSearch.trim().toLowerCase()));
  const sendEligibleCount = entries.filter(([, template]) => template.enabled && template.approved && template.observedStatus === 'APPROVED' && template.componentsVerified && !template.statusStale).length;

  const change = (key: keyof typeof form, value: string) => {
    setForm(current => ({ ...current, [key]: value })); setPreview(null); setConfirmed(false); requestId.current = ''; draftRequestId.current = '';
  };
  const selectTemplate = (event: string) => {
    change('event', event); setTemplateSearch(''); setTemplateOpen(false); setActiveOption(0);
  };
  const payload = () => ({ ...form, expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : '', scheduledAt: form.scheduledAt ? new Date(form.scheduledAt).toISOString() : undefined });
  const buildPreview = async () => {
    setBusy(true); setNotice(''); setConfirmed(false);
    try { setPreview(await request('/campaigns/preview', { method: 'POST', body: JSON.stringify(payload()) }) as Preview); }
    catch (error) { const value = error instanceof Error ? error.message : 'Preview unavailable'; setNotice(reasons[value] || value); }
    finally { setBusy(false); }
  };
  const saveDraft = async () => {
    if (form.event !== 'new_collection_drop' || !form.collectionId || !form.expiresAt) return;
    setBusy(true); setNotice('');
    if (!draftRequestId.current) draftRequestId.current = crypto.randomUUID();
    try {
      const result = await request('/campaigns/drafts', { method: 'POST', body: JSON.stringify({ ...payload(), requestId: draftRequestId.current }) }) as { status: string; draftId: string; templateStatus: string; destinationUrl: string };
      setNotice(`Campaign draft saved (${result.status}). Reference: ${result.draftId}. Template status: ${statusLabel({ name: '', language: '', category: '', parameters: [], approved: false, enabled: false, observedStatus: result.templateStatus })}. Destination: ${result.destinationUrl}. No recipients were queued.`);
    } catch (error) { const value = error instanceof Error ? error.message : 'Campaign draft could not be saved.'; setNotice(reasons[value] || value); }
    finally { setBusy(false); }
  };
  const authorize = async () => {
    if (!preview?.canAuthorize || !confirmed) return;
    setBusy(true); setNotice('');
    if (!requestId.current) requestId.current = crypto.randomUUID();
    try {
      const result = await request('/campaigns/authorize', { method: 'POST', body: JSON.stringify({ ...payload(), confirmed, previewDigest: preview.previewDigest, requestId: requestId.current }) }) as { status: string; campaignId: string };
      setNotice(`Campaign ${result.status}. Reference: ${result.campaignId}. Scheduling is not delivery confirmation.`); setConfirmed(false);
    } catch (error) { const value = error instanceof Error ? error.message : 'Campaign could not be authorized.'; setNotice(reasons[value] || value); }
    finally { setBusy(false); }
  };

  const selectedLabel = selected ? `${selected.name} · ${selected.language}` : 'Select a campaign template';
  const unavailableOffer = options.unavailableTemplates?.exclusive_offer;
  return <section className="rounded-2xl border border-black/[.08] bg-white p-6 shadow-sm" aria-labelledby="whatsapp-campaign-heading">
    <h2 id="whatsapp-campaign-heading" className="text-xl font-semibold">WhatsApp marketing campaigns</h2>
    <p className="mt-3 text-sm text-gray-800">Campaign previews use the backend template components and variable order. Only customers with active, separate marketing consent enter the audience. {options.marketingEnabled ? 'Only approved and locally enabled templates can be scheduled.' : 'Marketing sending is disabled; eligible drafts can be previewed and saved.'}</p>
    {!sendEligibleCount && <p className="mt-3 rounded-lg border border-amber-700/30 bg-amber-50 p-3 text-sm font-medium text-amber-950">No approved campaign template is currently eligible to send. Pending and unknown templates are preview-only.</p>}
    {unavailableOffer && <p className="mt-3 rounded-lg border border-gray-300 bg-gray-50 p-3 text-sm font-medium text-gray-900">{unavailableOffer.name}: Unavailable – Coupon integration not configured. It cannot be selected, previewed, or scheduled.</p>}

    <div className="mt-5 grid gap-x-6 gap-y-4 md:grid-cols-2">
      <div ref={picker} className="min-w-0 text-sm">
        <label htmlFor="campaign-template-combobox" className="font-medium text-gray-900">Campaign template</label>
        <input id="campaign-template-combobox" role="combobox" aria-label="Campaign template" aria-autocomplete="list" aria-expanded={templateOpen} aria-controls="campaign-template-options" aria-activedescendant={templateOpen && choices[activeOption] ? `campaign-template-${choices[activeOption][0]}` : undefined}
          className={field} value={templateOpen ? templateSearch : selectedLabel} onFocus={() => { setTemplateOpen(true); setTemplateSearch(''); }} onChange={event => { setTemplateSearch(event.target.value); setTemplateOpen(true); setActiveOption(0); }}
          onKeyDown={event => {
            if (event.key === 'ArrowDown') { event.preventDefault(); setTemplateOpen(true); setActiveOption(index => Math.min(index + 1, Math.max(choices.length - 1, 0))); }
            else if (event.key === 'ArrowUp') { event.preventDefault(); setTemplateOpen(true); setActiveOption(index => Math.max(index - 1, 0)); }
            else if (event.key === 'Enter' && templateOpen && choices[activeOption]) { event.preventDefault(); selectTemplate(choices[activeOption][0]); }
            else if (event.key === 'Escape') { setTemplateOpen(false); setTemplateSearch(''); }
          }} />
        {templateOpen && <ul id="campaign-template-options" role="listbox" aria-label="Campaign templates" className="mt-1 max-h-60 overflow-y-auto rounded-lg border border-black/20 bg-white shadow-sm">
          {choices.map(([event, template], index) => {
            const canSend = template.enabled && template.approved && template.observedStatus === 'APPROVED' && template.componentsVerified && !template.statusStale;
            return <li key={event} id={`campaign-template-${event}`} role="option" aria-selected={form.event === event} aria-description={canSend ? 'Eligible subject to campaign gates' : 'Preview only; sending is disabled until approval is confirmed'} className={`cursor-pointer border-b border-black/5 px-3 py-3 text-gray-950 ${index === activeOption ? 'bg-[#f7f4ef]' : 'bg-white'} hover:bg-[#f7f4ef]`} onMouseEnter={() => setActiveOption(index)} onClick={() => selectTemplate(event)}>
              <span className="block break-words font-semibold">{template.name}</span><span className="mt-1 block text-xs text-gray-700">{template.category} · {template.language} · {statusLabel(template)}</span><span className="mt-1 block text-xs font-medium">{canSend ? 'Eligible subject to campaign gates' : 'Preview only · not eligible to send'}</span>{template.statusStale && <span className="block text-xs font-semibold text-amber-900">Cached Meta status is stale.</span>}
            </li>;
          })}
          {!choices.length && <li className="px-3 py-3 text-sm text-gray-700">No matching campaign templates.</li>}
        </ul>}
        <p className="mt-1 text-xs text-gray-700">Select a draft to preview; keyboard: arrows, Enter, Escape.</p>
      </div>

      <label className="text-sm font-medium text-gray-900">Eligible audience<select className={field} value={form.audience} onChange={event => change('audience', event.target.value)}><option value="all_marketing_consent">All customers with active marketing consent</option><option value="collection_customers">Past customers of the selected collection with marketing consent</option></select></label>
      <label className="text-sm font-medium text-gray-900">Campaign description<textarea className={`${field} min-h-28`} maxLength={2000} value={form.description} onChange={event => change('description', event.target.value)} /></label>
      <div className="grid content-start gap-4">
        <label className="text-sm font-medium text-gray-900">Collection<select className={field} value={form.collectionId} onChange={event => change('collectionId', event.target.value)}><option value="">Choose an existing collection</option>{options.collections?.map(collection => <option key={collection.id} value={collection.id}>{collection.name} ({collection.productCount} products)</option>)}</select><span className="mt-1 block text-xs text-gray-700">The destination is resolved from the selected collection’s public route.</span></label>
        <label className="text-sm font-medium text-gray-900">Campaign expiry<input className={field} type="datetime-local" value={form.expiresAt} onChange={event => change('expiresAt', event.target.value)} /></label>
        <label className="text-sm font-medium text-gray-900">Schedule (optional)<input className={field} type="datetime-local" value={form.scheduledAt} onChange={event => change('scheduledAt', event.target.value)} /></label>
      </div>
    </div>
    <div className="mt-5 flex flex-wrap gap-3"><button type="button" className="rounded-lg border border-black/20 px-4 py-2 text-sm font-medium disabled:opacity-40" disabled={busy || form.event !== 'new_collection_drop' || !selected || !form.expiresAt || !form.collectionId} onClick={() => void saveDraft()}>Save campaign draft</button><button type="button" className="rounded-lg border border-black/20 px-4 py-2 text-sm font-medium disabled:opacity-40" disabled={busy || !selected || !form.expiresAt || !form.collectionId} onClick={() => void buildPreview()}>Preview campaign and audience</button></div>
    {selected && <p className="mt-2 text-xs text-gray-700">Current template status: {statusLabel(selected)}{selected.statusStale ? ' · stale evidence' : ''}. A draft may be previewed, but the backend blocks scheduling until exact approval and component verification.</p>}
    {preview && <div className="mt-5 space-y-3 rounded-lg border border-black/15 p-4 text-sm" aria-label="Campaign preview">
      <h3 className="font-semibold">Preview and confirmation</h3>
      <p>Eligible recipient count: {preview.recipientCount}</p><p>Excluded: {Object.entries(preview.excluded).map(([reason, count]) => `${reason}: ${count}`).join(', ') || 'None'}</p>
      <p>CTA destination: <a className="break-all font-medium underline" href={preview.destinationUrl} target="_blank" rel="noreferrer">{preview.destinationUrl}</a> · {preview.destinationReachable ? 'Public route verified' : 'Not verified'}</p>
      {preview.template.components?.filter(component => ['HEADER', 'FOOTER'].includes(component.type)).map(component => <p key={component.type}>{component.type}: {component.text}</p>)}
      {!preview.template.componentsVerified && <p className="rounded-lg bg-amber-50 p-3 font-medium text-amber-950">This preview uses the local draft components. Meta has returned a different or unverified component structure; sending remains blocked.</p>}
      {!!preview.template.metaComponents?.length && <details><summary className="cursor-pointer font-medium">Exact components most recently returned by Meta</summary><pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-gray-50 p-3 text-xs">{JSON.stringify(preview.template.metaComponents, null, 2)}</pre></details>}
      {preview.samples.map((sample, index) => <div key={index} className="border-t pt-3"><p>{sample.recipient}</p><p className="whitespace-pre-wrap font-medium">{sample.body}</p><ol>{preview.template.parameters.map((key, order) => <li key={key}>{order + 1}. {key}: {sample.variables[key]}</li>)}</ol></div>)}
      {preview.disabledReasons.map(reason => <p key={reason} className="font-medium text-amber-950">{reasons[reason] || reason}</p>)}
      <label className="flex gap-2"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={!preview.canAuthorize} />I authorize this exact audience, content, destination and schedule.</label>
      <button type="button" className="rounded-lg border border-black/20 px-4 py-2 font-medium disabled:opacity-40" disabled={busy || !preview.canAuthorize || !confirmed} onClick={() => void authorize()}>Authorize campaign schedule</button>
    </div>}
    {notice && <p className="mt-4 text-sm font-medium text-gray-900" role="status">{reasons[notice] || notice}</p>}
  </section>;
}
