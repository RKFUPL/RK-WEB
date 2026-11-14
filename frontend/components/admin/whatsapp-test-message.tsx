'use client';

import { useEffect, useRef, useState } from 'react';

type WindowStatus = {
  recipient: string; validRecipient: boolean; open: boolean; lastIncomingAt?: string;
  expiresAt?: string; checkedAt: string; testSendEnabled: boolean;
};
type TestResult = {
  status?: string; reason?: string; explanation?: string; providerId?: string; httpStatus?: number;
  previousStatus?: string; correlationId?: string;
  error?: string | { kind?: string; code?: number; subcode?: number; httpStatus?: number };
};
type Props = {
  enabled: boolean; configured: boolean;
  request: (path: string, init?: RequestInit) => Promise<unknown>;
  onComplete: () => void;
};
export const validTestRecipient = (phone: string) => /^\+[1-9][0-9]{6,14}$/.test(phone);
export function testErrorText(result: TestResult): string {
  const error = result.error;
  const details = typeof error === 'string' ? error : error
    ? [error.kind, error.code != null ? `Meta code ${error.code}` : '', error.subcode != null ? `subcode ${error.subcode}` : '', error.httpStatus != null ? `HTTP ${error.httpStatus}` : ''].filter(Boolean).join(' · ')
    : '';
  return [result.explanation ?? result.reason, details].filter(Boolean).join(' · ') || 'WhatsApp request failed.';
}
const field = 'mt-2 block w-full rounded-lg border border-black/20 bg-white p-2 text-sm';
const button = 'rounded-lg border border-black/15 px-4 py-2 text-sm disabled:opacity-40';
const date = (value?: string) => value ? new Date(value).toLocaleString() : 'No verified incoming message recorded';

