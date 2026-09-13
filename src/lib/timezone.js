import { AppError } from './errors.js';

export function scheduleInTimeZone(date, time, timeZone) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const clock = /^([01]\d|2[0-3]):([0-5]\d)/.exec(time);
  if (!match || !clock) throw new AppError('schedule_required');
  const [year, month, day] = match.slice(1).map(Number);
  const local = Date.UTC(year, month - 1, day, +clock[1], +clock[2]);
  if (new Date(local).getUTCMonth() !== month - 1 || day < 1) throw new AppError('schedule_required');
  const fixed = /^([+-])(\d{2}):(\d{2})$/.exec(timeZone);
  if (fixed) {
    if (+fixed[2] > 14 || +fixed[3] > 59 || (+fixed[2] === 14 && +fixed[3] !== 0)) throw new AppError('invalid_timezone');
    const minutes = (+fixed[2] * 60 + +fixed[3]) * (fixed[1] === '-' ? -1 : 1);
    return new Date(local - minutes * 60000);
  }
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  } catch { throw new AppError('invalid_timezone'); }
  const wallTime = (timestamp) => {
    const p = Object.fromEntries(formatter.formatToParts(new Date(timestamp)).map(p => [p.type, p.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  };
  const offsets = new Set();
  for (let hour = -36; hour <= 36; hour += 6) {
    const candidate = local + hour * 3600000;
    offsets.add(wallTime(candidate) - candidate);
  }
  const matches = [...offsets].map(offset => local - offset).filter(candidate => wallTime(candidate) === local);
  if (matches.length !== 1) throw new AppError('invalid_local_time');
  return new Date(matches[0]);
}
