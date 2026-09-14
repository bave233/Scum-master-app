import { env } from 'cloudflare:workers';
import { parseBackup } from '@/lib/backup';
import { datesBetween } from '@/lib/capacity';
import { parseSprintSheet } from '@/lib/excel';

const json = (body: unknown, status = 200) => Response.json(body, { status });
const appName = 'Scum Master App';
const ownerName = 'รัชชานนท์ อินทร์สุวรรณโณ';
const text = (value: unknown, name: string, max = 120) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new Error(`${name} ไม่ถูกต้อง`);
  }
  return value.trim();
};
const id = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1)
    throw new Error('รหัสข้อมูลไม่ถูกต้อง');
  return parsed;
};
const date = (value: unknown) => {
  const parsed = text(value, 'วันที่', 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(parsed) ||
    Number.isNaN(Date.parse(`${parsed}T00:00:00Z`))
  ) {
    throw new Error('วันที่ไม่ถูกต้อง');
  }
  return parsed;
};
const platform = (value: unknown) => {
  if (value !== 'iOS' && value !== 'Android' && value !== 'QA') {
    throw new Error('Platform ต้องเป็น iOS, Android หรือ QA');
  }
  return value;
};
const epicUrl = (value: unknown) => {
  if (value === '') return '';
  let parsed: URL;
  try {
    parsed = new URL(text(value, 'Epic link', 500));
  } catch {
    throw new Error('Epic link ไม่ถูกต้อง');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Epic link ต้องเป็น http หรือ https');
  }
  return parsed.toString();
};
const color = (value: unknown) => {
  const parsed = text(value, 'สี', 7).toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(parsed)) {
    throw new Error('สีต้องเป็นรหัสแบบ #2563EB');
  }
  return parsed;
};
const timelineKind = (value: unknown) => {
  if (value !== 'timeline' && value !== 'release' && value !== 'hotfix') {
    throw new Error('รูปแบบ Timeline ไม่ถูกต้อง');
  }
  return value;
};
const releaseVersion = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = text(value, 'เลขเวอร์ชัน', 20);
  if (!/^\d+\.\d+(?:\.\d+)?$/.test(parsed)) {
    throw new Error('เลขเวอร์ชันต้องเป็นรูปแบบ 2.67 หรือ 2.66.1');
  }
  const [major, minor, patch = '0'] = parsed.split('.');
  return `${Number(major)}.${Number(minor)}.${Number(patch)}`;
};
const optionalText = (value: unknown, name: string, max: number) => {
  if (typeof value !== 'string' || value.trim().length > max) {
    throw new Error(`${name} ไม่ถูกต้อง`);
  }
  return value.trim();
};
const importKeywords = (value: unknown) => {
  const parsed = text(value, 'Keyword สำหรับ Import', 300)
    .split(',')
    .map((keyword) => keyword.trim().toLowerCase())
    .filter(Boolean);
  if (
    !parsed.length ||
    parsed.some((keyword) => !/^[a-z0-9_-]+$/.test(keyword))
  ) {
    throw new Error('Keyword ต้องคั่นด้วย comma และใช้ตัวอักษรอังกฤษหรือตัวเลข');
  }
  return [...new Set(parsed)].join(',');
};
const finite = (value: unknown, name: string, minimum = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum) {
    throw new Error(`${name} ไม่ถูกต้อง`);
  }
  return parsed;
};
const appSettingsValues = (value: Record<string, unknown>) => {
  const cadenceDays = Number(value.releaseCadenceDays);
  if (!Number.isInteger(cadenceDays) || cadenceDays < 7 || cadenceDays > 90) {
    throw new Error('รอบ Release ต้องอยู่ระหว่าง 7–90 วัน');
  }
  const anchorVersion = releaseVersion(value.releaseAnchorVersion);
  if (!anchorVersion) throw new Error('กรุณากรอกเลขเวอร์ชันเริ่มต้น');
  return [
    appName,
    ownerName,
    date(value.releaseAnchorDate),
    anchorVersion,
    cadenceDays,
    importKeywords(value.importKeywords),
  ] as const;
};
const recurrence = (value: unknown) => {
  if (value !== 'none' && value !== 'fortnightly' && value !== 'yearly') {
    throw new Error('การทำซ้ำ Timeline ไม่ถูกต้อง');
  }
  return value;
};

