// Calendar dates belong to the venue, independent of the viewer's time zone.
export function formatMatchDate(game, locale = 'en') {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(game?.date || '') ? new Date(`${game.date}T12:00:00Z`) : new Date(game?.scheduledAt || '');
  if (!Number.isFinite(date.getTime())) return game?.dateLabel || '';
  return new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'en-GB', {
    day: 'numeric', month: 'long', timeZone: /^\d{4}-\d{2}-\d{2}$/.test(game?.date || '') ? 'UTC' : (game?.timeZone || 'Europe/Moscow')
  }).format(date);
}
