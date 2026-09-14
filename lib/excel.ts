export const excelColumns = [
  'Record Type',
  'Sprint ID',
  'Sprint Name',
  'Start Date',
  'End Date',
  'MD per SP',
  'Jira Display Name',
  'Leave Date',
  'Leave Units',
  'Story Points',
] as const;
export const timelineColumns = [
  'Timeline ID',
  'Timeline Title',
  'Epic URL',
  'Timeline Color',
] as const;
export const timelineOptionColumns = [
  'Timeline Type',
  'Timeline Repeat',
] as const;

export type SprintImport = {
  sprint: {
    id: number;
    name: string;
    startDate: string;
    endDate: string;
    mdPerStoryPoint: number;
  };
  members: {
    displayName: string;
    storyPoints: number;
    plannedMandays: number | null;
  }[];
  leaves: { displayName: string; date: string; units: number }[];
  timelineEvents: {
    id: number | null;
    title: string;
    epicUrl: string;
    startDate: string;
    endDate: string;
    color: string;
    kind: 'timeline' | 'release';
    recurrence: 'none' | 'fortnightly' | 'yearly';
  }[];
};

const value = (row: unknown[], header: string, indexes: Map<string, number>) =>
  row[indexes.get(header) ?? -1];
const cellText = (input: unknown) =>
  typeof input === 'string' ? input.trim() : '';
const requiredText = (input: unknown, label: string) => {
  const result = cellText(input);
  if (!result) throw new Error(`ไม่พบ ${label} ในไฟล์ Excel`);
  return result;
};
const limitedText = (input: unknown, label: string, max: number) => {
  const result = requiredText(input, label);
  if (result.length > max) throw new Error(`${label} ยาวเกิน ${max} ตัวอักษร`);
  return result;
};
const validDate = (input: unknown, label: string) => {
  const result =
    input instanceof Date
      ? input.toISOString().slice(0, 10)
      : requiredText(input, label);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(result) ||
    Number.isNaN(Date.parse(`${result}T00:00:00Z`))
  ) {
    throw new Error(`${label} ต้องเป็น YYYY-MM-DD`);
  }
  return result;
};
const validNumber = (input: unknown, label: string, allowZero = false) => {
  const result = Number(input);
  if (!Number.isFinite(result) || (allowZero ? result < 0 : result <= 0)) {
    throw new Error(`${label} ไม่ถูกต้อง`);
  }
  return result;
};
const validEpicUrl = (input: unknown) => {
  const result = limitedText(input, 'Epic URL', 500);
  let url: URL;
  try {
    url = new URL(result);
  } catch {
    throw new Error('Epic URL ไม่ถูกต้อง');
  }
  if (!['https:', 'http:'].includes(url.protocol)) {
    throw new Error('Epic URL ต้องเป็น http หรือ https');
  }
  return url.toString();
};