export async function GET() {
  const [
    people,
    sprints,
    holidays,
    leaves,
    efforts,
    timelineEvents,
    settings,
    appSettings,
  ] = await Promise.all([
    env.DB.prepare(
      'SELECT id, display_name AS displayName, account_id AS accountId, platform FROM people ORDER BY display_name COLLATE NOCASE',
    ).all(),
    env.DB.prepare(
      'SELECT id, name, start_date AS startDate, end_date AS endDate, md_per_story_point AS mdPerStoryPoint FROM sprints ORDER BY start_date DESC',
    ).all(),
    env.DB.prepare(
      'SELECT id, date, name, source, active FROM holidays ORDER BY date DESC',
    ).all(),
    env.DB.prepare(
      'SELECT id, person_id AS personId, date, units FROM leaves ORDER BY date DESC',
    ).all(),
    env.DB.prepare(
      'SELECT person_id AS personId, sprint_id AS sprintId, story_points AS storyPoints, mandays, issue_count AS issueCount, issues_json AS issuesJson, synced_at AS syncedAt FROM jira_efforts',
    ).all(),
    env.DB.prepare(
      'SELECT id, source_key AS sourceKey, project_title AS projectTitle, title, epic_url AS epicUrl, start_date AS startDate, end_date AS endDate, color, kind, recurrence, release_version AS releaseVersion FROM timeline_events ORDER BY start_date, id',
    ).all(),
    env.DB.prepare(
      'SELECT base_url AS baseUrl, email, story_point_field AS storyPointField, length(api_token) > 0 AS configured FROM jira_settings WHERE id = 1',
    ).first(),
    env.DB.prepare(
      'SELECT app_name AS appName, owner_name AS ownerName, release_anchor_date AS releaseAnchorDate, release_anchor_version AS releaseAnchorVersion, release_cadence_days AS releaseCadenceDays, import_keywords AS importKeywords FROM app_settings WHERE id = 1',
    ).first(),
  ]);

  return json({
    people: people.results,
    sprints: sprints.results,
    holidays: holidays.results,
    leaves: leaves.results,
    efforts: efforts.results,
    timelineEvents: timelineEvents.results,
    appSettings: {
      ...(appSettings ?? {
        releaseAnchorDate: new Date().toISOString().slice(0, 10),
        releaseAnchorVersion: '1.0.0',
        releaseCadenceDays: 14,
        importKeywords: 'mobile,ios,android,app',
      }),
      appName,
      ownerName,
    },
    jira: settings ?? {
      baseUrl: '',
      email: '',
      storyPointField: 'Story_Points',
      configured: 0,
    },
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json<Record<string, unknown>>();

    switch (body.action) {
      case 'addPerson': {
        const displayName = text(body.displayName, 'ชื่อ Jira');
        const accountId = text(body.accountId, 'Jira account ID', 200);
        const memberPlatform = platform(body.platform);
        const matches = await env.DB.prepare(
          'SELECT id FROM people WHERE display_name = ? OR account_id = ?',
        )
          .bind(displayName, accountId)
          .all<{ id: number }>();
        if (matches.results.length > 1) {
          throw new Error(
            'ชื่อและ Jira account นี้ถูกใช้คนละรายการ กรุณาลบรายการเดิมก่อน',
          );
        }
        if (matches.results[0]) {
          await env.DB.prepare(
            'UPDATE people SET display_name = ?, account_id = ?, platform = ? WHERE id = ?',
          )
            .bind(displayName, accountId, memberPlatform, matches.results[0].id)
            .run();
        } else {
          await env.DB.prepare(
            'INSERT INTO people (display_name, account_id, platform) VALUES (?, ?, ?)',
          )
            .bind(displayName, accountId, memberPlatform)
            .run();
        }
        break;
      }
      case 'setPersonPlatform':
        await env.DB.prepare('UPDATE people SET platform = ? WHERE id = ?')
          .bind(platform(body.platform), id(body.id))
          .run();
        break;
      case 'deletePerson':
        await env.DB.prepare('DELETE FROM people WHERE id = ?')
          .bind(id(body.id))
          .run();
        break;
      case 'addSprint': {
        const startDate = date(body.startDate);
        const endDate = date(body.endDate);
        if (endDate < startDate)
          throw new Error('วันสิ้นสุดต้องเป็นวันเดียวกับหรือหลังวันเริ่มต้น');
        const rate = Number(body.mdPerStoryPoint);
        if (!(rate > 0 && rate <= 100))
          throw new Error('Manday ต่อ Story Point ต้องมากกว่า 0');
        await env.DB.prepare(
          'INSERT INTO sprints (name, start_date, end_date, md_per_story_point) VALUES (?, ?, ?, ?)',
        )
          .bind(text(body.name, 'ชื่อ Sprint'), startDate, endDate, rate)
          .run();
        break;
      }
      case 'deleteSprint':
        await env.DB.prepare('DELETE FROM sprints WHERE id = ?')
          .bind(id(body.id))
          .run();
        break;
      case 'addHoliday': {
        const holidayDate = date(body.date);
        const existing = await env.DB.prepare(
          'SELECT name FROM holidays WHERE date = ?',
        )
          .bind(holidayDate)
          .first<{ name: string }>();
        if (existing) {
          throw new Error(`วันที่นี้มีวันหยุดอยู่แล้ว: ${existing.name}`);
        }
        await env.DB.prepare(
          "INSERT INTO holidays (date, name, source, active) VALUES (?, ?, 'manual', 1)",
        )
          .bind(holidayDate, text(body.name, 'ชื่อวันหยุด'))
          .run();
        break;
      }
      case 'toggleHoliday':
        await env.DB.prepare('UPDATE holidays SET active = ? WHERE id = ?')
          .bind(body.active ? 1 : 0, id(body.id))
          .run();
        break;
      case 'deleteHoliday':
        await env.DB.prepare('DELETE FROM holidays WHERE id = ?')
          .bind(id(body.id))
          .run();
        break;
      case 'addLeave': {
        const personId = id(body.personId);
        const sprintId = id(body.sprintId);
        const startDate = date(body.startDate);
        const endDate = date(body.endDate);
        if (endDate < startDate)
          throw new Error('วันสิ้นสุดต้องเป็นวันเดียวกับหรือหลังวันเริ่มต้น');
        const units = Number(body.units);
        if (units !== 0.5 && units !== 1)
          throw new Error('วันลาต้องเป็นครึ่งวันหรือเต็มวัน');
        const sprint = await env.DB.prepare(
          'SELECT start_date AS startDate, end_date AS endDate FROM sprints WHERE id = ?',
        )
          .bind(sprintId)
          .first<{ startDate: string; endDate: string }>();
        if (!sprint) throw new Error('ไม่พบ Sprint');
        if (startDate < sprint.startDate || endDate > sprint.endDate)
          throw new Error('ช่วงวันลาต้องอยู่ภายใน Sprint');

        const duplicates = await env.DB.prepare(
          'SELECT date FROM leaves WHERE person_id = ? AND date BETWEEN ? AND ? ORDER BY date',
        )
          .bind(personId, startDate, endDate)
          .all<{ date: string }>();
        if (duplicates.results.length) {
          throw new Error(
            `มีวันลาซ้ำแล้ว: ${duplicates.results.map((leave) => leave.date).join(', ')}`,
          );
        }

        await env.DB.batch(
          datesBetween(startDate, endDate).map((leaveDate) =>
            env.DB.prepare(
              'INSERT INTO leaves (person_id, date, units) VALUES (?, ?, ?)',
            ).bind(personId, leaveDate, units),
          ),
        );
        break;
      }
      case 'deleteLeave':
        await env.DB.prepare('DELETE FROM leaves WHERE id = ?')
          .bind(id(body.id))
          .run();
        break;
      case 'addTimeline':
      case 'updateTimeline': {
        const startDate = date(body.startDate);
        const endDate = date(body.endDate);
        if (endDate < startDate) {
          throw new Error('วันสิ้นสุดต้องเป็นวันเดียวกับหรือหลังวันเริ่มต้น');
        }
        const kind = timelineKind(body.kind);
        const values = [
          text(body.title, 'ชื่อช่วงงาน', 160),
          kind === 'timeline' ? epicUrl(body.epicUrl) : '',
          startDate,
          endDate,
          color(body.color),
          kind,
          recurrence(body.recurrence),
          kind === 'timeline' ? null : releaseVersion(body.releaseVersion),
        ];
        if (body.action === 'updateTimeline') {
          await env.DB.prepare(
            'UPDATE timeline_events SET title = ?, epic_url = ?, start_date = ?, end_date = ?, color = ?, kind = ?, recurrence = ?, release_version = ? WHERE id = ?',
          )
            .bind(...values, id(body.id))
            .run();
        } else {
          await env.DB.prepare(
            'INSERT INTO timeline_events (title, epic_url, start_date, end_date, color, kind, recurrence, release_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          )
            .bind(...values)
            .run();
        }
        break;
      }
      case 'deleteTimeline':
        await env.DB.prepare('DELETE FROM timeline_events WHERE id = ?')
          .bind(id(body.id))
          .run();
        break;
      case 'deleteTimelineProject':
        await env.DB.prepare(
          'DELETE FROM timeline_events WHERE project_title = ?',
        )
          .bind(text(body.projectTitle, 'ชื่อโปรเจกต์', 120))
          .run();
        break;
      case 'importCalendarCsv': {
        if (
          !Array.isArray(body.events) ||
          body.events.length < 1 ||
          body.events.length > 500
        ) {
          throw new Error('ข้อมูล Calendar จาก CSV ไม่ถูกต้อง');
        }
        const projectTitle = text(body.projectTitle, 'ชื่อโปรเจกต์', 120);
        const projectKey = projectTitle.toLocaleLowerCase();
        const events = body.events.map((raw) => {
          if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            throw new Error('ข้อมูล Calendar จาก CSV ไม่ถูกต้อง');
          }
          const event = raw as Record<string, unknown>;
          const startDate = date(event.startDate);
          const endDate = date(event.endDate);
          if (endDate < startDate) throw new Error('ช่วงวันที่ใน CSV ไม่ถูกต้อง');
          return {
            sourceKey: text(event.sourceKey, 'รหัสแถว CSV', 120),
            title: text(event.title, 'Task Name', 240),
            startDate,
            endDate,
            color: color(event.color),
          };
        });
        const statements = [
          env.DB.prepare(`
            UPDATE timeline_events
            SET source_key = ? || source_key, project_title = ?
            WHERE project_title IS NULL
              AND source_key IN (${events.map(() => '?').join(', ')})
          `).bind(
            `${projectKey}:`,
            projectTitle,
            ...events.map((event) => event.sourceKey),
          ),
          ...events.map((event) =>
            env.DB.prepare(`
              INSERT INTO timeline_events
                (source_key, project_title, title, epic_url, start_date, end_date, color, kind, recurrence)
              VALUES (?, ?, ?, '', ?, ?, ?, 'timeline', 'none')
              ON CONFLICT(source_key) DO UPDATE SET
                project_title = excluded.project_title,
                title = excluded.title,
                start_date = excluded.start_date,
                end_date = excluded.end_date,
                color = excluded.color
            `).bind(
              `${projectKey}:${event.sourceKey}`,
              projectTitle,
              event.title,
              event.startDate,
              event.endDate,
              event.color,
            ),
          ),
        ];
        await env.DB.batch(statements);
        break;
      }
      case 'saveReleaseYear': {
        const year = Number(body.year);
        if (!Number.isInteger(year) || year < 2000 || year > 2100) {
          throw new Error('ปีไม่ถูกต้อง');
        }
        if (
          !Array.isArray(body.events) ||
          body.events.length < 1 ||
          body.events.length > 40
        ) {
          throw new Error('ข้อมูลรอบ Release ไม่ถูกต้อง');
        }
        const yearStart = `${year}-01-01`;
        const yearEnd = `${year}-12-31`;
        const releaseEvents = body.events.map((raw) => {
          if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            throw new Error('ข้อมูลรอบ Release ไม่ถูกต้อง');
          }
          const event = raw as Record<string, unknown>;
          const startDate = date(event.startDate);
          const endDate = date(event.endDate);
          if (
            endDate < startDate ||
            endDate < yearStart ||
            startDate > yearEnd
          ) {
            throw new Error('ช่วง Freeze และ Release ไม่ถูกต้อง');
          }
          return {
            startDate,
            endDate,
            releaseVersion: releaseVersion(event.releaseVersion),
          };
        });
        const rows = releaseEvents
          .map(
            () =>
              "('Release cycle', '', ?, ?, '#94a3b8', 'release', 'none', ?)",
          )
          .join(', ');
        await env.DB.batch([
          env.DB.prepare(
            "DELETE FROM timeline_events WHERE kind = 'release' AND recurrence = 'none' AND end_date >= ? AND start_date <= ?",
          ).bind(yearStart, yearEnd),
          env.DB.prepare(`
              INSERT INTO timeline_events
                (title, epic_url, start_date, end_date, color, kind, recurrence, release_version)
              VALUES ${rows}
            `).bind(
            ...releaseEvents.flatMap((event) => [
              event.startDate,
              event.endDate,
              event.releaseVersion,
            ]),
          ),
        ]);
        break;
      }
      case 'replaceSprint': {
        if (
          !Array.isArray(body.rows) ||
          !body.rows.every((row) => Array.isArray(row))
        ) {
          throw new Error('ข้อมูล Excel ไม่ถูกต้อง');
        }
        const imported = parseSprintSheet(body.rows as unknown[][]);
        const existing = await env.DB.prepare(
          'SELECT start_date AS startDate, end_date AS endDate FROM sprints WHERE id = ?',
        )
          .bind(imported.sprint.id)
          .first<{ startDate: string; endDate: string }>();
        if (!existing) throw new Error('ไม่พบ Sprint ID นี้ในแอป');

        if (imported.members.length) {
          await env.DB.batch(
            imported.members.map((member) =>
              env.DB.prepare(
                'INSERT INTO people (display_name) VALUES (?) ON CONFLICT(display_name) DO NOTHING',
              ).bind(member.displayName),
            ),
          );
        }
        const people = await env.DB.prepare(
          'SELECT id, display_name AS displayName FROM people',
        ).all<{ id: number; displayName: string }>();
        const peopleByName = new Map(
          people.results.map((person) => [person.displayName, person.id]),
        );
        const memberIds = imported.members.map((member) =>
          peopleByName.get(member.displayName)!,
        );
        const statements = [
          env.DB.prepare(
            'UPDATE sprints SET name = ?, start_date = ?, end_date = ?, md_per_story_point = ? WHERE id = ?',
          ).bind(
            imported.sprint.name,
            imported.sprint.startDate,
            imported.sprint.endDate,
            imported.sprint.mdPerStoryPoint,
            imported.sprint.id,
          ),
          env.DB.prepare('DELETE FROM jira_efforts WHERE sprint_id = ?').bind(
            imported.sprint.id,
          ),
        ];
        if (memberIds.length) {
          statements.push(
            env.DB.prepare(
              `DELETE FROM leaves WHERE person_id IN (${memberIds.map(() => '?').join(',')}) AND ((date BETWEEN ? AND ?) OR (date BETWEEN ? AND ?))`,
            ).bind(
              ...memberIds,
              existing.startDate,
              existing.endDate,
              imported.sprint.startDate,
              imported.sprint.endDate,
            ),
          );
        }
        const syncedAt = new Date().toISOString();
        for (const member of imported.members) {
          statements.push(
            env.DB.prepare(
              "INSERT INTO jira_efforts (person_id, sprint_id, story_points, mandays, issue_count, issues_json, synced_at) VALUES (?, ?, ?, ?, 0, '[]', ?)",
            ).bind(
              peopleByName.get(member.displayName),
              imported.sprint.id,
              member.storyPoints,
              member.plannedMandays ??
                member.storyPoints * imported.sprint.mdPerStoryPoint,
              syncedAt,
            ),
          );
        }
        for (const leave of imported.leaves) {
          statements.push(
            env.DB.prepare(
              'INSERT INTO leaves (person_id, date, units) VALUES (?, ?, ?)',
            ).bind(
              peopleByName.get(leave.displayName),
              leave.date,
              leave.units,
            ),
          );
        }
        for (const event of imported.timelineEvents) {
          if (event.id) {
            statements.push(
              env.DB.prepare(`
                INSERT INTO timeline_events (id, title, epic_url, start_date, end_date, color, kind, recurrence)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  title = excluded.title,
                  epic_url = excluded.epic_url,
                  start_date = excluded.start_date,
                  end_date = excluded.end_date,
                  color = excluded.color,
                  kind = excluded.kind,
                  recurrence = excluded.recurrence
              `).bind(
                event.id,
                event.title,
                event.epicUrl,
                event.startDate,
                event.endDate,
                event.color,
                event.kind,
                event.recurrence,
              ),
            );
          } else {
            statements.push(
              env.DB.prepare(`
                INSERT INTO timeline_events (title, epic_url, start_date, end_date, color, kind, recurrence)
                SELECT ?, ?, ?, ?, ?, ?, ?
                WHERE NOT EXISTS (
                  SELECT 1 FROM timeline_events
                  WHERE title = ? AND epic_url = ? AND start_date = ? AND end_date = ? AND kind = ? AND recurrence = ?
                )
              `).bind(
                event.title,
                event.epicUrl,
                event.startDate,
                event.endDate,
                event.color,
                event.kind,
                event.recurrence,
                event.title,
                event.epicUrl,
                event.startDate,
                event.endDate,
                event.kind,
                event.recurrence,
              ),
            );
          }
        }
        await env.DB.batch(statements);
        break;
      }
      case 'saveJira': {
        const baseUrl = new URL(text(body.baseUrl, 'Jira URL', 300));
        if (baseUrl.protocol !== 'https:')
          throw new Error('Jira URL ต้องเป็น https');
        const current = await env.DB.prepare(
          'SELECT api_token AS apiToken FROM jira_settings WHERE id = 1',
        ).first<{ apiToken: string }>();
        const apiToken =
          typeof body.apiToken === 'string' && body.apiToken.trim()
            ? body.apiToken.trim()
            : current?.apiToken;
        if (!apiToken) throw new Error('กรุณากรอก Jira API token');
        await env.DB.prepare(`
          INSERT INTO jira_settings (id, base_url, email, api_token, story_point_field)
          VALUES (1, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            base_url = excluded.base_url,
            email = excluded.email,
            api_token = excluded.api_token,
            story_point_field = excluded.story_point_field
        `)
          .bind(
            baseUrl.origin,
            text(body.email, 'Jira email', 200),
            apiToken,
            text(body.storyPointField, 'Story Point field', 80),
          )
          .run();
        break;
      }
      case 'saveAppSettings': {
        await env.DB.prepare(`
          INSERT INTO app_settings
            (id, app_name, owner_name, release_anchor_date, release_anchor_version, release_cadence_days, import_keywords)
          VALUES (1, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            app_name = excluded.app_name,
            owner_name = excluded.owner_name,
            release_anchor_date = excluded.release_anchor_date,
            release_anchor_version = excluded.release_anchor_version,
            release_cadence_days = excluded.release_cadence_days,
            import_keywords = excluded.import_keywords
        `)
          .bind(...appSettingsValues(body))
          .run();
        break;
      }
      case 'restoreBackup': {
        const backup = parseBackup(body.backup);
        const statements = [
          env.DB.prepare('DELETE FROM jira_efforts'),
          env.DB.prepare('DELETE FROM leaves'),
          env.DB.prepare('DELETE FROM timeline_events'),
          env.DB.prepare('DELETE FROM holidays'),
          env.DB.prepare('DELETE FROM sprints'),
          env.DB.prepare('DELETE FROM people'),
          env.DB.prepare('DELETE FROM jira_settings'),
          env.DB.prepare('DELETE FROM app_settings'),
          env.DB.prepare(`
            INSERT INTO app_settings
              (id, app_name, owner_name, release_anchor_date, release_anchor_version, release_cadence_days, import_keywords)
            VALUES (1, ?, ?, ?, ?, ?, ?)
          `).bind(...appSettingsValues(backup.appSettings)),
        ];

        for (const row of backup.people) {
          statements.push(
            env.DB.prepare(
              'INSERT INTO people (id, display_name, account_id, platform) VALUES (?, ?, ?, ?)',
            ).bind(
              id(row.id),
              text(row.displayName, 'ชื่อสมาชิก', 120),
              row.accountId == null
                ? null
                : optionalText(row.accountId, 'Jira account ID', 200),
              row.platform == null ? null : platform(row.platform),
            ),
          );
        }
        for (const row of backup.sprints) {
          const startDate = date(row.startDate);
          const endDate = date(row.endDate);
          if (endDate < startDate)
            throw new Error('ช่วง Sprint ใน Backup ไม่ถูกต้อง');
          statements.push(
            env.DB.prepare(
              'INSERT INTO sprints (id, name, start_date, end_date, md_per_story_point) VALUES (?, ?, ?, ?, ?)',
            ).bind(
              id(row.id),
              text(row.name, 'ชื่อ Sprint', 120),
              startDate,
              endDate,
              finite(row.mdPerStoryPoint, 'Manday ต่อ Story Point', 0.01),
            ),
          );
        }
        for (const row of backup.holidays) {
          if (row.source !== 'manual' && row.source !== 'th-public') {
            throw new Error('ประเภทวันหยุดใน Backup ไม่ถูกต้อง');
          }
          statements.push(
            env.DB.prepare(
              'INSERT INTO holidays (id, date, name, source, active) VALUES (?, ?, ?, ?, ?)',
            ).bind(
              id(row.id),
              date(row.date),
              text(row.name, 'ชื่อวันหยุด', 200),
              row.source,
              row.active ? 1 : 0,
            ),
          );
        }
        for (const row of backup.leaves) {
          const units = finite(row.units, 'จำนวนวันลา');
          if (units !== 0.5 && units !== 1)
            throw new Error('วันลาใน Backup ไม่ถูกต้อง');
          statements.push(
            env.DB.prepare(
              'INSERT INTO leaves (id, person_id, date, units) VALUES (?, ?, ?, ?)',
            ).bind(id(row.id), id(row.personId), date(row.date), units),
          );
        }
        for (const row of backup.efforts) {
          const issuesJson = text(
            row.issuesJson,
            'รายละเอียด Jira effort',
            1_000_000,
          );
          if (!Array.isArray(JSON.parse(issuesJson))) {
            throw new Error('รายละเอียด Jira effort ใน Backup ไม่ถูกต้อง');
          }
          statements.push(
            env.DB.prepare(`
              INSERT INTO jira_efforts
                (person_id, sprint_id, story_points, mandays, issue_count, issues_json, synced_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `).bind(
              id(row.personId),
              id(row.sprintId),
              finite(row.storyPoints, 'Story Point'),
              row.mandays == null ? null : finite(row.mandays, 'Manday'),
              Math.trunc(finite(row.issueCount, 'จำนวน Jira')),
              issuesJson,
              text(row.syncedAt, 'เวลา Sync Jira', 50),
            ),
          );
        }
        for (const row of backup.timelineEvents) {
          const kind = timelineKind(row.kind);
          const startDate = date(row.startDate);
          const endDate = date(row.endDate);
          if (endDate < startDate)
            throw new Error('Timeline ใน Backup ไม่ถูกต้อง');
          statements.push(
            env.DB.prepare(`
              INSERT INTO timeline_events
                (id, source_key, project_title, title, epic_url, start_date, end_date, color, kind, recurrence, release_version)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(
              id(row.id),
              row.sourceKey == null
                ? null
                : optionalText(row.sourceKey, 'Source key', 200),
              row.projectTitle == null
                ? null
                : optionalText(row.projectTitle, 'ชื่อโปรเจกต์', 120),
              text(row.title, 'ชื่อ Timeline', 240),
              kind === 'timeline' ? epicUrl(row.epicUrl) : '',
              startDate,
              endDate,
              color(row.color),
              kind,
              recurrence(row.recurrence),
              kind === 'timeline' ? null : releaseVersion(row.releaseVersion),
            ),
          );
        }

        const jiraUrl = optionalText(backup.jira.baseUrl, 'Jira URL', 300);
        if (jiraUrl) {
          const parsedUrl = new URL(jiraUrl);
          if (parsedUrl.protocol !== 'https:')
            throw new Error('Jira URL ต้องเป็น https');
          statements.push(
            env.DB.prepare(`
              INSERT INTO jira_settings (id, base_url, email, api_token, story_point_field)
              VALUES (1, ?, ?, '', ?)
            `).bind(
              parsedUrl.origin,
              text(backup.jira.email, 'Jira email', 200),
              text(backup.jira.storyPointField, 'Story Point field', 80),
            ),
          );
        }
        await env.DB.batch(statements);
        break;
      }
      case 'resetAllData':
        await env.DB.batch([
          env.DB.prepare('DELETE FROM jira_efforts'),
          env.DB.prepare('DELETE FROM leaves'),
          env.DB.prepare('DELETE FROM timeline_events'),
          env.DB.prepare('DELETE FROM holidays'),
          env.DB.prepare('DELETE FROM sprints'),
          env.DB.prepare('DELETE FROM people'),
          env.DB.prepare('DELETE FROM jira_settings'),
          env.DB.prepare('DELETE FROM app_settings'),
          env.DB.prepare(`
            INSERT INTO app_settings
              (id, app_name, owner_name, release_anchor_date, release_anchor_version, release_cadence_days, import_keywords)
            VALUES (1, ?, ?, date('now'), '1.0.0', 14, 'mobile,ios,android,app')
          `).bind(appName, ownerName),
        ]);
        break;
      default:
        return json({ error: 'ไม่รู้จักคำสั่งนี้' }, 400);
    }

    return json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'บันทึกข้อมูลไม่สำเร็จ';
    const friendly = message.includes('UNIQUE constraint failed')
      ? 'มีข้อมูลนี้อยู่แล้ว'
      : message;
    return json({ error: friendly }, 400);
  }
}
