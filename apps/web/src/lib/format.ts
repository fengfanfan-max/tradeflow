/**
 * Dates.
 *
 * Every timestamp on the wire is a UTC ISO 8601 instant and every date is
 * `YYYY-MM-DD`. This is a UK trade business — the currency is GBP and the VAT
 * rules are UK — so the office's day is the London day, not the server's and not
 * the visitor's. Formatting and day boundaries are therefore pinned to one zone
 * rather than left to `toLocaleString`, which on a server rendering for a
 * browser in another zone would print a different date to the same person twice.
 */

export const BUSINESS_TIME_ZONE = 'Europe/London';

const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: BUSINESS_TIME_ZONE,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

const DATE_TIME_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: BUSINESS_TIME_ZONE,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const TIME_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: BUSINESS_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const WEEKDAY_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: BUSINESS_TIME_ZONE,
  weekday: 'short',
  day: '2-digit',
  month: 'short',
});

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(value: string | Date | null | undefined, fallback = '—'): string {
  const date = toDate(value);
  return date ? DATE_FORMAT.format(date) : fallback;
}

export function formatDateTime(value: string | Date | null | undefined, fallback = '—'): string {
  const date = toDate(value);
  return date ? DATE_TIME_FORMAT.format(date) : fallback;
}

export function formatTime(value: string | Date | null | undefined, fallback = '—'): string {
  const date = toDate(value);
  return date ? TIME_FORMAT.format(date) : fallback;
}

export function formatDayHeading(value: string | Date): string {
  const date = toDate(value);
  return date ? WEEKDAY_FORMAT.format(date) : '—';
}

export function formatDateRange(
  from: string | Date | null | undefined,
  to: string | Date | null | undefined,
): string {
  const start = toDate(from);
  const end = toDate(to);
  if (!start) return '—';
  if (!end || start.getTime() === end.getTime()) return formatTime(start);
  // Both ends on the same London day reads better as a time range; across days
  // the date has to be repeated or the span is ambiguous.
  const sameDay = DATE_FORMAT.format(start) === DATE_FORMAT.format(end);
  return sameDay
    ? `${formatTime(start)}–${formatTime(end)}`
    : `${formatDateTime(start)} → ${formatDateTime(end)}`;
}

export function formatDuration(
  from: string | Date | null | undefined,
  to: string | Date | null | undefined,
): string {
  const start = toDate(from);
  const end = toDate(to);
  if (!start || !end) return '—';
  const minutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

/* ------------------------------------------------------------------ */
/* Business-day boundaries                                             */
/* ------------------------------------------------------------------ */

/** The offset of `timeZone` from UTC at a given instant, in milliseconds. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? '0');
  const asIfUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  );
  return asIfUtc - instant.getTime();
}

/**
 * The instant at which `timeZone`'s wall clock reads the given date and time.
 *
 * Applied twice because the offset itself depends on the instant: the first pass
 * guesses with the offset at the naive time, the second corrects using the offset
 * that actually applies, which is what makes this correct across a DST change.
 */
export function zonedTimeToInstant(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  timeZone = BUSINESS_TIME_ZONE,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  const firstGuess = naive - zoneOffsetMs(new Date(naive), timeZone);
  return new Date(naive - zoneOffsetMs(new Date(firstGuess), timeZone));
}

/** `YYYY-MM-DD` as read by the wall clock in `timeZone`. */
export function zonedDateParts(instant: Date, timeZone = BUSINESS_TIME_ZONE): [number, number, number] {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? '0');
  return [get('year'), get('month'), get('day')];
}

function startOfDay(instant: Date, dayOffset: number, timeZone = BUSINESS_TIME_ZONE): Date {
  const [year, month, day] = zonedDateParts(instant, timeZone);
  // Date.UTC normalises an overflowing day number into the next month, which is
  // the arithmetic we want for "tomorrow" and "a week on Tuesday".
  const rolled = new Date(Date.UTC(year, month - 1, day + dayOffset));
  return zonedTimeToInstant(
    rolled.getUTCFullYear(),
    rolled.getUTCMonth() + 1,
    rolled.getUTCDate(),
    0,
    0,
    timeZone,
  );
}

/** `[start, end)` of the business day containing `now`. */
export function businessDayRange(now = new Date()): { from: Date; to: Date } {
  return { from: startOfDay(now, 0), to: startOfDay(now, 1) };
}

export function addBusinessDays(instant: Date, days: number): Date {
  return startOfDay(instant, days);
}

/**
 * A value for `<input type="datetime-local">`, read in business time.
 *
 * The round trip is deliberately explicit: the form sends a wall-clock string,
 * `fromZonedInputValue` reads it back in the same zone, so what the operator
 * typed at 09:00 is stored as 09:00 in the office's day whatever zone the
 * browser happens to be in.
 */
export function toZonedInputValue(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour').padStart(2, '0')}:${get('minute')}`;
}

/** The inverse of `toZonedInputValue`. Returns null for an empty or bad value. */
export function fromZonedInputValue(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  return zonedTimeToInstant(
    Number(year),
    Number(month),
    Number(day),
    Number(hour),
    Number(minute),
  );
}

/** The `YYYY-MM-DD` a business date travels as on the wire. */
export function toIsoDate(value: string | Date): string {
  const date = toDate(value);
  if (!date) return '';
  const [year, month, day] = zonedDateParts(date);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
