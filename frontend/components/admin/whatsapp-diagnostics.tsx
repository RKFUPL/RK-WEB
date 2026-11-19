'use client';

import { useRef, useState } from 'react';
import { ChevronDown, RefreshCw } from 'lucide-react';

import { diagnosticChecks as checks, diagnosticCounts, safeDiagnosticEvidence as safeEvidence, type DiagnosticCheck } from '@/lib/whatsapp-diagnostics';
export type { DiagnosticCheck } from '@/lib/whatsapp-diagnostics';
type HealthEntity = {
  type?: string; idMasked?: string; can_send_message?: string; can_receive_call_sip?: string;
  additional_info?: string[]; checkedAt?: string;
  scope?: { matchesConfiguredEntity?: boolean; sourcePhoneNumberIdMasked?: string };
  errors?: { code: number; description?: string; channel?: string }[];
};
const colour = (status: string) => status === 'VERIFIED' ? 'border-green-700/30 bg-green-50 text-green-950 dark:bg-green-950 dark:text-green-100'
  : status === 'BLOCKED' ? 'border-red-700/30 bg-red-50 text-red-950 dark:bg-red-950 dark:text-red-100'
  : status === 'ACTION REQUIRED' ? 'border-amber-700/30 bg-amber-50 text-amber-950 dark:bg-amber-950 dark:text-amber-100'
  : 'border-black/15 bg-stone-100 text-stone-700 dark:border-white/20 dark:bg-stone-800 dark:text-stone-200';

const text = (value: unknown) => String(safeEvidence(value) ?? 'Not reported');
const checked = (value?: string) => value && !Number.isNaN(Date.parse(value)) ? new Date(value).toLocaleString() : 'Not checked';
const label = (key: string) => key.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ');

