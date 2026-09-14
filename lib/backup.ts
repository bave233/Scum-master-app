export const backupFormat = 'team-capacity-backup';

const collections = [
  'people',
  'sprints',
  'holidays',
  'leaves',
  'efforts',
  'timelineEvents',
] as const;

const record = (value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export function parseBackup(value: unknown) {
  const backup = record(value);
  if (
    !backup ||
    backup.format !== backupFormat ||
    backup.version !== 1 ||
    !record(backup.appSettings) ||
    !record(backup.jira)
  ) {
    throw new Error('ไฟล์ Backup ไม่ถูกต้องหรือเป็นคนละเวอร์ชัน');
  }

  const parsed = Object.fromEntries(
    collections.map((name) => {
      const rows = backup[name];
      if (
        !Array.isArray(rows) ||
        rows.length > 10_000 ||
        rows.some((row) => !record(row))
      ) {
        throw new Error(`ข้อมูล ${name} ใน Backup ไม่ถูกต้อง`);
      }
      return [name, rows as Record<string, unknown>[]];
    }),
  ) as Record<(typeof collections)[number], Record<string, unknown>[]>;
  if (
    Object.values(parsed).reduce((total, rows) => total + rows.length, 0) > 900
  ) {
    throw new Error('Backup มีข้อมูลมากเกิน 900 รายการ');
  }

  return {
    ...parsed,
    appSettings: record(backup.appSettings)!,
    jira: record(backup.jira)!,
  };
}
