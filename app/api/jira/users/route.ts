import { env } from 'cloudflare:workers';
import { jiraAuthorization } from '@/lib/jira';

type JiraSettings = { baseUrl: string; email: string; apiToken: string };
type JiraUser = {
  accountId?: unknown;
  displayName?: unknown;
  avatarUrl?: unknown;
};

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams.get('query')?.trim() ?? '';
    if (query.length < 2 || query.length > 100) {
      return Response.json(
        { error: 'กรุณากรอกชื่ออย่างน้อย 2 ตัวอักษร' },
        { status: 400 },
      );
    }
    const settings = await env.DB.prepare(
      'SELECT base_url AS baseUrl, email, api_token AS apiToken FROM jira_settings WHERE id = 1',
    ).first<JiraSettings>();
    if (!settings) {
      return Response.json(
        { error: 'กรุณาตั้งค่า Jira ก่อนเพิ่มสมาชิก' },
        { status: 400 },
      );
    }

    const url = new URL('/rest/api/3/groupuserpicker', settings.baseUrl);
    url.searchParams.set('query', query);
    url.searchParams.set('maxResults', '20');
    url.searchParams.set('showAvatar', 'true');
    url.searchParams.set('caseInsensitive', 'true');
    url.searchParams.set('excludeConnectAddons', 'true');
    const response = await fetch(url, {
      headers: {
        Authorization: jiraAuthorization(settings.email, settings.apiToken),
        Accept: 'application/json',
      },
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(
        `Jira ตอบกลับ ${response.status}: ${detail.slice(0, 180)}`,
      );
    }
    const result = await response.json<{
      users?: { users?: JiraUser[] };
    }>();
    const users = (result.users?.users ?? []).flatMap((user) =>
      typeof user.accountId === 'string' && typeof user.displayName === 'string'
        ? [
            {
              accountId: user.accountId,
              displayName: user.displayName,
              avatarUrl:
                typeof user.avatarUrl === 'string' ? user.avatarUrl : undefined,
            },
          ]
        : [],
    );
    return Response.json({ users });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'ค้นหาสมาชิกไม่สำเร็จ' },
      { status: 502 },
    );
  }
}
