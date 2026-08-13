export const centreTimeZone = 'America/New_York';

export function centreDateString(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: centreTimeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function addCentreDays(value: string, amount: number): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function centreWeekMonday(value: string): string {
  const date = new Date(`${value}T12:00:00Z`);
  return addCentreDays(value, -((date.getUTCDay() + 6) % 7));
}

export function centreLocalToIso(dateValue: string, timeValue: string): string {
  const [year, month, day] = dateValue.split('-').map(Number);
  const [hour, minute] = timeValue.split(':').map(Number);
  const desired = Date.UTC(year, month - 1, day, hour, minute);
  let result = desired;
  for (let attempt = 0; attempt < 2; attempt++) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: centreTimeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(result));
    const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
    const observed = Date.UTC(values.year, values.month - 1, values.day, values.hour, values.minute);
    result += desired - observed;
  }
  return new Date(result).toISOString();
}
