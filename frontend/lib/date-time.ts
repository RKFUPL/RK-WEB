type DateInput = string | number | Date | null | undefined;

function parseTimestamp(value: DateInput): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    const copy = new Date(value.getTime());
    return Number.isNaN(copy.getTime()) ? null : copy;
  }

  const raw = String(value).trim();
  if (!raw) return null;
  // API timestamps are required to carry a timezone. Treat legacy naive ISO
  // values as UTC because they came from MongoDB's UTC date storage, rather
  // than silently interpreting them in the browser's local timezone.
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2}|GMT|UTC)$/i.test(raw);
  const parsed = new Date(hasTimezone ? raw : `${raw}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const dateOptions: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
};

const longDateOptions: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
};

const dateTimeOptions: Intl.DateTimeFormatOptions = {
  ...dateOptions,
  hour: 'numeric',
  minute: '2-digit',
};

export function formatDate(value: DateInput): string {
  const parsed = parseTimestamp(value);
  return parsed ? new Intl.DateTimeFormat('en-IN', dateOptions).format(parsed) : '—';
}

export function formatLongDate(value: DateInput): string {
  const parsed = parseTimestamp(value);
  return parsed ? new Intl.DateTimeFormat('en-IN', longDateOptions).format(parsed) : '—';
}

export function formatDateTime(value: DateInput): string {
  const parsed = parseTimestamp(value);
  return parsed ? new Intl.DateTimeFormat('en-IN', dateTimeOptions).format(parsed) : '—';
}

export function formatTime(value: DateInput): string {
  const parsed = parseTimestamp(value);
  return parsed ? new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' }).format(parsed) : '—';
}

export function relativeTime(value: DateInput, now = Date.now()): string {
  const parsed = parseTimestamp(value);
  if (!parsed) return '';
  const seconds = Math.max(0, Math.floor((now - parsed.getTime()) / 1000));
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export { parseTimestamp };
