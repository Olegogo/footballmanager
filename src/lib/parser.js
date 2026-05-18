import { normalizeUsername, unique } from './utils.js';

const MONTHS = {
  января: 0,
  февраля: 1,
  марта: 2,
  апреля: 3,
  мая: 4,
  июня: 5,
  июля: 6,
  августа: 7,
  сентября: 8,
  октября: 9,
  ноября: 10,
  декабря: 11
};

const DATE_REGEX = new RegExp(
  `(?:(понедельник|вторник|среда|четверг|пятница|суббота|воскресенье)\\s+)?(\\d{1,2})\\s+(${Object.keys(MONTHS).join('|')})`,
  'i'
);
const TIME_REGEX = /\b([01]?\d|2[0-3]):([0-5]\d)\b/;
const PLAYER_LINE_REGEX = /^\s*(?:(?:\d{1,2}\.)|[-•])?\s*@([A-Za-z0-9_]{3,32})\b/;

export function flattenTelegramExportText(text) {
  if (typeof text === 'string') {
    return text;
  }

  if (!Array.isArray(text)) {
    return '';
  }

  return text
    .map((part) => {
      if (typeof part === 'string') {
        return part;
      }

      if (typeof part?.text === 'string') {
        return part.text;
      }

      return '';
    })
    .join('');
}

function buildScheduledDate(day, monthIndex, timeMatch, referenceDate) {
  const refDate = new Date(referenceDate);
  const hours = Number(timeMatch[1]);
  const minutes = Number(timeMatch[2]);
  const timezoneOffset = process.env.CHAT_TIMEZONE_OFFSET || '+03:00';
  let year = refDate.getFullYear();
  let candidate = createDateWithOffset(year, monthIndex, day, hours, minutes, timezoneOffset);
  const diffDays = (candidate.getTime() - refDate.getTime()) / (1000 * 60 * 60 * 24);

  if (diffDays < -180) {
    year += 1;
    candidate = createDateWithOffset(year, monthIndex, day, hours, minutes, timezoneOffset);
  } else if (diffDays > 180) {
    year -= 1;
    candidate = createDateWithOffset(year, monthIndex, day, hours, minutes, timezoneOffset);
  }

  return candidate;
}

function createDateWithOffset(year, monthIndex, day, hours, minutes, offset) {
  const match = String(offset).trim().match(/^([+-])(\d{2}):(\d{2})$/);

  if (!match) {
    return new Date(year, monthIndex, day, hours, minutes, 0, 0);
  }

  const sign = match[1] === '-' ? -1 : 1;
  const offsetHours = Number(match[2]);
  const offsetMinutes = Number(match[3]);
  const totalOffsetMinutes = sign * (offsetHours * 60 + offsetMinutes);
  const utcTimestamp = Date.UTC(year, monthIndex, day, hours, minutes, 0, 0) - totalOffsetMinutes * 60 * 1000;
  return new Date(utcTimestamp);
}

