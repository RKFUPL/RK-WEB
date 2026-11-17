'use client';

import { useState } from 'react';

export type DiagnosticCheck = {
  key: string; status: string; reason: string; action: string; source: string;
  checkedAt?: string; evidence?: Record<string, unknown>;
};
const checks = [
  ['configuration', 'Application configuration'], ['billing', 'Messaging health and billing'],
  ['sender', 'Sender and business status'], ['templates', 'Template eligibility'],
  ['webhook', 'App-level webhook subscription'], ['worker', 'Worker status and configuration'], ['outbox', 'Outbox status'],
] as const;
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

export function WhatsAppDiagnostics({ values = [], notes = [], request, onResult }: {
  values?: DiagnosticCheck[]; notes?: { code: string; message: string }[];
  request: (path: string, init?: RequestInit) => Promise<{ checks?: DiagnosticCheck[]; status?: unknown }>;
  onResult: (status: unknown) => void;
}) {
  const [pending, setPending] = useState('');
  const [error, setError] = useState('');
  async function refresh(scope: string) {
    setPending(scope); setError('');
    try {
      const result = await request('/diagnostics/refresh', { method: 'POST', body: JSON.stringify({ scope }) });
      if (result.status) onResult(result.status);
    } catch (error) { setError(error instanceof Error ? error.message : 'Diagnostic refresh failed.'); }
    finally { setPending(''); }
  }
  return <section role="region" aria-label="Messaging diagnostics" className="min-w-0 rounded-2xl border border-black/[.08] bg-white p-6 shadow-sm dark:border-white/15 dark:bg-stone-900 dark:text-stone-100">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Messaging diagnostics</h2><p className="mt-2 max-w-3xl text-sm opacity-75">Refreshes read current backend/provider evidence. They never activate a gate, send a message, change Meta settings or replay a job. Unknown evidence is not a confirmed failure.</p></div>
      <button type="button" disabled={!!pending} className="rounded-lg border border-black/20 px-4 py-2 text-sm disabled:opacity-40 dark:border-white/30" onClick={() => void refresh('all')}>{pending === 'all' ? 'Refreshing diagnostics…' : 'Refresh All Diagnostics'}</button></div>
    {error && <p role="alert" className="mt-3 break-words rounded-lg border border-red-700/30 p-3 text-sm">{error}</p>}
    <div className="mt-5 grid min-w-0 gap-4 lg:grid-cols-2">{checks.map(([key, title]) => {
      const result = values.find(row => row.key === key);
      const status = result?.status || 'UNKNOWN';
      const healthEntities = Array.isArray(result?.evidence?.entities) ? result.evidence.entities as HealthEntity[] : [];
      return <article key={key} aria-label={`${title} diagnostic`} className="min-w-0 space-y-3 rounded-xl border border-black/10 p-4 dark:border-white/20">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{title}</h3><span className={`rounded-full border px-2 py-1 text-xs ${colour(status)}`}>{status}</span></div>
        <p className="break-words text-sm">{result?.reason || 'Not checked. Request fresh evidence from the backend.'}</p>
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
        <dl className="space-y-1 text-xs opacity-75"><div><dt className="inline font-medium">Last checked: </dt><dd className="inline">{result?.checkedAt ? new Date(result.checkedAt).toLocaleString() : 'Not checked'}</dd></div><div><dt className="inline font-medium">Evidence source: </dt><dd className="inline break-words">{result?.source || 'None'}</dd></div></dl>
        <p className="break-words text-sm"><strong>Next action: </strong>{result?.action || 'Refresh this check; follow its precise backend/provider instructions.'}</p>
        {!!result?.evidence && <details><summary className="cursor-pointer text-xs underline">View diagnostic evidence</summary><pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-stone-100 p-3 text-xs text-stone-800 dark:bg-stone-800 dark:text-stone-100">{JSON.stringify(result.evidence, null, 2)}</pre></details>}
        <button type="button" disabled={!!pending} className="rounded-lg border border-black/20 px-3 py-2 text-sm disabled:opacity-40 dark:border-white/30" onClick={() => void refresh(key)} aria-label={`Refresh ${title}`}>{pending === key ? 'Refreshing…' : `Refresh ${title}`}</button>
      </article>;
    })}</div>
    {!values.length && notes.length > 0 && <details className="mt-4" open><summary className="text-sm">Existing configuration notes — use refresh for structured evidence</summary><ul className="mt-2 space-y-2 text-sm">{notes.map(row => <li className="break-words" key={row.code}>{row.message}</li>)}</ul></details>}
  </section>;
}
