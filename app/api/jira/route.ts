import { env } from 'cloudflare:workers';
import {
  jiraAuthorization,
  jiraFieldId,
  jiraMandaysFromComments,
  jiraPersonKey,
  jiraSprintMatches,
  jiraSubtaskPlatform,
} from '@/lib/jira';

type JiraSettings = {
  baseUrl: string;
  email: string;
  apiToken: string;
  storyPointField: string;
};

type JiraIssue = {
  key: string;
  fields: Record<string, unknown> & {
    summary?: string;
    assignee?: { accountId?: string; displayName?: string } | null;
    status?: { name?: string } | null;
    issuetype?: { subtask?: boolean } | null;
    parent?: { key?: string } | null;
  };
};

type CachedIssue = {
  key: string;
  summary: string;
  status: string;
  storyPoints: number;
  mandays: number | null;
};

function safeJql(value: string) {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

async function searchJira(
  settings: JiraSettings,
  sprint: { name: string; startDate: string; endDate: string },
) {
  const headers = {
    Authorization: jiraAuthorization(settings.email, settings.apiToken),
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  const fieldResponse = await fetch(`${settings.baseUrl}/rest/api/3/field`, {
    headers,
  });
  if (!fieldResponse.ok)
    throw new Error(`อ่าน Jira fields ไม่สำเร็จ (${fieldResponse.status})`);
  const fieldCatalog =
    await fieldResponse.json<{ id: string; name: string }[]>();
  const storyPointFieldId = jiraFieldId(settings.storyPointField, fieldCatalog);
  const sprintFieldId = jiraFieldId('Sprint', fieldCatalog);
  const jql = `sprint = "${safeJql(sprint.name)}"`;
  const fields = [
    'summary',
    'assignee',
    'status',
    'issuetype',
    'parent',
    storyPointFieldId,
    sprintFieldId,
  ];
  const issues: JiraIssue[] = [];
  let nextPageToken: string | undefined;

  do {
    const response = await fetch(`${settings.baseUrl}/rest/api/3/search/jql`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jql, fields, maxResults: 100, nextPageToken }),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(
        `Jira ตอบกลับ ${response.status}: ${detail.slice(0, 180)}`,
      );
    }
    const page = await response.json<{
      issues?: JiraIssue[];
      nextPageToken?: string;
    }>();
    issues.push(...(page.issues ?? []));
    nextPageToken = page.nextPageToken;
  } while (nextPageToken);

  const matchingParents = new Set(
    issues
      .filter(
        (issue) =>
          !issue.fields.issuetype?.subtask &&
          jiraSprintMatches(
            issue.fields[sprintFieldId],
            sprint.startDate,
            sprint.endDate,
          ),
      )
      .map((issue) => issue.key),
  );
  return {
    issues: issues.filter(
      (issue) =>
        jiraSprintMatches(
          issue.fields[sprintFieldId],
          sprint.startDate,
          sprint.endDate,
        ) ||
        (issue.fields.issuetype?.subtask &&
          matchingParents.has(issue.fields.parent?.key ?? '')),
    ),
    storyPointFieldId,
    headers,
  };
}

async function latestCommentMandays(
  settings: JiraSettings,
  headers: Record<string, string>,
  issueKey: string,
) {
  const response = await fetch(
    `${settings.baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment?maxResults=100&orderBy=-created`,
    { headers },
  );
  if (!response.ok) {
    throw new Error(`อ่าน Comment ของ ${issueKey} ไม่สำเร็จ (${response.status})`);
  }
  const page = await response.json<{ comments?: { body?: unknown }[] }>();
  return jiraMandaysFromComments(page.comments ?? []);
}

