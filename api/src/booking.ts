export const CENTRE_TIMEZONE = process.env.CENTRE_TIMEZONE || 'America/New_York';

const DURATIONS_MINUTES: Record<string, number> = {
  short: 45,
  standard: 60,
  intensive: 210
};

type BookingTimes = {
  startsAt: Date;
  endsAt: Date;
  sessionType: string;
};

function localParts(date: Date): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: CENTRE_TIMEZONE,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    })
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );
}

export function validateBookingTimes({ startsAt, endsAt, sessionType }: BookingTimes): string | null {
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    return 'starts_at and ends_at must be valid timestamps';
  }

  const requiredDuration = DURATIONS_MINUTES[sessionType];
  if (!requiredDuration) return 'session_type must be short, standard, or intensive';
  if (endsAt.getTime() - startsAt.getTime() !== requiredDuration * 60 * 1000) {
    return `${sessionType} sessions must reserve the room for ${requiredDuration} minutes`;
  }

  const start = localParts(startsAt);
  const end = localParts(endsAt);
  const startMinutes = Number(start.hour) * 60 + Number(start.minute);
  const endMinutes = Number(end.hour) * 60 + Number(end.minute);

  if (Number(start.minute) % 15 !== 0) {
    return 'sessions must start at :00, :15, :30, or :45';
  }
  if (start.weekday === 'Sun') return 'the centre is closed on Sundays';
  if (startMinutes < 7 * 60 || endMinutes > 21 * 60 || end.weekday !== start.weekday) {
    return 'the session must fit within 07:00 to 21:00 America/New_York opening hours';
  }

  return null;
}

export function hasRequiredCoachNotice(startsAt: Date, now: Date = new Date()): boolean {
  return startsAt.getTime() - now.getTime() >= 48 * 60 * 60 * 1000;
}
