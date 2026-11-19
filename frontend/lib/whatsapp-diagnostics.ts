export type DiagnosticCheck = {
  key: string; status: string; reason: string; action: string; source: string;
  checkedAt?: string; evidence?: Record<string, unknown>;
};
export const diagnosticChecks = [
  ['configuration', 'Application configuration'], ['billing', 'Messaging health and billing'],
  ['sender', 'Sender and business status'], ['templates', 'Template eligibility'],
  ['webhook', 'App-level webhook subscription'], ['worker', 'Worker status and configuration'], ['outbox', 'Outbox status'],
] as const;
export function diagnosticCounts(values: DiagnosticCheck[] = []) {
  const counts = { verified: 0, action: 0, blocked: 0, unknown: 0 };
  for (const [key] of diagnosticChecks) {
    const status = values.find(row => row.key === key)?.status;
    if (status === 'VERIFIED') counts.verified++;
    else if (status === 'ACTION REQUIRED') counts.action++;
    else if (status === 'BLOCKED') counts.blocked++;
    else counts.unknown++;
  }
  return counts;
}

// Backend diagnostics are already scoped/redacted. Keep a second display guard
// for accidental sensitive fields; raw evidence uses the same sanitized object.
export function safeDiagnosticEvidence(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(/Bearer\s+\S+|EAA[A-Za-z0-9]{30,}|\+[1-9][0-9]{7,14}/g, '[redacted]');
  if (Array.isArray(value)) return value.map(safeDiagnosticEvidence);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/(access.?token|app.?secret|webhook.?secret|authorization|customer.?phone|^recipient(?:s|Phone|Number)?$|message.?bod|payload|password)/i.test(key))
    .map(([key, item]) => [key, safeDiagnosticEvidence(item)]));
  return value;
}