export async function POST(request: Request) {
  try {
    const { sprintId } = await request.json<{ sprintId?: number }>();
    if (!Number.isInteger(sprintId) || Number(sprintId) < 1) {
      return Response.json({ error: 'กรุณาเลือก Sprint' }, { status: 400 });
    }

    const [settings, sprint, people] = await Promise.all([
      env.DB.prepare(
        'SELECT base_url AS baseUrl, email, api_token AS apiToken, story_point_field AS storyPointField FROM jira_settings WHERE id = 1',
      ).first<JiraSettings>(),
      env.DB.prepare(
        'SELECT id, name, start_date AS startDate, end_date AS endDate FROM sprints WHERE id = ?',
      )
        .bind(sprintId)
        .first<{
          id: number;
          name: string;
          startDate: string;
          endDate: string;
        }>(),
      env.DB.prepare(
        'SELECT id, display_name AS displayName, account_id AS accountId FROM people',
      ).all<{
        id: number;
        displayName: string;
        accountId: string | null;
      }>(),
    ]);

    if (!settings)
      return Response.json(
        { error: 'กรุณาตั้งค่า Jira ก่อน Sync' },
        { status: 400 },
      );
    if (!sprint)
      return Response.json({ error: 'ไม่พบ Sprint' }, { status: 404 });

    const { issues, storyPointFieldId, headers } = await searchJira(
      settings,
      sprint,
    );
    const platformIssues = issues.filter((issue) =>
      jiraSubtaskPlatform(String(issue.fields.summary ?? '')),
    );
    const mandaysByIssue = new Map(
      await Promise.all(
        platformIssues.map(
          async (issue) =>
            [
              issue.key,
              await latestCommentMandays(settings, headers, issue.key),
            ] as const,
        ),
      ),
    );
    const byPerson = new Map<string, CachedIssue[]>();

    for (const issue of platformIssues) {
      const name = issue.fields.assignee?.displayName;
      if (!name) continue;
      const storyPoints = Number(issue.fields[storyPointFieldId] ?? 0);
      const cached = {
        key: issue.key,
        summary: String(issue.fields.summary ?? ''),
        status: String(issue.fields.status?.name ?? ''),
        storyPoints: Number.isFinite(storyPoints) ? storyPoints : 0,
        mandays: mandaysByIssue.get(issue.key) ?? null,
      };
      for (const key of new Set([
        jiraPersonKey(name, issue.fields.assignee?.accountId),
        jiraPersonKey(name),
      ])) {
        byPerson.set(key, [...(byPerson.get(key) ?? []), cached]);
      }
    }

    const syncedAt = new Date().toISOString();
    const trackedIssues = people.results.flatMap(
      (person) =>
        byPerson.get(jiraPersonKey(person.displayName, person.accountId)) ?? [],
    );
    const statements = people.results.map((person) => {
      const assigned =
        byPerson.get(jiraPersonKey(person.displayName, person.accountId)) ?? [];
      const storyPoints = assigned.reduce(
        (sum, issue) => sum + issue.storyPoints,
        0,
      );
      const mandays = assigned.reduce(
        (sum, issue) => sum + (issue.mandays ?? 0),
        0,
      );
      return env.DB.prepare(`
        INSERT INTO jira_efforts (person_id, sprint_id, story_points, mandays, issue_count, issues_json, synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(person_id, sprint_id) DO UPDATE SET
          story_points = excluded.story_points,
          mandays = excluded.mandays,
          issue_count = excluded.issue_count,
          issues_json = excluded.issues_json,
          synced_at = excluded.synced_at
      `).bind(
        person.id,
        sprint.id,
        storyPoints,
        mandays,
        assigned.length,
        JSON.stringify(assigned),
        syncedAt,
      );
    });
    if (statements.length) await env.DB.batch(statements);

    const unlinked = people.results
      .filter((person) => !person.accountId)
      .map((person) => person.displayName);
    const missingMandays = trackedIssues
      .filter((issue) => mandaysByIssue.get(issue.key) === null)
      .map((issue) => issue.key);
    return Response.json({
      ok: true,
      issueCount: trackedIssues.length,
      unlinked,
      missingMandays,
      syncedAt,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Sync Jira ไม่สำเร็จ' },
      { status: 502 },
    );
  }
}
