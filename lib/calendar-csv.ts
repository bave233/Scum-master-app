export type ImportedCalendarEvent = {
  sourceKey: string;
  title: string;
  startDate: string;
  endDate: string;
  color: string;
};

const csvRows = (value: string) => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '"') {
      if (quoted && value[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && value[index + 1] === '\n') index += 1;
      row.push(cell);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }
  row.push(cell);
  if (row.some(Boolean)) rows.push(row);
  return rows;
};

const headerName = (value: string) => value.replaceAll(/\s+/g, ' ').trim();
const isoDate = (value: string) => {
  const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  const result = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  const parsed = new Date(`${result}T00:00:00Z`);
  return parsed.getUTCFullYear() === Number(year) &&
    parsed.getUTCMonth() + 1 === Number(month) &&
    parsed.getUTCDate() === Number(day)
    ? result
    : null;
};

export const decodeCsv = (buffer: ArrayBuffer) => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
};

export function parseProjectCalendarCsv(
  value: string,
  keywords = ['mobile', 'ios', 'android', 'app'],
) {
  const projectKeyword = new RegExp(
    `\\b(?:${keywords
      .map((keyword) => keyword.replaceAll(/[^a-z0-9_-]/gi, ''))
      .filter(Boolean)
      .join('|')})\\b`,
    'i',
  );
  const rows = csvRows(value);
  const headerIndex = rows.findIndex((row) =>
    row.some((cell) => headerName(cell) === 'Task Name'),
  );
  if (headerIndex < 0) throw new Error('ไม่พบคอลัมน์ Task Name ใน CSV');

  const headers = rows[headerIndex].map(headerName);
  const indexes = {
    id: headers.indexOf('#'),
    title: headers.indexOf('Task Name'),
    start: headers.indexOf('Actual Start Date'),
    end: headers.indexOf('Actual End Date'),
  };
  if (indexes.title < 0 || indexes.start < 0 || indexes.end < 0) {
    throw new Error(
      'CSV ต้องมี Task Name, Actual Start Date และ Actual End Date',
    );
  }

  let matched = 0;
  const occurrences = new Map<string, number>();
  const events: ImportedCalendarEvent[] = [];
  for (const [offset, row] of rows.slice(headerIndex + 1).entries()) {
    const rowId = row[indexes.id]?.trim();
    const occurrence = rowId ? (occurrences.get(rowId) ?? 0) + 1 : 0;
    if (rowId) occurrences.set(rowId, occurrence);

    const title = row[indexes.title]?.trim();
    if (!title || !projectKeyword.test(title)) continue;
    matched += 1;
    const startDate = isoDate(row[indexes.start] ?? '');
    const endDate = isoDate(row[indexes.end] ?? '');
    if (!startDate || !endDate || endDate < startDate) continue;
    events.push({
      sourceKey: rowId
        ? `project-csv:${rowId}:${occurrence}`
        : `project-csv:row:${headerIndex + offset + 2}`,
      title,
      startDate,
      endDate,
      color: '#2563eb',
    });
  }

  return { events, matched, skipped: matched - events.length };
}
