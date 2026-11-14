'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiBaseUrl } from '@/lib/rbac';
import { WhatsAppTestMessage, testErrorText, validTestRecipient } from '@/components/admin/whatsapp-test-message';
import { WhatsAppCampaigns } from '@/components/admin/whatsapp-campaigns';

type TemplateComponent = { type: string; format?: string; text?: string; buttons?: { type: string; text: string; url?: string }[]; add_security_recommendation?: boolean; code_expiration_minutes?: number };
type TestParameterField = { key: string; label: string; component: 'header' | 'body' | 'button'; index?: number | null; number: number };
type Template = { name: string; category: string; language: string; parameters: string[]; parameterTypes?: string[]; enabled: boolean; approved: boolean; approvalStatus?: string; observedStatus?: string; qualityRating?: 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN' | null; templateGroup?: string; draftExplanation?: string; approvalSource?: string; approvalCheckedAt?: string; statusEvidence?: string; statusStale?: boolean; presentInMeta?: boolean; locallyMapped?: boolean; mappingEnabled?: boolean; localDraft?: boolean; configured?: boolean; schemaVersion?: number; requiresMetaApproval?: boolean; componentsVerified?: boolean; components?: TemplateComponent[]; metaComponents?: TemplateComponent[]; testParameterFields?: TestParameterField[]; componentMismatches?: string[]; buttons?: { type: string; text: string; url: string }[]; buttonParameters?: string[]; disabledReasons?: string[]; eligibleForTesting?: boolean; eligibleForAutomation?: boolean; versionOf?: string };
type Status = {
  enabled: boolean; environmentEnabled: boolean; configured: boolean; missing: string[];
  phoneNumberId: string; businessPhoneNumber?: string; businessAccountId: string; apiVersion: string; callbackUrl: string;
  environment: 'development' | 'production'; testSendEnabled: boolean;
  verifiedAt?: string; lastWebhook?: string; lastApiSuccess?: string;
  subscriptionStatus?: string; subscriptionCheckedAt?: string; lastError?: { kind: string; code?: number };
  templates: Record<string, Template>;
  catalogue?: Record<string, Template>;
  unmappedTemplates?: { name: string; language: string; category: string; status: string; qualityRating?: string | null; checkedAt?: string; evidenceState: string }[];
  templateStatusSync?: { lastAttemptAt?: string; lastSuccessAt?: string; lastError?: string | null; outcome?: string; pagesRead?: number; recordsRead?: number };
  marketingEnabled?: boolean;
};
type Message = {
  _id: string; recipient: string; type: string; template?: string; orderId?: string;
  status: string; providerId?: string; httpStatus?: number; createdAt: string; acceptedAt?: string; sentAt?: string;
  deliveredAt?: string; readAt?: string; failedAt?: string; readReceiptStatus?: 'received' | 'not_received' | 'unknown';
  deliveryReceiptStatus?: 'received' | 'confirmed_by_read_receipt' | 'not_received' | 'unknown';
  failureDetails?: { kind: string; errors?: { kind?: string; code?: number; subcode?: number }[] };
  error?: { kind: string; code?: number; subcode?: number };
};
const box = 'rounded-2xl border border-black/[.08] bg-white p-6 shadow-sm';
const button = 'rounded-lg border border-black/15 px-4 py-2 text-sm disabled:opacity-40';
const input = 'rounded-lg border border-black/20 bg-white p-2 text-sm';
const date = (value?: string) => value ? new Date(value).toLocaleString() : 'Not recorded';
const statusTime = (value?: string) => value ? date(value) : 'Not observed';
const readReceiptText = (message: Message) => {
  if (message.readAt || message.readReceiptStatus === 'received') return `Read receipt received${message.readAt ? ` · ${date(message.readAt)}` : ''}`;
  if (message.readReceiptStatus === 'unknown') return 'Read receipt unavailable/unknown';
  if (message.readReceiptStatus === 'not_received' || ['accepted', 'sent', 'delivered'].includes(message.status) || message.acceptedAt || message.sentAt || message.deliveredAt) return 'No read receipt received yet';
  return 'Read receipt unavailable/unknown';
};
const deliveryReceiptText = (message: Message) => {
  if (message.deliveredAt) return date(message.deliveredAt);
  if (message.readAt || message.deliveryReceiptStatus === 'confirmed_by_read_receipt') return `Confirmed by read receipt; exact delivery time unavailable${message.readAt ? ` (read ${date(message.readAt)})` : ''}`;
  if (message.deliveryReceiptStatus === 'unknown') return 'Delivery receipt unavailable/unknown';
  if (message.deliveryReceiptStatus === 'not_received' || ['accepted', 'sent'].includes(message.status) || message.acceptedAt || message.sentAt) return 'No delivery receipt received yet';
  return 'Delivery receipt unavailable/unknown';
};
const failureText = (message: Message) => {
  const failure = message.failureDetails?.errors?.[0] ?? message.error;
  if (!failure) return '';
  return `Failure details: ${failure.kind ?? 'delivery_failed'}${failure.code ? ` · Meta code ${failure.code}` : ''}${failure.subcode ? ` · subcode ${failure.subcode}` : ''}`;
};

type SectionKey = 'overview' | 'test-messages' | 'template-library' | 'otp' | 'marketing' | 'consent' | 'logs' | 'advanced';
const sections: { key: SectionKey; label: string }[] = [
  { key: 'overview', label: 'Overview' }, { key: 'test-messages', label: 'Test Messages' },
  { key: 'template-library', label: 'Template Library' }, { key: 'otp', label: 'OTP & Authentication' },
  { key: 'marketing', label: 'Marketing Campaigns' }, { key: 'consent', label: 'Consent & Preferences' },
  { key: 'logs', label: 'Message Logs' }, { key: 'advanced', label: 'Advanced Settings' },
];
const metaStatus = (template: Template) => {
  const status = template.observedStatus ?? template.approvalStatus ?? 'MISSING_OR_UNKNOWN';
  if (status === 'NOT_CHECKED' || status === 'NOT_SUBMITTED') return 'MISSING_OR_UNKNOWN';
  if (status === 'PENDING_CONFIRMATION') return 'PENDING / REFRESH REQUIRED';
  return status === 'IN_REVIEW' || status === 'PENDING' ? 'PENDING / IN_REVIEW' : status;
};
const qualityLabel = (template: Template) => ({
  GREEN: 'Quality: High', YELLOW: 'Quality: Medium', RED: 'Quality: Low', UNKNOWN: 'Quality pending',
} as Record<string, string>)[template.qualityRating ?? ''] ?? 'Quality not reported';
const chip = (approved: boolean, status: string) => `inline-flex rounded-full border px-2.5 py-1 text-xs ${approved ? 'border-emerald-700/25 bg-emerald-50 text-emerald-900' : 'border-amber-700/25 bg-amber-50 text-amber-950'}`;

function evidenceLabel(template: Template) {
  if (template.statusStale) return 'Last verified status is stale; refresh failed or used another WABA.';
  if (template.statusEvidence === 'absent_from_complete_inventory') return 'Not present in the last complete Meta inventory.';
  if (template.statusEvidence === 'local_definition_not_found_in_complete_inventory') return 'Local draft absent from the last complete Meta inventory.';
  if (template.statusEvidence === 'found_with_unknown_provider_status_or_category') return 'Found in Meta, but the returned status or category is unrecognized.';
  if (template.statusEvidence === 'legacy_unscoped_evidence') return 'Older evidence is not bound to the current WABA; refresh required.';
  if (template.statusEvidence === 'found') return 'Exact name and language found in Meta.';
  return 'No verified Meta status read yet.';
}

function TemplateLibrary({ templates, unmapped = [], sync }: { templates: Template[]; unmapped?: NonNullable<Status['unmappedTemplates']>; sync?: Status['templateStatusSync'] }) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [stateFilter, setStateFilter] = useState('All');
  const [optionalExpanded, setOptionalExpanded] = useState(false);
  const versions = templates.filter(template => template.versionOf);
  const base = templates.filter(template => !template.versionOf && [
    'APPROVED', 'PENDING / IN_REVIEW', 'PENDING / REFRESH REQUIRED', 'REJECTED', 'PAUSED', 'MISSING_OR_UNKNOWN', 'DISABLED', 'DELETED', 'IN_APPEAL', 'PENDING_DELETION', 'LIMIT_EXCEEDED', 'ARCHIVED',
  ].includes(metaStatus(template)));
  const matches = (template: Template) => {
    const status = metaStatus(template);
    const term = search.trim().toLowerCase();
    return (!term || [template.name, template.category, template.language, ...template.parameters, ...(template.buttons ?? []).map(button => button.text)].join(' ').toLowerCase().includes(term))
      && (category === 'All' || template.category === category)
      && (stateFilter === 'All' || (stateFilter === 'In Review' ? status.startsWith('PENDING') : stateFilter === 'Local draft' ? template.localDraft === true : status === stateFilter));
  };
  const groups = [
    { name: 'Integration Test', rows: base.filter(template => template.templateGroup === 'Integration Test' || template.name === '3p_direct_integration_test_template') },
    { name: 'Authentication', rows: base.filter(template => template.category === 'AUTHENTICATION' && !template.localDraft) },
    { name: 'Transactional', rows: base.filter(template => (template.templateGroup === 'Transactional' || ['rk_order_confirmation', 'rk_payment_confirmation', 'rk_order_shipped', 'rk_out_for_delivery', 'rk_order_delivered', 'rk_order_cancelled', 'rk_refund_processed'].includes(template.name)) && !template.localDraft) },
    { name: 'Marketing', rows: base.filter(template => template.category === 'MARKETING' && !template.localDraft) },
    { name: 'Optional lifecycle drafts', rows: base.filter(template => template.templateGroup === 'Optional lifecycle drafts' && !template.localDraft) },
  ];
  const optional = groups[4].rows.filter(matches);
  const localDrafts = base.filter(template => template.localDraft && matches(template));
  const unmappedMatches = unmapped.filter(item => {
    const status = item.status === 'PENDING' || item.status === 'IN_REVIEW' ? 'PENDING / IN_REVIEW' : item.status;
    return (!search || `${item.name} ${item.category} ${item.language}`.toLowerCase().includes(search.toLowerCase()))
      && (category === 'All' || item.category === category)
      && (stateFilter === 'All' || (stateFilter === 'In Review' ? status.startsWith('PENDING') : status === stateFilter));
  });
  const visibleGroups = groups.slice(0, 4).map(group => ({ ...group, rows: group.rows.filter(matches) }));
  return <section className={`${box} space-y-5`} aria-labelledby="template-library-heading">
    <div><h2 id="template-library-heading" className="text-xl font-semibold">Template Library</h2><p className="mt-2 text-sm text-gray-700">Meta status reflects the latest complete read of this WABA using exact template name and language. Local configuration never counts as Meta approval.</p>
      {sync?.lastError && <p role="status" className="mt-3 rounded-lg border border-amber-700/30 bg-amber-50 p-3 text-sm font-medium text-amber-950">Meta status refresh failed. Previously verified statuses and timestamps are preserved and marked stale. Retry the read; API errors are not reported as missing templates.</p>}
      {sync?.lastSuccessAt && <p className="mt-1 text-xs text-gray-600">Last complete inventory: {date(sync.lastSuccessAt)}{sync.pagesRead ? ` · ${sync.pagesRead} page${sync.pagesRead === 1 ? '' : 's'} · ${sync.recordsRead ?? 0} records` : ''}</p>}
    </div>
    <div className="grid gap-3 md:grid-cols-[minmax(16rem,1fr)_auto_auto]">
      <label className="text-sm">Search templates<input aria-label="Search templates" className={`${input} mt-1 w-full`} value={search} onChange={event => setSearch(event.target.value)} placeholder="Name, variable or button" /></label>
      <label className="text-sm">Category<select aria-label="Template category filter" className={`${input} mt-1 block`} value={category} onChange={event => setCategory(event.target.value)}>{['All', 'AUTHENTICATION', 'UTILITY', 'MARKETING'].map(value => <option key={value}>{value}</option>)}</select></label>
      <label className="text-sm">Meta status<select aria-label="Template status filter" className={`${input} mt-1 block`} value={stateFilter} onChange={event => setStateFilter(event.target.value)}>{['All', 'APPROVED', 'In Review', 'Local draft', 'REJECTED', 'PAUSED', 'DISABLED', 'IN_APPEAL', 'PENDING_DELETION', 'DELETED', 'LIMIT_EXCEEDED', 'ARCHIVED', 'MISSING_OR_UNKNOWN'].map(value => <option key={value}>{value}</option>)}</select></label>
    </div>
    <div className="flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-gray-100 px-3 py-1">{base.filter(template => metaStatus(template) === 'APPROVED').length} approved</span><span className="rounded-full bg-amber-50 px-3 py-1">{base.filter(template => metaStatus(template).startsWith('PENDING')).length} in review / refresh required</span><span className="rounded-full bg-gray-100 px-3 py-1">{base.filter(template => metaStatus(template) === 'MISSING_OR_UNKNOWN' && !template.localDraft).length} missing / unknown</span><span className="rounded-full bg-slate-100 px-3 py-1">{base.filter(template => template.localDraft).length} local drafts not submitted</span></div>
    {visibleGroups.map(group => {
      const rows = group.rows;
      if (!rows.length) return null;
      return <div key={group.name} className="space-y-2"><h3 className="text-sm font-semibold uppercase tracking-wide text-[#755c3a]">{group.name}</h3>
        <div className="overflow-x-auto rounded-xl border border-black/10"><table className="w-full min-w-[1060px] text-left text-sm"><thead className="bg-[#f7f4ef]"><tr>{['Template name / version', 'Category', 'Language', 'Meta status', 'Local mapping', 'Variables', 'Buttons', 'Last verified'].map(label => <th className="p-3 font-medium" key={label}>{label}</th>)}</tr></thead><tbody>
          {rows.map(template => <tr key={template.name} className="border-t align-top"><td className="w-[230px] p-3"><details><summary className="cursor-pointer break-all font-semibold">{template.name}</summary><div className="mt-2 space-y-2 rounded-lg bg-gray-50 p-3"><p>{template.componentsVerified ? 'Meta components match the local contract.' : 'Meta components are not verified against the local contract.'}</p><p>{evidenceLabel(template)}</p>{template.statusStale && <p className="font-semibold text-amber-950">Cached status is stale.</p>}<details><summary className="cursor-pointer text-sm font-medium">Local component contract</summary><pre className="max-w-2xl overflow-x-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(template.components ?? [], null, 2)}</pre></details>{!!template.metaComponents?.length && <details><summary className="cursor-pointer text-sm font-medium">Exact Meta returned components</summary><pre className="max-w-2xl overflow-x-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(template.metaComponents, null, 2)}</pre></details>}</div></details>{versions.filter(version => version.versionOf === template.name).map(version => <details key={version.name} className="mt-2 rounded-lg bg-gray-50 p-2"><summary className="cursor-pointer break-all font-medium">Version: {version.name}</summary><p className="mt-2">Meta: {metaStatus(version)} · {version.language} · {version.componentsVerified ? 'Components verified' : 'Components unconfirmed'} · {version.approved && version.enabled ? 'Eligible' : 'Not eligible'}</p><p>{version.buttons?.map(item => item.text).join(', ') || 'No buttons'}</p><pre className="overflow-x-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(version.components ?? [], null, 2)}</pre></details>)}</td><td className="p-3">{template.category}</td><td className="p-3">{template.language}</td><td className="p-3"><span className={chip(metaStatus(template) === 'APPROVED', metaStatus(template))}>{metaStatus(template)}</span><p className="mt-1 max-w-[190px] text-xs text-gray-700">{qualityLabel(template)}</p><p className="mt-1 max-w-[190px] text-xs text-gray-700">{template.statusStale ? 'Stale evidence' : evidenceLabel(template)}</p></td><td className="p-3">{template.locallyMapped ? (template.mappingEnabled ? 'Mapped · enabled' : 'Mapped · disabled') : template.localDraft ? 'Local draft · not mapped' : 'Not mapped'}</td><td className="p-3">{template.parameters.length} variables</td><td className="p-3">{template.buttons?.map(item => `${item.type}: ${item.text}`).join(', ') || 'None'}</td><td className="p-3 whitespace-nowrap">{template.approvalCheckedAt ? date(template.approvalCheckedAt) : 'Not verified'}</td></tr>)}
        </tbody></table></div>
      </div>;
    })}
    {optional.length > 0 && <section className="rounded-xl border border-black/10 p-4"><button type="button" className="rounded-lg border px-3 py-2 text-sm font-semibold text-gray-900" aria-expanded={optionalExpanded} onClick={() => setOptionalExpanded(value => !value)}>{optionalExpanded ? 'Hide optional templates' : `Show optional templates (${optional.length})`}</button>{optionalExpanded && <div className="mt-4 space-y-2"><h3 className="text-sm font-semibold uppercase tracking-wide text-[#755c3a]">Optional lifecycle drafts</h3><div className="overflow-x-auto rounded-xl border border-black/10"><table className="w-full min-w-[1060px] text-left text-sm"><thead className="bg-[#f7f4ef]"><tr>{['Template name / version', 'Category', 'Language', 'Meta status', 'Local mapping', 'Variables', 'Buttons', 'Last verified'].map(label => <th className="p-3 font-medium" key={label}>{label}</th>)}</tr></thead><tbody>{optional.map(template => <tr key={template.name} className="border-t align-top"><td className="p-3"><details><summary className="cursor-pointer break-all font-semibold">{template.name}</summary><p className="mt-2 rounded-lg bg-gray-50 p-3 text-sm">{evidenceLabel(template)}</p><pre className="overflow-x-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(template.components ?? [], null, 2)}</pre></details></td><td className="p-3">{template.category}</td><td className="p-3">{template.language}</td><td className="p-3"><span className={chip(metaStatus(template) === 'APPROVED', metaStatus(template))}>{metaStatus(template)}</span><p className="text-xs">{qualityLabel(template)}</p><p className="mt-1 max-w-[190px] text-xs text-gray-700">{template.statusStale ? 'Stale evidence' : evidenceLabel(template)}</p></td><td className="p-3">{template.locallyMapped ? (template.mappingEnabled ? 'Mapped · enabled' : 'Mapped · disabled') : template.localDraft ? 'Local draft · not mapped' : 'Not mapped'}</td><td className="p-3">{template.parameters.length} variables</td><td className="p-3">{template.buttons?.map(item => `${item.type}: ${item.text}`).join(', ') || 'None'}</td><td className="p-3 whitespace-nowrap">{template.approvalCheckedAt ? date(template.approvalCheckedAt) : 'Not verified'}</td></tr>)}</tbody></table></div></div>}</section>}
    {localDrafts.length > 0 && <section className="space-y-2"><h3 className="text-sm font-semibold uppercase tracking-wide text-[#755c3a]">Local drafts - not submitted</h3><div className="overflow-x-auto rounded-xl border border-black/10"><table className="w-full min-w-[820px] text-left text-sm"><thead className="bg-[#f7f4ef]"><tr>{['Local name', 'Category', 'Meta state', 'Reason', 'Availability'].map(label => <th className="p-3 font-medium" key={label}>{label}</th>)}</tr></thead><tbody>{localDrafts.map(template => <tr className="border-t align-top" key={template.name}><td className="p-3 font-semibold">{template.name}</td><td className="p-3">{template.category}</td><td className="p-3">Not submitted; not a Meta review submission</td><td className="p-3">{template.draftExplanation ?? evidenceLabel(template)}</td><td className="p-3">Not sendable</td></tr>)}</tbody></table></div></section>}
    {unmappedMatches.length > 0 && <section className="space-y-2"><h3 className="text-sm font-semibold uppercase tracking-wide text-[#755c3a]">Found in Meta · not mapped locally</h3><div className="overflow-x-auto rounded-xl border border-black/10"><table className="w-full min-w-[700px] text-left text-sm"><thead className="bg-[#f7f4ef]"><tr>{['Template name', 'Category', 'Language', 'Meta status', 'Quality', 'Local mapping', 'Last verified'].map(label => <th className="p-3 font-medium" key={label}>{label}</th>)}</tr></thead><tbody>{unmappedMatches.map(item => <tr className="border-t" key={`${item.name}:${item.language}`}><td className="p-3 font-semibold">{item.name}</td><td className="p-3">{item.category}</td><td className="p-3">{item.language}</td><td className="p-3"><span className={chip(item.status === 'APPROVED', item.status)}>{item.status === 'PENDING' ? 'PENDING / IN_REVIEW' : item.status}</span></td><td className="p-3">{item.qualityRating === 'UNKNOWN' ? 'Quality pending' : item.qualityRating ?? 'Not reported'}</td><td className="p-3">Not mapped; unavailable for sending</td><td className="p-3">{date(item.checkedAt)}</td></tr>)}</tbody></table></div></section>}
    {!base.some(matches) && !optional.length && !unmappedMatches.length && <p className="rounded-lg border p-4 text-sm text-gray-700">No templates match these search and status filters.</p>}
  </section>;
}

export default function WhatsAppIntegrationPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [logRevision, setLogRevision] = useState(0);
  const [recipient, setRecipient] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [templateEvent, setTemplateEvent] = useState('test');
  const [templateParameters, setTemplateParameters] = useState<Record<string, string>>({});
  const [templateWindow, setTemplateWindow] = useState<{ open: boolean; lastIncomingAt?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [enableConfirmation, setEnableConfirmation] = useState(false);
  const [lifecycleAction, setLifecycleAction] = useState('custom_order_status');
  const [recordId, setRecordId] = useState('');
  const [customStatus, setCustomStatus] = useState('in_review');
  const [lifecycleConfirmed, setLifecycleConfirmed] = useState(false);
  const [activeSection, setActiveSection] = useState<SectionKey>('overview');
  const [templateSearch, setTemplateSearch] = useState('');
  const [templateLimit, setTemplateLimit] = useState(6);
  // Keep the same key when a browser request fails, allowing a safe retry.
  const requestId = useRef('');

  const api = useCallback(async (path = '', init?: RequestInit) => {
    const token = window.localStorage.getItem('rk_access_token') ?? '';
    const response = await fetch(`${apiBaseUrl}/api/admin/integrations/whatsapp${path}`, {
      ...init, credentials: 'include', cache: 'no-store',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init?.headers },
    });
    const body = await response.json().catch(() => null);
    if (!body) {
      const explanation = response.status === 429 ? 'Admin request limit reached. Retry later.' : 'The admin API could not complete this request.';
      throw Object.assign(new Error(explanation), { response: { status: 'request_failed', explanation } });
    }
    if (!response.ok) throw Object.assign(new Error(testErrorText(body)), { response: body });
    return body;
  }, []);

  const load = useCallback(async () => {
    try { setStatus(await api()); } catch (error) { setNotice(error instanceof Error ? error.message : 'Unable to load connection status.'); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    setTemplateWindow(null);
    if (!validTestRecipient(recipient)) return;
    let active = true;
    const timer = setTimeout(() => {
      void api('/test-window', { method: 'POST', body: JSON.stringify({ recipient }) })
        .then(value => { if (active) setTemplateWindow(value); }).catch(() => undefined);
    }, 350);
    return () => { active = false; clearTimeout(timer); };
  }, [recipient, api]);
  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ page: String(page), ...(statusFilter ? { status: statusFilter } : {}), ...(typeFilter ? { type: typeFilter } : {}) });
    api(`/messages?${params}`).then(data => { if (active) { setMessages(data.messages); setHasMore(data.hasMore); } })
      .catch(error => { if (active) setNotice(error instanceof Error ? error.message : 'Unable to load logs.'); });
    return () => { active = false; };
  }, [api, page, statusFilter, typeFilter, busy, logRevision]);

  async function action(path: string, method: string, body?: unknown) {
    setBusy(true); setNotice('');
    try {
      const result = await api(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
      if (path === '/test-send') {
        setNotice(`One-off test result: ${result.status}. Meta message ID: ${result.providerId ?? 'See existing message log'}. HTTP: ${result.httpStatus ?? 'not recorded'}. ${result.error ? testErrorText(result) : ''} Correlation: ${result.correlationId ?? 'none'}`);
        requestId.current = ''; setConfirmed(false);
      } else if (path === '/lifecycle-update') {
        setNotice(`Update recorded. WhatsApp: ${result.whatsapp.status}${result.whatsapp.reason ? ` (${result.whatsapp.reason})` : ''}. Email: ${result.email}.`);
        setLifecycleConfirmed(false);
      } else { setStatus(result); setNotice('Configuration refreshed.'); }
    } catch (error) {
      const response = (error as Error & { response?: { status?: Status } }).response;
      if (path === '/template-status' && response?.status) setStatus(response.status);
      setNotice(error instanceof Error ? error.message : 'Request failed.');
    }
    finally { setBusy(false); }
  }

  const selectedTemplate = status?.templates[templateEvent];
  const testParameterFields = selectedTemplate?.testParameterFields ?? [];
  const templateParametersValid = Boolean(selectedTemplate && testParameterFields.every(field => Boolean(templateParameters[field.key]?.trim()) && templateParameters[field.key].length <= 500));
  const catalogRows = Object.values(status?.catalogue ?? {});
  const extraRows = Object.values(status?.templates ?? {}).filter(template => !catalogRows.some(row => row.name === template.name && row.language === template.language)
    && template.name !== 'rk_test');
  const libraryRows = [...catalogRows, ...extraRows];
  const approvedCount = libraryRows.filter(template => metaStatus(template) === 'APPROVED' && template.componentsVerified).length;
  const reviewCount = libraryRows.filter(template => metaStatus(template).startsWith('PENDING')).length;
  const filteredTestTemplates = Object.entries(status?.templates ?? {}).filter(([, template]) => template.category === 'UTILITY' && !template.versionOf && !['DELETED', 'PENDING_DELETION'].includes(metaStatus(template)))
    .filter(([, template]) => !templateSearch || `${template.name} ${template.language} ${template.category}`.toLowerCase().includes(templateSearch.toLowerCase()))
    .sort(([, left], [, right]) => Number(right.templateGroup === 'Integration Test') - Number(left.templateGroup === 'Integration Test'));
  const testTemplates = filteredTestTemplates.slice(0, templateLimit);
  const authTemplate = status?.templates.login_otp;
  const show = (key: SectionKey) => activeSection === key;
  return <section className="mx-auto w-full max-w-[90rem] space-y-5">
    <header><p className="text-xs uppercase tracking-widest text-[#9a7a4d]">Admin Studio · Integrations</p><h1 className="mt-2 text-2xl font-semibold sm:text-3xl">WhatsApp Control Centre</h1><p className="mt-2 text-sm text-gray-600">Manage templates, consent and delivery for the connected WhatsApp Business account.</p></header>
    {notice && <p role="status" className="rounded-xl border bg-amber-50 p-4 text-sm break-words">{notice}</p>}
    <nav aria-label="WhatsApp sections" role="tablist" className="flex gap-2 overflow-x-auto border-b border-black/10 pb-2">
      {sections.map(section => <button key={section.key} id={`whatsapp-tab-${section.key}`} role="tab" aria-selected={activeSection === section.key} aria-controls="whatsapp-panel" className={`shrink-0 rounded-full px-4 py-2 text-sm ${activeSection === section.key ? 'bg-[#211e1a] text-white' : 'border border-black/10 text-gray-700 hover:bg-[#f7f4ef]'}`} onClick={() => setActiveSection(section.key)}>{section.label}</button>)}
    </nav>
    {!status ? <p>Loading WhatsApp configuration…</p> : <div id="whatsapp-panel" role="tabpanel" aria-labelledby={`whatsapp-tab-${activeSection}`} className="min-w-0 space-y-5">
      {show('overview') && <>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ['API connection', status.configured ? 'Configured' : 'Needs configuration', status.lastApiSuccess ? `Last success ${date(status.lastApiSuccess)}` : 'No successful request recorded'],
            ['Business phone', status.businessPhoneNumber || 'Not verified yet', `Phone Number ID ${status.phoneNumberId || 'not configured'}`],
            ['Webhook', status.verifiedAt ? 'Verified' : 'Not verified', status.callbackUrl || 'Callback not configured'],
            ['WABA subscription', status.subscriptionStatus ?? 'Unknown', 'Connection check verifies app subscription'],
            ['Approved templates', `${approvedCount}`, 'Meta status and components verified'],
            ['Under review', `${reviewCount}`, 'Exact name and language found in Meta'],
            ['Messaging gate', status.enabled ? 'Enabled' : 'Off', `Local test sends ${status.testSendEnabled ? 'enabled' : 'off'} · automated ${status.environmentEnabled ? 'backend gate on' : 'backend gate off'}`],
            ['Last API success', date(status.lastApiSuccess), status.environment === 'development' ? 'Local development' : 'Production configuration'],
          ].map(([title, value, detail]) => <article key={title} className="min-w-0 rounded-xl border border-black/[.08] bg-white p-4"><p className="text-xs uppercase tracking-wide text-gray-500">{title}</p><p className="mt-2 break-words text-base font-semibold">{value}</p><p className="mt-1 break-words text-xs text-gray-600">{detail}</p></article>)}
        </div>
        <section className={`${box} flex flex-wrap items-center justify-between gap-4`}><div><h2 className="text-lg font-semibold">{status.environment === 'development' ? 'Local development' : 'Production'} environment</h2><p className="mt-1 text-sm text-gray-600">Test sends and automated messaging use independent backend gates.</p></div><button className={button} disabled={busy || !status.configured} onClick={() => void action('/test-connection', 'POST')}>Check API connection</button></section>
      </>}
      {show('test-messages') && <>
        <WhatsAppTestMessage enabled={status.testSendEnabled} configured={status.configured} request={api} onComplete={() => setLogRevision(value => value + 1)} />
        <section className={`${box} space-y-4`}><div><h2 className="text-xl font-semibold">Send one-off approved template test</h2><p className="mt-1 text-sm text-gray-600">This sends directly through the configured WhatsApp Phone Number ID and writes to test message logs. Automated mapping enablement is separate and is not required. Authentication and marketing templates use their separate eligibility and consent flows.</p></div>
          <label className="block max-w-2xl text-sm">Search templates<input aria-label="Search approved templates" className={`${input} mt-1 block w-full`} value={templateSearch} onChange={event => { setTemplateSearch(event.target.value); setTemplateLimit(6); }} placeholder="Search by template name or language" /></label>
          <form className="space-y-4" onSubmit={event => { event.preventDefault(); if (!requestId.current) requestId.current = crypto.randomUUID(); void action('/test-send', 'POST', { recipient, event: templateEvent, templateName: selectedTemplate?.name, language: selectedTemplate?.language, parameters: templateParameters, confirmed, requestId: requestId.current }); }}>
          <div role="listbox" aria-label="Utility templates" className="space-y-1 rounded-xl border p-2">{testTemplates.map(([event, template]) => <button type="button" role="option" aria-selected={templateEvent === event} key={event} disabled={!template.eligibleForTesting} onClick={() => { setTemplateEvent(event); setTemplateParameters({}); setConfirmed(false); requestId.current = ''; }} className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm enabled:hover:bg-[#f7f4ef] disabled:cursor-not-allowed disabled:opacity-55"><span className="break-all">{template.templateGroup === 'Integration Test' ? 'Integration Test - ' : ''}{template.name || event} · {template.language} · {template.category}{template.locallyMapped ? ` · Automated mapping ${template.mappingEnabled ? 'enabled' : 'disabled'}` : ''}</span><span className={chip(template.eligibleForTesting === true, metaStatus(template))}>{template.eligibleForTesting ? 'Approved · test eligible' : metaStatus(template)}</span></button>)}{!testTemplates.length && <p className="p-3 text-sm text-gray-500">No Utility templates match.</p>}</div>
          {filteredTestTemplates.length > testTemplates.length && <button type="button" className={button} onClick={() => setTemplateLimit(value => value + 6)}>Show more templates ({filteredTestTemplates.length - testTemplates.length} remaining)</button>}
          {!!selectedTemplate && <div className="rounded-xl border p-4"><p className="text-sm font-semibold">Meta-approved template preview · {selectedTemplate.name} · {selectedTemplate.language}</p><p className="mt-2 text-xs">Category: {selectedTemplate.category} · Approval: {metaStatus(selectedTemplate)} · Quality: {qualityLabel(selectedTemplate)}</p><dl className="mt-3 grid gap-3 sm:grid-cols-2">{(selectedTemplate.metaComponents?.length ? selectedTemplate.metaComponents : selectedTemplate.components ?? []).map((component, index) => <div key={index}><dt className="text-xs font-medium text-gray-500">{component.type}{component.format ? ` · ${component.format}` : ''}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm">{component.text || component.buttons?.map(item => `${item.text}: ${item.url ?? 'No URL'}`).join(', ') || 'Meta managed component'}</dd></div>)}</dl><p className="mt-3 text-sm">Required test parameters: {testParameterFields.length ? testParameterFields.map(field => field.label).join(' · ') : 'None'} · Buttons: {selectedTemplate.buttons?.map(item => item.text).join(', ') || 'None'}</p></div>}
          {testParameterFields.map(field => <label key={field.key} className="block max-w-2xl text-sm">{field.label}<input required maxLength={500} className={`${input} mt-1 block w-full`} value={templateParameters[field.key] ?? ''} onChange={event => { setTemplateParameters(values => ({ ...values, [field.key]: event.target.value })); setConfirmed(false); requestId.current = ''; }} /></label>)}
          <label className="block max-w-2xl text-sm">Consenting test recipient (E.164)<input required type="tel" maxLength={40} placeholder="+ country code and number" value={recipient} onChange={event => { setRecipient(event.target.value); setConfirmed(false); requestId.current = ''; }} className={`${input} mt-1 block w-full`} /></label>
          <p className="text-sm">Service window: {templateWindow ? (templateWindow.open ? 'Open' : 'Closed') : 'Not checked'} · Last incoming: {date(templateWindow?.lastIncomingAt)} · Approved templates do not require an open service window.</p>
          <p className="rounded-lg bg-[#f7f4ef] p-3 text-sm">Final confirmation: one-off template test to <strong>{recipient || 'enter an E.164 recipient number'}</strong>. This does not create or update an order.</p><label className="flex gap-2 text-sm"><input required type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />I confirm this test recipient opted in and authorize one one-off test send.</label>
          <p className="text-sm text-gray-600">Test-send gate: {status.testSendEnabled ? 'On' : 'Off'} · Meta status: {selectedTemplate ? metaStatus(selectedTemplate) : 'MISSING_OR_UNKNOWN'} · {selectedTemplate?.componentsVerified ? 'Components verified' : 'Components unconfirmed'} - {selectedTemplate ? qualityLabel(selectedTemplate) : 'Quality not reported'}</p>
          <button className={button} disabled={busy || !confirmed || !status.testSendEnabled || !status.configured || !validTestRecipient(recipient) || !selectedTemplate?.eligibleForTesting || !templateParametersValid}>Send approved test template</button>
          </form>
        </section>
      </>}
      {show('template-library') && <>
        <section className={`${box} flex flex-wrap items-center justify-between gap-4`}><div><h2 className="text-lg font-semibold">Meta template status</h2><p className="mt-1 text-sm text-gray-600">Refresh is read only; it does not submit or enable a template.</p></div><button className={button} disabled={busy || !status.configured} onClick={() => void action('/template-status', 'POST')}>Refresh Meta statuses</button></section>
        <TemplateLibrary templates={libraryRows} unmapped={status.unmappedTemplates} sync={status.templateStatusSync} />
      </>}
      {show('otp') && <section className={`${box} space-y-4`}><div><h2 className="text-xl font-semibold">OTP & Authentication</h2><p className="mt-1 text-sm text-gray-700">Signup, sign in and password recovery share the existing one time code challenge.</p></div><dl className="grid gap-4 text-sm sm:grid-cols-2"><div><dt>Canonical Meta template</dt><dd className="font-medium">rk_authentication_otp · en_US · AUTHENTICATION</dd></div><div><dt>Meta status</dt><dd>{authTemplate ? metaStatus(authTemplate) : 'MISSING_OR_UNKNOWN'} · {authTemplate?.componentsVerified ? 'components verified' : 'components unconfirmed'}{authTemplate?.statusStale ? ' · stale evidence' : ''}</dd></div><div><dt>Expiry</dt><dd>10 minutes</dd></div><div><dt>Required button</dt><dd>Copy Code (COPY_CODE)</dd></div><div><dt>Email OTP</dt><dd>Available through the existing email channel</dd></div><div><dt>WhatsApp OTP</dt><dd>{authTemplate?.enabled && authTemplate.approved ? 'Available when explicitly requested' : 'Unavailable until this exact Authentication template is approved and enabled'}</dd></div><div><dt>Supported channels</dt><dd>Email, WhatsApp, or both after the customer explicitly requests WhatsApp</dd></div><div><dt>Authentication template eligibility</dt><dd>{authTemplate?.eligibleForAutomation ? 'Eligible subject to explicit customer request and consent' : 'Blocked pending Meta permission, exact-template approval, verified components, and local enablement'}</dd></div></dl><p role="note" className="rounded-lg border border-amber-700/30 bg-amber-50 p-3 text-sm font-medium text-amber-950">Meta has reported an account-level restriction on creating Authentication templates for this WABA. This is a creation-permission blocker, not an approval status. No Utility template will be used as a substitute; Email OTP remains available.</p><p className="rounded-lg bg-[#f7f4ef] p-3 text-sm">WhatsApp OTP cannot be sent through a Utility template. The same expiring, single use code is used across selected channels.</p></section>}
      {show('marketing') && <WhatsAppCampaigns request={api} />}
      {show('consent') && <section className={`${box} space-y-4`}><div><h2 className="text-xl font-semibold">Consent & Preferences</h2><p className="mt-1 text-sm text-gray-600">Transactional and promotional WhatsApp permissions are separate, timestamped and recorded by the backend.</p></div><div className="grid gap-3 sm:grid-cols-2"><article className="rounded-xl border p-4"><h3 className="font-medium">Transactional</h3><p className="mt-2 text-sm text-gray-600">Order status messages require explicit consent for the actual customer phone. A signed global STOP blocks both categories.</p></article><article className="rounded-xl border p-4"><h3 className="font-medium">Marketing</h3><p className="mt-2 text-sm text-gray-600">Collection launches require a separate active grant. Marketing unsubscribe suppresses promotions without withdrawing transactional permission.</p></article><article className="rounded-xl border p-4"><h3 className="font-medium">Customer controls</h3><p className="mt-2 text-sm text-gray-600">Customers can review or withdraw preferences from their account profile. Checkout choices are optional and unchecked by default.</p><a href="/account/profile" className="mt-3 inline-block underline">Open profile preferences</a></article><article className="rounded-xl border p-4"><h3 className="font-medium">Suppression</h3><p className="mt-2 text-sm text-gray-600">Signed STOP and marketing unsubscribe are idempotent. Queued campaign sends recheck consent before dispatch.</p></article></div></section>}
      {show('logs') && <section className={box}><h2 className="text-xl font-semibold">Message Logs</h2>
        <div className="my-4 flex flex-wrap gap-3"><label className="text-sm">Status <select aria-label="Message status filter" className={input} value={statusFilter} onChange={event => { setStatusFilter(event.target.value); setPage(1); }}><option value="">All</option>{['sending', 'accepted', 'sent', 'delivered', 'read', 'failed', 'unknown'].map(value => <option key={value}>{value}</option>)}</select></label><label className="text-sm">Message type <select aria-label="Message type filter" className={input} value={typeFilter} onChange={event => { setTypeFilter(event.target.value); setPage(1); }}><option value="">All</option>{[...Object.keys(status.templates), 'text'].map(value => <option key={value}>{value}</option>)}</select></label><button className={button} disabled={busy} onClick={() => { void load(); setLogRevision(value => value + 1); }}>Refresh logs</button></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[1000px] text-left text-sm"><thead className="bg-[#f7f4ef]"><tr>{['Recipient', 'Type / template', 'Order', 'Current status', 'Created', 'Status history', 'Meta ID / HTTP / failure'].map(label => <th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>{messages.map(message => <tr key={message._id} className="border-t"><td className="p-3">{message.recipient}</td><td className="p-3">{message.type}<br />{message.template}</td><td className="p-3">{message.orderId ?? '—'}</td><td className="p-3">{message.status}</td><td className="p-3">{date(message.createdAt)}</td><td className="p-3 whitespace-nowrap">Accepted: {statusTime(message.acceptedAt)}<br />Sent: {statusTime(message.sentAt)}<br />Delivered: {deliveryReceiptText(message)}<br />Read: {readReceiptText(message)}<br />Failed: {statusTime(message.failedAt)}</td><td className="p-3 break-all">{message.providerId ?? '—'}<br />HTTP: {message.httpStatus ?? '?'}<br />{failureText(message) || '—'}</td></tr>)}</tbody></table>{!messages.length && <p className="p-4 text-sm text-gray-500">No messages match these filters.</p>}</div>
        <div className="mt-4 flex items-center gap-4"><button className={button} disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page}</span><button className={button} disabled={!hasMore} onClick={() => setPage(page + 1)}>Next</button></div>
      </section>}
      {show('advanced') && <div className="space-y-5">
        <section className={box}><h2 className="text-xl font-semibold">Advanced Settings</h2><p className="mt-1 text-sm text-gray-600">Credentials remain in the backend environment. This page never renders access tokens or the App Secret.</p><dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-3"><div><dt>Environment</dt><dd>{status.environment === 'development' ? 'Local development' : 'Production'}</dd></div><div><dt>Business phone</dt><dd>{status.businessPhoneNumber || 'Not verified yet'}</dd></div><div><dt>Phone Number ID</dt><dd>{status.phoneNumberId || 'Not configured'}</dd></div><div><dt>WhatsApp Business Account ID</dt><dd>{status.businessAccountId || 'Not configured'}</dd></div><div><dt>Graph API version</dt><dd>{status.apiVersion || 'Not configured'}</dd></div><div><dt>API configuration</dt><dd>{status.configured ? 'Configured' : `Missing: ${status.missing.join(', ')}`}</dd></div></dl><p className="mt-4 text-sm">Environment automation gate: {status.environmentEnabled ? 'On' : 'Off'} · Admin messaging: {status.enabled ? 'On' : 'Off'} · Local test gate: {status.testSendEnabled ? 'On' : 'Off'} · Marketing gate: {status.marketingEnabled ? 'On' : 'Off'}</p>{!status.enabled && <label className="my-4 flex gap-2 text-sm"><input type="checkbox" checked={enableConfirmation} onChange={event => setEnableConfirmation(event.target.checked)} />I confirm template approval and recipient consent are ready for messaging.</label>}<button role="switch" aria-checked={status.enabled} className={`${button} mt-4`} disabled={busy || (!status.enabled && (!status.environmentEnabled || !status.configured || !enableConfirmation))} onClick={() => void action('', 'PATCH', { enabled: !status.enabled })}>{status.enabled ? 'Disable WhatsApp messaging' : 'Enable WhatsApp messaging'}</button></section>
        <section className={box}><h2 className="text-xl font-semibold">Webhook</h2><p className="mt-3 text-sm">Environment: <strong>{status.environment === 'development' ? 'Local development' : 'Production'}</strong></p><p className="mt-3 break-all font-mono text-sm">{status.callbackUrl || 'Development callback not configured. Set WHATSAPP_DEVELOPMENT_CALLBACK_URL in the backend.'}</p><button disabled={!status.callbackUrl} className={`${button} mt-3`} onClick={() => { void navigator.clipboard.writeText(status.callbackUrl).then(() => setNotice('Callback URL copied.')).catch(() => setNotice('Copy unavailable; select the URL above.')); }}>Copy callback URL</button><dl className="mt-4 grid gap-2 text-sm sm:grid-cols-3"><div><dt>Verification</dt><dd>{status.verifiedAt ? `Verified ${date(status.verifiedAt)}` : 'Not verified'}</dd></div><div><dt>WABA app subscription</dt><dd>{status.subscriptionStatus ?? 'Unknown (run connection check)'}</dd></div><div><dt>Last webhook</dt><dd>{date(status.lastWebhook)}</dd></div></dl><p className="mt-3 text-sm text-gray-600">Meta must subscribe to the <code>messages</code> field for inbound and sent, delivered, read and failed status events. POST signatures use the raw request body and backend App Secret.</p><p className="mt-2 text-sm text-gray-600">{status.environment === 'development' ? 'Use the temporary HTTPS development tunnel callback here; it is separate from production.' : 'The production callback belongs to the production environment.'} The verify token stays in backend configuration.</p></section>
        <section className={box}><h2 className="text-xl font-semibold">Manual lifecycle updates</h2><p className="my-3 text-sm text-gray-600">Record a custom request status or a refund already initiated externally. This does not issue a refund.</p><form className="space-y-4" onSubmit={event => { event.preventDefault(); void action('/lifecycle-update', 'POST', { action: lifecycleAction, recordId, status: customStatus, confirmed: lifecycleConfirmed }); }}><label className="block text-sm">Action <select className={input} value={lifecycleAction} onChange={event => { setLifecycleAction(event.target.value); setLifecycleConfirmed(false); }}><option value="custom_order_status">Custom order status update</option><option value="refund_initiated">Notify refund initiated externally</option></select></label><label className="block text-sm">{lifecycleAction === 'custom_order_status' ? 'Custom request ID' : 'Order ID'}<input required pattern="[a-fA-F0-9]{24}" className={`${input} mt-1 block w-full max-w-xl`} value={recordId} onChange={event => { setRecordId(event.target.value); setLifecycleConfirmed(false); }} /></label>{lifecycleAction === 'custom_order_status' && <label className="block text-sm">Status <select className={input} value={customStatus} onChange={event => { setCustomStatus(event.target.value); setLifecycleConfirmed(false); }}>{['in_review', 'quoted', 'confirmed', 'in_progress', 'completed', 'cancelled'].map(value => <option key={value}>{value}</option>)}</select></label>}<label className="flex gap-2 text-sm"><input type="checkbox" required checked={lifecycleConfirmed} onChange={event => setLifecycleConfirmed(event.target.checked)} />I confirm the record ID and actual business status, and authorize this customer notification.</label><button className={button} disabled={busy || !lifecycleConfirmed}>Record update and notify</button></form></section>
      </div>}
    </div>}
  </section>;
}
