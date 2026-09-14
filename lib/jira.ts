export function jiraAuthorization(email: string, token: string) {
  const bytes = new TextEncoder().encode(`${email}:${token}`);
  return `Basic ${btoa(String.fromCharCode(...bytes))}`;
}

export function jiraPersonKey(displayName: string, accountId?: string | null) {
  return accountId ? `id:${accountId}` : `name:${displayName}`;
}

export function jiraFieldId(
  configured: string,
  fields: { id: string; name: string }[],
) {
  const normalize = (value: string) =>
    value.toLowerCase().replace(/[\s_-]+/g, '');
  const field = fields.find(
    ({ id, name }) =>
      id === configured || normalize(name) === normalize(configured),
  );
  if (!field) throw new Error(`ไม่พบ Jira field: ${configured}`);
  return field.id;
}

export function jiraSprintMatches(
  value: unknown,
  startDate: string,
  endDate: string,
) {
  return (
    Array.isArray(value) &&
    value.some((sprint) => {
      if (!sprint || typeof sprint !== 'object') return false;
      const dates = sprint as { startDate?: string; endDate?: string };
      return (
        dates.startDate?.slice(0, 10) === startDate &&
        dates.endDate?.slice(0, 10) === endDate
      );
    })
  );
}

export function jiraSubtaskPlatform(summary: string) {
  const platform = /^\s*(?:\[[^\]]+\]\s*)*?\[(ios|android|andoird|qa)\]/i.exec(
    summary,
  )?.[1];
  if (!platform) return null;
  if (platform.toLowerCase() === 'ios') return 'iOS';
  if (platform.toLowerCase() === 'qa') return 'QA';
  return 'Android';
}

export function jiraMandaysFromComment(body: unknown) {
  const text = (node: unknown): string => {
    if (!node || typeof node !== 'object') return '';
    const value = node as { text?: unknown; content?: unknown };
    return [
      typeof value.text === 'string' ? value.text : '',
      ...(Array.isArray(value.content) ? value.content.map(text) : []),
    ].join('');
  };
  const match = /^MD\s*:\s*(\d+(?:[.,]\d+)?)\s*$/i.exec(text(body).trim());
  if (!match) return null;
  const mandays = Number(match[1].replace(',', '.'));
  return Number.isFinite(mandays) ? mandays : null;
}

export function jiraMandaysFromComments(comments: { body?: unknown }[]) {
  return (
    comments
      .map((comment) => jiraMandaysFromComment(comment.body))
      .find((mandays) => mandays !== null) ?? null
  );
}