export function WhatsAppTestMessage({ enabled, configured, request, onComplete }: Props) {
  const [recipient, setRecipient] = useState('');
  const [message, setMessage] = useState('');
  const [consent, setConsent] = useState(false);
  const [windowStatus, setWindowStatus] = useState<WindowStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [windowError, setWindowError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [, setTick] = useState(0);
  const requestId = useRef('');
  const checkedLocallyAt = useRef(0);

  useEffect(() => {
    if (!validTestRecipient(recipient)) return;
    let active = true;
    async function check() {
      if (active) setChecking(true);
      try {
        const data = await request('/test-window', { method: 'POST', body: JSON.stringify({ recipient }) }) as WindowStatus;
        if (active) { checkedLocallyAt.current = Date.now(); setWindowStatus(data); setWindowError(''); }
      } catch (error) {
        if (active) { setWindowStatus(null); setWindowError(error instanceof Error ? error.message : 'Unable to verify the service window.'); }
      } finally { if (active) setChecking(false); }
    }
    const debounce = setTimeout(() => { void check(); }, 350);
    const poll = setInterval(() => { void check(); }, 30_000);
    return () => { active = false; clearTimeout(debounce); clearInterval(poll); };
  }, [recipient, request, refresh]);
  useEffect(() => { const timer = setInterval(() => setTick(value => value + 1), 1000); return () => clearInterval(timer); }, []);

  // Use the backend clock for the remaining window, then age that result locally.
  const remaining = windowStatus?.expiresAt ? Date.parse(windowStatus.expiresAt) - Date.parse(windowStatus.checkedAt) : 0;
  const open = Boolean(windowStatus?.open && windowStatus.recipient === recipient && remaining > Date.now() - checkedLocallyAt.current);
  const canSend = enabled && configured && windowStatus?.testSendEnabled && windowStatus.validRecipient && open && !checking && consent && Boolean(message.trim()) && Array.from(message).length <= 4096 && !busy;

  function changeContent() { requestId.current = ''; setResult(null); }
  async function submit() {
    if (!canSend) return;
    if (!requestId.current) requestId.current = crypto.randomUUID();
    setBusy(true); setResult(null);
    try {
      const response = await request('/test-message', { method: 'POST', body: JSON.stringify({ recipient, message, confirmed: consent, requestId: requestId.current }) }) as TestResult;
      setResult(response); setConsent(false);
      // Retain the key until content changes, so a retry cannot resend silently.
    } catch (error) {
      const response = (error as Error & { response?: TestResult }).response;
      setResult(response ?? { status: 'request_failed', error: error instanceof Error ? error.message : 'Test send failed.' });
    } finally { setBusy(false); setRefresh(value => value + 1); onComplete(); }
  }

  return <section className="rounded-2xl border border-black/[.08] bg-white p-6 shadow-sm" aria-labelledby="text-test-title">
    <h2 id="text-test-title" className="text-xl font-semibold">Send Test WhatsApp Message</h2>
    <p className="mt-3 text-sm text-gray-600">Free-text testing uses a backend-verified 24-hour customer service window. You can also use the separate approved-template test below.</p>
    <p className="mt-3 text-sm">Local test-send gate: <strong>{enabled ? 'Enabled' : 'Off'}</strong>. Automated messaging uses its separate WHATSAPP_ENABLED gate.</p>
    <form className="mt-4 space-y-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <label className="block text-sm">Test message recipient (E.164)<input type="tel" required disabled={busy} maxLength={16} placeholder="+14155552671" value={recipient} onChange={event => { setRecipient(event.target.value); setConsent(false); setWindowStatus(null); setWindowError(''); setChecking(false); changeContent(); }} className={`${field} max-w-md`} /></label>
      <dl className="space-y-2 text-sm" aria-live="polite">
        <div><dt>Recipient number</dt><dd>{recipient || 'Enter a recipient'}</dd></div>
        <div><dt>Current 24-hour window</dt><dd>{!recipient ? 'Not checked' : !validTestRecipient(recipient) ? 'Invalid E.164 format' : checking ? 'Checking with backend…' : windowError || (!windowStatus ? 'Awaiting backend verification' : !windowStatus.validRecipient ? 'Invalid recipient' : open ? 'Open' : 'Closed')}</dd></div>
        <div><dt>Last incoming message</dt><dd>{date(windowStatus?.lastIncomingAt)}</dd></div>
        {open && <div><dt>Window expires</dt><dd>{date(windowStatus?.expiresAt)}</dd></div>}
      </dl>
      {validTestRecipient(recipient) && windowStatus && !open && <p className="text-sm text-amber-800">The recipient must first message this business to open the service window, or use an approved template.</p>}
      <button type="button" className={button} disabled={!validTestRecipient(recipient) || checking || busy} onClick={() => setRefresh(value => value + 1)}>Refresh service window</button>
      <label className="block text-sm">Test message<textarea aria-label="Test message" required disabled={busy} rows={5} value={message} onChange={event => { setMessage(event.target.value); changeContent(); }} className={field} aria-describedby="test-message-length" /></label>
      <p id="test-message-length" className="text-xs text-gray-600">{Array.from(message).length} / 4096 characters. Message contents are sent to Meta and are not retained in delivery logs.</p>
      <label className="flex gap-2 text-sm"><input type="checkbox" required disabled={busy} checked={consent} onChange={event => setConsent(event.target.checked)} />I confirm this manually entered recipient consented and authorize this test message.</label>
      <button className={button} disabled={!canSend}>Send Test Message</button>
    </form>
    {result && <div role="status" className="mt-4 space-y-2 rounded-xl border p-4 text-sm break-words">
      <p>Test message status: {result.status ?? 'failed'}{result.previousStatus ? ` (previous: ${result.previousStatus})` : ''}</p>
      <p>Meta message ID: {result.providerId ?? 'Not returned'}</p>
      <p>Meta API response status: {result.httpStatus ?? 'No HTTP response recorded'}</p>
      {(result.error || result.reason || result.explanation) && <p>Error details: {testErrorText(result)}</p>}
      {result.correlationId && <p>Correlation: {result.correlationId}</p>}
    </div>}
  </section>;
}