function EvidenceFields({ value }: { value: Record<string, unknown> }) {
  return <dl className="grid min-w-0 gap-3 text-xs sm:grid-cols-2 xl:grid-cols-3">{Object.entries(value).filter(([key]) => key !== 'entities').map(([key, item]) => <div key={key} className="min-w-0"><dt className="font-medium capitalize text-stone-500 dark:text-stone-400">{label(key)}</dt><dd className="mt-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{item && typeof item === 'object' ? <EvidenceFields value={Array.isArray(item) ? Object.fromEntries(item.map((entry, index) => [String(index + 1), entry])) : item as Record<string, unknown>} /> : text(item)}</dd></div>)}</dl>;
}

export function DiagnosticSummary({ values = [], onView }: { values?: DiagnosticCheck[]; onView?: () => void }) {
  const counts = diagnosticCounts(values);
  return <div className="flex flex-wrap items-center gap-2" aria-label="Diagnostic status summary">
    {([['verified', 'Verified'], ['action', 'Action Required'], ['blocked', 'Blocked'], ['unknown', 'Unknown / Not Verified']] as const).map(([key, title]) => <span key={key} className="rounded-lg border border-black/10 px-3 py-2 text-xs dark:border-white/15"><strong>{counts[key]}</strong> {title}</span>)}
    {onView && <button type="button" onClick={onView} className="ml-auto rounded-lg border border-[#9a7a4d]/40 px-4 py-2 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#9a7a4d]">View Diagnostics</button>}
  </div>;
}

export function WhatsAppDiagnostics({ values = [], notes = [], request, onResult }: {
  values?: DiagnosticCheck[]; notes?: { code: string; message: string }[];
  request: (path: string, init?: RequestInit) => Promise<{ checks?: DiagnosticCheck[]; status?: unknown }>;
  onResult: (status: unknown) => void;
}) {
  const [pending, setPending] = useState('');
  const inFlight = useRef(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string[]>([]);
  const [attempt, setAttempt] = useState<{ scope: string; at: string; failed: boolean } | null>(null);
  async function refresh(scope: string) {
    if (inFlight.current) return;
    inFlight.current = true; setPending(scope); setError('');
    try {
      const result = await request('/diagnostics/refresh', { method: 'POST', body: JSON.stringify({ scope }) });
      if (!result.status) throw new Error('Diagnostic refresh returned no updated evidence. Previous evidence retained.');
      onResult(result.status);
      setAttempt({ scope, at: new Date().toISOString(), failed: false });
    } catch (error) {
      setError(error instanceof Error ? text(error.message) : 'Diagnostic refresh failed. Previous evidence retained.');
      setAttempt({ scope, at: new Date().toISOString(), failed: true });
    } finally { inFlight.current = false; setPending(''); }
  }
  return <section role="region" aria-label="Messaging diagnostics" className="min-w-0 rounded-2xl border border-black/[.08] bg-white p-4 shadow-sm dark:border-white/15 dark:bg-stone-900 dark:text-stone-100 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">Messaging Diagnostics</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600 dark:text-stone-300">Current evidence for WhatsApp configuration, messaging eligibility, templates and delivery infrastructure. Diagnostics are read-only and never change sending settings.</p></div>
      <button type="button" disabled={!!pending} className="inline-flex items-center gap-2 rounded-lg border border-black/20 px-4 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#9a7a4d] disabled:opacity-40 dark:border-white/30" onClick={() => void refresh('all')}><RefreshCw size={14} className={pending ? 'animate-spin' : ''} />{pending ? 'Refreshing\u2026' : 'Refresh All Diagnostics'}</button></div>
    <div className="mt-5"><DiagnosticSummary values={values} /></div>
    {attempt && <p role="status" className="mt-3 text-xs text-stone-500 dark:text-stone-400">Last refresh {attempt.failed ? 'attempt failed' : 'response received'} ({attempt.scope}): {checked(attempt.at)}. Each check below retains its own evidence time.</p>}
    {error && <p role="alert" className="mt-3 break-words rounded-lg border border-red-700/30 p-3 text-sm">{error}</p>}
    <div className="mt-5 divide-y divide-black/10 border-y border-black/10 dark:divide-white/15 dark:border-white/15">{checks.map(([key, title]) => {
      const original = values.find(row => row.key === key);
      const sanitizedEvidence = original?.evidence ? safeEvidence(original.evidence) as Record<string, unknown> : undefined;
      const result = original ? { ...safeEvidence(original) as DiagnosticCheck, evidence: sanitizedEvidence } : undefined;
      const status = result?.status || 'UNKNOWN';
      const healthEntities = Array.isArray(result?.evidence?.entities) ? result.evidence.entities as HealthEntity[] : [];
      const open = expanded.includes(key);
      const detailId = `diagnostic-evidence-${key}`;
      return <article key={key} aria-label={`${title} diagnostic`} className="min-w-0 py-4">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 lg:grid-cols-[minmax(10rem,1fr)_7.5rem_minmax(0,1.4fr)_8rem_minmax(0,1fr)_auto]">
          <h3 className="break-words text-sm font-semibold [overflow-wrap:anywhere]">{title}</h3><span className={`w-fit rounded-full border px-2 py-1 text-[10px] ${colour(status)}`}>{status}</span>
          <p className="col-span-2 truncate text-xs text-stone-600 dark:text-stone-300 lg:col-span-1" title={result?.reason}>{result?.reason || 'Not checked. Request fresh evidence from the backend.'}</p>
          <p className="col-span-2 text-xs text-stone-500 dark:text-stone-400 lg:col-span-1"><span className="sr-only">Last checked: </span><time dateTime={result?.checkedAt}>{checked(result?.checkedAt)}</time></p>
          <p className="col-span-2 line-clamp-2 text-xs text-stone-600 dark:text-stone-300 lg:col-span-1" title={result?.action}>{result?.action || 'Refresh this check.'}</p>
          <div className="col-span-2 flex gap-2 lg:col-span-1"><button type="button" aria-label={`${open ? 'Collapse' : 'Expand'} ${title}`} aria-expanded={open} aria-controls={detailId} onClick={() => setExpanded(current => open ? current.filter(item => item !== key) : [...current, key])} className="inline-flex items-center gap-1 rounded border border-black/15 px-2 py-2 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#9a7a4d] dark:border-white/20"><ChevronDown size={14} className={open ? 'rotate-180' : ''} />Evidence</button>
            <button type="button" disabled={!!pending} onClick={() => void refresh(key)} aria-label={`Refresh ${title}`} className="rounded border border-black/15 px-2 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#9a7a4d] disabled:opacity-40 dark:border-white/20"><RefreshCw size={14} className={pending === key ? 'animate-spin' : ''} /></button></div>
        </div>
        {open && <div id={detailId} className="mt-4 min-w-0 space-y-4 rounded-lg bg-stone-50 p-4 dark:bg-stone-800/60">
          <p className="break-words text-sm [overflow-wrap:anywhere]">{result?.reason || 'No evidence recorded.'}</p>
          <dl className="grid gap-3 text-xs sm:grid-cols-2"><div><dt className="font-medium">Evidence source</dt><dd className="mt-1 break-words">{result?.source || 'None'}</dd></div><div><dt className="font-medium">Last checked</dt><dd className="mt-1">{checked(result?.checkedAt)}</dd></div></dl>
          <p className="break-words text-sm [overflow-wrap:anywhere]"><strong>Next action: </strong>{result?.action || 'Refresh this check; follow the backend/provider instructions.'}</p>
        {key === 'billing' && <div aria-label="Messaging health and billing details" className="space-y-3 text-sm">
          <dl className="grid gap-2 sm:grid-cols-2"><div><dt className="text-xs opacity-70">Overall messaging health</dt><dd>{String(result?.evidence?.messagingHealth || 'UNKNOWN')}</dd></div>
            <div><dt className="text-xs opacity-70">Messaging eligibility interpretation</dt><dd>{String(result?.evidence?.messagingEligibilityMode || 'UNKNOWN')}</dd></div>
            <div><dt className="text-xs opacity-70">Billing ledger</dt><dd>{result?.evidence?.billingLedgerVerified === true ? 'Verified' : 'Not verified; no current debt inferred'}</dd></div></dl>
          {result?.evidence?.displayNameLimitedCandidate === true && <p className="rounded-lg border border-amber-600/30 p-3">Phone display name not approved; current messaging capacity is limited. Only an eligible approved Utility manual test can use this specific limitation, with the production test gate, fresh evidence and consent still required.</p>}
          {healthEntities.map((entity, index) => <div key={`${entity.type}-${index}`} className="space-y-2 rounded-lg border border-black/10 p-3 dark:border-white/20">
            <p className="font-medium">{entity.type || 'UNKNOWN'} {entity.idMasked} · Messaging: {entity.can_send_message || 'UNKNOWN'} · SIP calling: {entity.can_receive_call_sip || 'Not reported'}</p>
            {entity.additional_info?.map((info, number) => <p className="break-words" key={number}>{info}</p>)}
            {entity.errors?.map((error, number) => <p className="break-words text-xs" key={number}>{error.channel === 'calling_sip' ? 'SIP calling' : 'Messaging/unknown'} error {error.code}: {error.description || 'Description not returned'}</p>)}
            <p className="text-xs opacity-70">Checked: {entity.checkedAt ? new Date(entity.checkedAt).toLocaleString() : 'Not recorded'} · Scope: source phone {entity.scope?.sourcePhoneNumberIdMasked || 'Unknown'} · {entity.scope?.matchesConfiguredEntity ? 'Matches configured entity' : 'Entity scope unconfirmed'}</p>
          </div>)}
        </div>}
        {key === 'sender' && <dl aria-label="Sender status details" className="grid gap-x-4 gap-y-2 rounded-lg bg-stone-50 p-3 text-sm dark:bg-stone-800 sm:grid-cols-2">
          <div><dt className="text-xs opacity-70">Sender API status</dt><dd>{String(result?.evidence?.senderStatus || result?.evidence?.registration || 'UNKNOWN')}</dd></div>
          <div><dt className="text-xs opacity-70">Display name status (Meta name_status)</dt><dd>{String(result?.evidence?.nameStatus || result?.evidence?.displayNameStatus || 'UNKNOWN')}</dd></div>
          <div><dt className="text-xs opacity-70">Phone ownership OTP code status</dt><dd>{String(result?.evidence?.codeVerificationStatus || 'UNKNOWN')}</dd></div>
          <div><dt className="text-xs opacity-70">WABA business verification</dt><dd>{String(result?.evidence?.businessVerificationStatus || 'UNKNOWN')}</dd></div>
          <div><dt className="text-xs opacity-70">Quality rating</dt><dd>{String(result?.evidence?.qualityRating || 'UNKNOWN')} ({String(result?.evidence?.qualityDisplay || 'UNKNOWN')})</dd></div>
          <div><dt className="text-xs opacity-70">Messaging capacity tier</dt><dd>{String(result?.evidence?.messagingLimitTier || 'UNKNOWN')}</dd></div>
          <div><dt className="text-xs opacity-70">Capacity</dt><dd>{String(result?.evidence?.messagingLimitDescription || 'Not reported')}</dd></div>
          <div><dt className="text-xs opacity-70">Phone Number ID</dt><dd>{String(result?.evidence?.phoneNumberId || 'Not reported')}</dd></div>
          <div><dt className="text-xs opacity-70">Business phone</dt><dd>{String(result?.evidence?.phoneMasked || 'Not reported')}</dd></div>
        </dl>}

          {result?.evidence && <EvidenceFields value={Object.fromEntries(Object.entries(result.evidence).filter(([field]) => !((key === 'billing' && ['messagingHealth', 'messagingEligibilityMode', 'billingLedgerVerified', 'displayNameLimitedCandidate'].includes(field)) || (key === 'sender' && ['senderStatus', 'registration', 'nameStatus', 'displayNameStatus', 'codeVerificationStatus', 'businessVerificationStatus', 'qualityRating', 'qualityDisplay', 'messagingLimitTier', 'messagingLimitDescription', 'phoneNumberId', 'phoneMasked'].includes(field))))) } />}
          {sanitizedEvidence && <details><summary className="cursor-pointer text-xs underline focus-visible:outline focus-visible:outline-2">Raw diagnostic evidence</summary><pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-white p-3 text-xs dark:bg-stone-900">{JSON.stringify(sanitizedEvidence, null, 2)}</pre></details>}
        </div>}
      </article>;
    })}</div>
    {!values.length && notes.length > 0 && <details className="mt-4"><summary className="cursor-pointer text-sm">Existing configuration notes</summary><ul className="mt-2 space-y-2 text-sm">{notes.map(row => <li className="break-words" key={row.code}>{text(row.message)}</li>)}</ul></details>}
  </section>;
}
