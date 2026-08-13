export const CENTRE_TIMEZONE = process.env.CENTRE_TIMEZONE || 'America/New_York';

export function formatCentreDateTime(value: Date | string, timezone = CENTRE_TIMEZONE): string {
  const date = value instanceof Date ? value : new Date(value);

  return `${new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  }).format(date)} (${timezone})`;
}
