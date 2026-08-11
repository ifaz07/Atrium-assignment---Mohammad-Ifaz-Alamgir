const ROOM_FEES: Record<string, number> = {
  short: 30,
  standard: 40,
  intensive: 120
};

const SEAT_FEES: Record<string, number> = {
  short: 15,
  standard: 20,
  intensive: 60
};

export function roomFee(sessionType: string): number {
  return ROOM_FEES[sessionType] || 0;
}

export function seatFee(sessionType: string): number {
  return SEAT_FEES[sessionType] || 0;
}

export function hoursOfNotice(cancelledAt: Date, startsAt: Date): number {
  return Math.abs(startsAt.getTime() - cancelledAt.getTime()) / (1000 * 60 * 60);
}

export function refundPercent(hoursNotice: number): number {
  if (hoursNotice >= 96) return 1;
  if (hoursNotice >= 48) return 0.5;
  if (hoursNotice >= 24) return 0.25;
  return 0;
}

export function refundAmount(fee: number, percent: number): number {
  return Math.round(fee * percent);
}