function normalizeLines(rawText) {
  return String(rawText ?? '')
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export function parseAnnouncementText(rawText, referenceDate = new Date()) {
  const lines = normalizeLines(rawText);

  if (!lines.length) {
    return null;
  }

  const playerLines = lines
    .map((line, index) => {
      const match = line.match(PLAYER_LINE_REGEX);
      return match ? { index, username: normalizeUsername(match[1]) } : null;
    })
    .filter(Boolean);

  const usernames = unique(playerLines.map((item) => item.username));

  if (usernames.length < 5) {
    return null;
  }

  const firstPlayerIndex = playerLines[0].index;
  const lastPlayerIndex = playerLines[playerLines.length - 1].index;
  const headerLines = lines.slice(0, firstPlayerIndex);
  const footerLines = lines.slice(lastPlayerIndex + 1);

  let dateLine = '';
  let dateMatch = null;
  let timeLine = '';
  let timeMatch = null;

  for (const line of headerLines.length ? headerLines : lines) {
    if (!dateMatch) {
      const candidate = line.match(DATE_REGEX);
      if (candidate) {
        dateMatch = candidate;
        dateLine = line;
      }
    }

    if (!timeMatch) {
      const candidate = line.match(TIME_REGEX);
      if (candidate) {
        timeMatch = candidate;
        timeLine = line;
      }
    }
  }

  if (!dateMatch || !timeMatch) {
    return null;
  }

  const location = headerLines.find((line) => {
    if (line === dateLine || line === timeLine) {
      return false;
    }

    return !PLAYER_LINE_REGEX.test(line);
  }) ?? '';

  const footerWithoutPlayers = footerLines.filter((line) => !PLAYER_LINE_REGEX.test(line));
  const priceLine = footerWithoutPlayers.find((line) => /\d/.test(line) && /(р|руб)/i.test(line)) ?? '';
  const paymentLines = footerWithoutPlayers.filter((line) => line !== priceLine);
  const monthIndex = MONTHS[dateMatch[3].toLowerCase()];
  const scheduledAt = buildScheduledDate(Number(dateMatch[2]), monthIndex, timeMatch, referenceDate);
  const key = [
    scheduledAt.toISOString().slice(0, 16),
    location.toLowerCase(),
    usernames.join(',')
  ].join('|');

  return {
    rawText: String(rawText ?? '').trim(),
    dateLabel: dateLine,
    location,
    timeLabel: timeMatch[0],
    priceLine,
    paymentLines,
    playerUsernames: usernames,
    scheduledAt: scheduledAt.toISOString(),
    date: scheduledAt.toISOString().slice(0, 10),
    time: timeMatch[0],
    key
  };
}

export function parseTelegramExportGames(payload, referenceDate = new Date()) {
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];

  return messages
    .map((message) => {
      const rawText = flattenTelegramExportText(message?.text);
      const sourceDate = message?.date ? new Date(message.date) : referenceDate;
      const announcement = parseAnnouncementText(rawText, sourceDate);

      if (!announcement) {
        return null;
      }

      return {
        messageId: message?.id ?? null,
        rawText,
        sourceDate: sourceDate.toISOString(),
        announcement
      };
    })
    .filter(Boolean)
    .sort((left, right) => new Date(left.announcement.scheduledAt) - new Date(right.announcement.scheduledAt));
}

export function parseAnnouncementTextLog(rawText, referenceDate = new Date()) {
  const lines = String(rawText ?? '')
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .split('\n');
  const items = [];

  for (let start = 0; start < lines.length; start += 1) {
    const trimmedLine = lines[start].trim();

    if (!trimmedLine || !DATE_REGEX.test(trimmedLine)) {
      continue;
    }

    let nextDateIndex = lines.length;

    for (let cursor = start + 1; cursor < lines.length; cursor += 1) {
      if (DATE_REGEX.test(lines[cursor].trim())) {
        nextDateIndex = cursor;
        break;
      }
    }

    const maxEnd = Math.min(nextDateIndex, start + 32);
    let bestAnnouncement = null;
    let bestEnd = start + 1;

    for (let end = start + 5; end <= maxEnd; end += 1) {
      const chunk = lines.slice(start, end).join('\n');
      const announcement = parseAnnouncementText(chunk, referenceDate);

      if (!announcement) {
        continue;
      }

      bestAnnouncement = announcement;
      bestEnd = end;
    }

    if (!bestAnnouncement) {
      continue;
    }

    items.push({
      messageId: null,
      rawText: bestAnnouncement.rawText,
      sourceDate: new Date(referenceDate).toISOString(),
      announcement: bestAnnouncement
    });
    start = bestEnd - 1;
  }

  return items
    .filter((item, index, collection) => collection.findIndex((candidate) => candidate.announcement.key === item.announcement.key) === index)
    .sort((left, right) => new Date(left.announcement.scheduledAt) - new Date(right.announcement.scheduledAt));
}