export function parseSprintSheet(rows: unknown[][]): SprintImport {
  if (rows.length < 2) throw new Error('ไฟล์ Excel ไม่มีข้อมูล Sprint');
  const headers = rows[0].map(cellText);
  const indexes = new Map(headers.map((header, index) => [header, index]));
  for (const column of excelColumns) {
    if (!indexes.has(column)) throw new Error(`ไม่พบคอลัมน์ ${column}`);
  }

  const dataRows = rows
    .slice(1)
    .filter((row) => row.some((cell) => cell !== null));
  const sprintRows = dataRows.filter(
    (row) => cellText(value(row, 'Record Type', indexes)) === 'SPRINT',
  );
  if (sprintRows.length !== 1) throw new Error('ต้องมีแถว SPRINT เพียง 1 แถว');

  const sprintRow = sprintRows[0];
  const sprint = {
    id: validNumber(value(sprintRow, 'Sprint ID', indexes), 'Sprint ID'),
    name: requiredText(value(sprintRow, 'Sprint Name', indexes), 'Sprint Name'),
    startDate: validDate(value(sprintRow, 'Start Date', indexes), 'Start Date'),
    endDate: validDate(value(sprintRow, 'End Date', indexes), 'End Date'),
    mdPerStoryPoint: validNumber(
      value(sprintRow, 'MD per SP', indexes),
      'MD per SP',
    ),
  };
  if (!Number.isInteger(sprint.id)) throw new Error('Sprint ID ไม่ถูกต้อง');
  if (sprint.endDate < sprint.startDate) {
    throw new Error('End Date ต้องเป็นวันเดียวกับหรือหลัง Start Date');
  }

  const members = dataRows
    .filter((row) => cellText(value(row, 'Record Type', indexes)) === 'MEMBER')
    .map((row) => ({
      displayName: requiredText(
        value(row, 'Jira Display Name', indexes),
        'Jira Display Name',
      ),
      storyPoints: validNumber(
        value(row, 'Story Points', indexes),
        'Story Points',
        true,
      ),
      plannedMandays: indexes.has('Planned MD')
        ? validNumber(value(row, 'Planned MD', indexes), 'Planned MD', true)
        : null,
    }));
  if (
    new Set(members.map((item) => item.displayName)).size !== members.length
  ) {
    throw new Error('Jira Display Name ในแถว MEMBER ซ้ำกัน');
  }

  const memberNames = new Set(members.map((item) => item.displayName));
  const leaves = dataRows
    .filter((row) => cellText(value(row, 'Record Type', indexes)) === 'LEAVE')
    .map((row) => {
      const displayName = requiredText(
        value(row, 'Jira Display Name', indexes),
        'Jira Display Name',
      );
      const leaveDate = validDate(
        value(row, 'Leave Date', indexes),
        'Leave Date',
      );
      const units = Number(value(row, 'Leave Units', indexes));
      if (!memberNames.has(displayName)) {
        throw new Error(`ไม่พบแถว MEMBER ของ ${displayName}`);
      }
      if (leaveDate < sprint.startDate || leaveDate > sprint.endDate) {
        throw new Error(`วันลาของ ${displayName} อยู่นอกช่วง Sprint`);
      }
      if (units !== 0.5 && units !== 1) {
        throw new Error('Leave Units ต้องเป็น 0.5 หรือ 1');
      }
      return { displayName, date: leaveDate, units };
    });
  const leaveKeys = leaves.map((item) => `${item.displayName}\0${item.date}`);
  if (new Set(leaveKeys).size !== leaveKeys.length) {
    throw new Error('วันลาของสมาชิกในวันเดียวกันซ้ำกัน');
  }

  const timelineRows = dataRows.filter(
    (row) => cellText(value(row, 'Record Type', indexes)) === 'TIMELINE',
  );
  if (timelineRows.length) {
    for (const column of timelineColumns) {
      if (!indexes.has(column)) throw new Error(`ไม่พบคอลัมน์ ${column}`);
    }
  }
  const timelineEvents = timelineRows.map((row) => {
    const rawId = value(row, 'Timeline ID', indexes);
    const eventId = rawId === null || rawId === '' ? null : Number(rawId);
    if (eventId !== null && (!Number.isInteger(eventId) || eventId < 1)) {
      throw new Error('Timeline ID ไม่ถูกต้อง');
    }
    const startDate = validDate(
      value(row, 'Start Date', indexes),
      'Timeline Start Date',
    );
    const endDate = validDate(
      value(row, 'End Date', indexes),
      'Timeline End Date',
    );
    if (endDate < startDate) {
      throw new Error('Timeline End Date ต้องเป็นวันเดียวกับหรือหลัง Start Date');
    }
    const color = requiredText(
      value(row, 'Timeline Color', indexes),
      'Timeline Color',
    );
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
      throw new Error('Timeline Color ต้องเป็นรหัสสีแบบ #2563EB');
    }
    const kindValue = cellText(value(row, 'Timeline Type', indexes));
    const kind = kindValue || 'timeline';
    if (kind !== 'timeline' && kind !== 'release') {
      throw new Error('Timeline Type ต้องเป็น timeline หรือ release');
    }
    const recurrenceValue = cellText(value(row, 'Timeline Repeat', indexes));
    const recurrence = recurrenceValue || 'none';
    if (!['none', 'fortnightly', 'yearly'].includes(recurrence)) {
      throw new Error('Timeline Repeat ต้องเป็น none, fortnightly หรือ yearly');
    }
    return {
      id: eventId,
      title: limitedText(
        value(row, 'Timeline Title', indexes),
        'Timeline Title',
        160,
      ),
      epicUrl:
        kind === 'release'
          ? cellText(value(row, 'Epic URL', indexes))
          : validEpicUrl(value(row, 'Epic URL', indexes)),
      startDate,
      endDate,
      color: color.toLowerCase(),
      kind: kind as 'timeline' | 'release',
      recurrence: recurrence as 'none' | 'fortnightly' | 'yearly',
    };
  });
  const timelineIds = timelineEvents.flatMap((item) =>
    item.id === null ? [] : [item.id],
  );
  if (new Set(timelineIds).size !== timelineIds.length) {
    throw new Error('Timeline ID ซ้ำกัน');
  }

  return { sprint, members, leaves, timelineEvents };
}
