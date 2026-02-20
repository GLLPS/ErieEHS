import { differenceInDays, format, parseISO, isValid } from 'date-fns';

export function daysUntil(dateStr) {
  if (!dateStr) return null;
  const date = parseISO(dateStr);
  if (!isValid(date)) return null;
  return differenceInDays(date, new Date());
}

export function formatDate(dateStr) {
  if (!dateStr) return '—';
  const date = parseISO(dateStr);
  if (!isValid(date)) return dateStr;
  return format(date, 'MMM d, yyyy');
}

export function formatShortDate(dateStr) {
  if (!dateStr) return '—';
  const date = parseISO(dateStr);
  if (!isValid(date)) return dateStr;
  return format(date, 'MM/dd');
}

export function countdownText(dateStr) {
  const days = daysUntil(dateStr);
  if (days === null) return '—';
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  return `${days}d remaining`;
}

export function getUrgencyClass(dateStr) {
  const days = daysUntil(dateStr);
  if (days === null) return '';
  if (days < 0) return 'overdue';
  if (days <= 7) return 'urgent';
  if (days <= 30) return 'upcoming';
  return 'normal';
}
