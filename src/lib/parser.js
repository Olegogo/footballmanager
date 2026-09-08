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
  `(?:(понедельник|вторник|среда|четверг|пятница|суббота|воскресенье)\\s+)?(\\d{1,2})\\s+(${Object.keys(MONTHS).join('|')})(?:\\s+(20\\d{2})(?:\\s*г(?:ода|\\.)?)?)?`,
  'i'
);
const TIME_REGEX = /\b([01]?\d|2[0-3]):([0-5]\d)\b/;
const TIME_RANGE_REGEX = /\b([01]?\d|2[0-3]):([0-5]\d)(?:\s*[-–—]\s*(?:[01]?\d|2[0-3]):[0-5]\d)?\b/;
const WEEKDAY_REGEX = /(^|[\s,;.])(?:понедельник|вторник|среда|четверг|пятница|суббота|воскресенье)(?=$|[\s,;.])/gi;
const PLAYER_LINE_REGEX = /^\s*(?:(?:\d{1,2}\.)|[-•])?\s*@([A-Za-z0-9_]{3,32})\b/;
const BARE_PLAYER_LINE_REGEX = /^\s*(?:(?:\d{1,2}\.)|[-•])\s*(?!@)(.+?)\s*$/u;
const REQUIRED_PAYMENT_PHONE = '89295991499';

function formatDateLabel(dateMatch) {
  return `${Number(dateMatch[2])} ${dateMatch[3].toLowerCase()}`;
}

function parsePlayerLine(line) {
  const usernameMatch = line.match(PLAYER_LINE_REGEX);

  if (usernameMatch) {
    const username = normalizeUsername(usernameMatch[1]);
    return {
      username,
      displayName: username ? `@${username}` : ''
    };
  }

  const bareMatch = line.match(BARE_PLAYER_LINE_REGEX);

  if (!bareMatch) {
    return null;
  }

  const displayName = bareMatch[1]
    .replace(/[^\p{L}\p{N}_\s-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const username = normalizeUsername(displayName)
    .replace(/\s+/g, '_')
    .replace(/[^\p{L}\p{N}_]/gu, '');

  if (username.length < 3 || !/[^\d_]/u.test(username)) {
    return null;
  }

  return {
    username,
    displayName
  };
}

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

function buildScheduledDate(day, monthIndex, timeMatch, referenceDate, explicitYear) {
  const refDate = new Date(referenceDate);
  if (!Number.isFinite(refDate.getTime())) return null;
  const hours = Number(timeMatch[1]);
  const minutes = Number(timeMatch[2]);
  const timezoneOffset = process.env.CHAT_TIMEZONE_OFFSET || '+03:00';
  let year = explicitYear ? Number(explicitYear) : refDate.getUTCFullYear();
  let candidate = createDateWithOffset(year, monthIndex, day, hours, minutes, timezoneOffset);
  const diffDays = (candidate.getTime() - refDate.getTime()) / (1000 * 60 * 60 * 24);

  if (!explicitYear && diffDays < -180) {
    year += 1;
    candidate = createDateWithOffset(year, monthIndex, day, hours, minutes, timezoneOffset);
  } else if (!explicitYear && diffDays > 180) {
    year -= 1;
    candidate = createDateWithOffset(year, monthIndex, day, hours, minutes, timezoneOffset);
  }

  const calendarDate = new Date(Date.UTC(year, monthIndex, day));
  if (calendarDate.getUTCMonth() !== monthIndex || !Number.isFinite(candidate.getTime())) return null;
  return { scheduledAt: candidate, date: `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}` };
}

function locationFromHeader(line) {
  return line.replace(DATE_REGEX, '').replace(TIME_RANGE_REGEX, '')
    .replace(WEEKDAY_REGEX, '$1')
    .replace(/(?:^|\s)(?:дата|время|начало|место|адрес)\s*:/gi, ' ')
    .replace(/^[\s.,:;–—-]+|[\s.,:;–—-]+$/g, '').trim();
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

function hasRequiredPaymentBlock(lines) {
  return lines.some((line, index) => {
    const digits = line.replace(/\D/g, '');
    const nextLine = lines[index + 1] ?? '';

    return (
      digits === REQUIRED_PAYMENT_PHONE &&
      /альфа/i.test(nextLine) &&
      /тинь/i.test(nextLine) &&
      /сбер/i.test(nextLine)
    );
  });
}

export function parseAnnouncementText(rawText, referenceDate = new Date(), options = {}) {
  const lines = normalizeLines(rawText);

  if (!lines.length) {
    return null;
  }

  const hasPaymentBlock = hasRequiredPaymentBlock(lines);

  if ((options.requirePaymentBlock ?? true) && !hasPaymentBlock) {
    return null;
  }

  const dateIndex = lines.findIndex((line) => DATE_REGEX.test(line));
  const timeIndex = lines.findIndex((line) => TIME_REGEX.test(line));
  if (dateIndex < 0 || timeIndex < 0) return null;
  const headerEnd = Math.max(dateIndex, timeIndex);
  const playerLines = lines
    .map((line, index) => {
      if (index <= headerEnd) return null;
      const player = parsePlayerLine(line);
      return player ? { index, ...player } : null;
    })
    .filter(Boolean);

  const usernames = unique(playerLines.map((item) => item.username));
  const playerRefs = playerLines.filter(
    (item, index, collection) => collection.findIndex((candidate) => candidate.username === item.username) === index
  ).map((item) => ({
    username: item.username,
    displayName: item.displayName
  }));

  if (usernames.length < 5) {
    return null;
  }

  const firstPlayerIndex = playerLines[0].index;
  const lastPlayerIndex = playerLines[playerLines.length - 1].index;
  const headerLines = lines.slice(0, firstPlayerIndex);
  const footerLines = lines.slice(lastPlayerIndex + 1);

  let dateMatch = null;
  let timeMatch = null;

  for (const line of headerLines.length ? headerLines : lines) {
    if (!dateMatch) {
      const candidate = line.match(DATE_REGEX);
      if (candidate) {
        dateMatch = candidate;
      }
    }

    if (!timeMatch) {
      const candidate = line.match(TIME_REGEX);
      if (candidate) {
        timeMatch = candidate;
      }
    }
  }

  if (!dateMatch || !timeMatch) {
    return null;
  }

  const location = headerLines.map(locationFromHeader).find((line) =>
    line && !/^\d+$/.test(line) && !/^(?:\d+\s*(?:р\.?|руб\.?|₽)|https?:\/\/)/i.test(line)
  );
  if (!location) return null;

  const footerWithoutPlayers = footerLines.filter((line) => !parsePlayerLine(line));
  const priceLine = footerWithoutPlayers.find((line) => /\d/.test(line) && /(р|руб)/i.test(line)) ?? '';
  const paymentLines = footerWithoutPlayers.filter((line) => line !== priceLine);
  const monthIndex = MONTHS[dateMatch[3].toLowerCase()];
  const schedule = buildScheduledDate(Number(dateMatch[2]), monthIndex, timeMatch, referenceDate, dateMatch[4]);
  if (!schedule) return null;
  const { scheduledAt, date } = schedule;
  const key = [
    scheduledAt.toISOString().slice(0, 16),
    location.toLowerCase(),
    usernames.join(',')
  ].join('|');

  return {
    rawText: String(rawText ?? '').trim(),
    dateLabel: formatDateLabel(dateMatch),
    location,
    timeLabel: timeMatch[0],
    priceLine,
    paymentLines,
    hasPaymentBlock,
    playerUsernames: usernames,
    playerRefs,
    scheduledAt: scheduledAt.toISOString(),
    date,
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
