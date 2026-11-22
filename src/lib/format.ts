import { LOCALES, translate, type Language } from '../shared/i18n';

export function compactNumber(value: number, language: Language = 'pl'): string {
  return new Intl.NumberFormat(LOCALES[language], { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

export function fullNumber(value: number, language: Language = 'pl'): string { return new Intl.NumberFormat(LOCALES[language]).format(value); }

export function contextColor(percent: number | null): string {
  return percent === null ? '#738093' : percent >= 90 ? '#fa8b8b' : percent >= 70 ? '#f0bf74' : '#6bdfbc';
}

export function ago(timestamp: string | null, language: Language = 'pl'): string {
  if (!timestamp) return translate(language, 'brak pomiaru');
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(timestamp)) / 1000));
  if (!Number.isFinite(seconds)) return translate(language, 'brak pomiaru');
  if (seconds < 10) return translate(language, 'przed chwilą');
  const formatter = new Intl.RelativeTimeFormat(LOCALES[language], { numeric: 'always', style: 'short' });
  if (seconds < 60) return formatter.format(-seconds, 'second');
  if (seconds < 3600) return formatter.format(-Math.floor(seconds / 60), 'minute');
  if (seconds < 86400) return formatter.format(-Math.floor(seconds / 3600), 'hour');
  return formatter.format(-Math.floor(seconds / 86400), 'day');
}

export function dateTime(timestamp: string, language: Language = 'pl'): string {
  return timestamp && Number.isFinite(Date.parse(timestamp)) ? new Intl.DateTimeFormat(LOCALES[language], { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp)) : '—';
}
export function estimatedUsd(value: number | null, language: string): string {
  if (value === null) return '—';
  const format = new Intl.NumberFormat(language, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 });
  if (value > 0 && value < 0.0001) return `< ${format.format(0.0001)}`;
  return format.format(value);
}
