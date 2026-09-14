export type TimelineRange = {
  id: number;
  title: string;
  startDate: string;
  endDate: string;
};

export type RepeatableTimelineRange = TimelineRange & {
  recurrence?: 'none' | 'fortnightly' | 'yearly';
};

export type VersionedReleaseRange = TimelineRange & {
  releaseVersion?: string | null;
};

export type ReleaseVersionConfig = {
  anchorDate: string;
  anchorVersion: string;
  cadenceDays: number;
};

const iso = (date: Date) => date.toISOString().slice(0, 10);

const versionParts = (version: string) => {
  const parts = version.split('.').map(Number);
  return { major: parts[0], minor: parts[1], patch: parts[2] ?? 0 };
};

export function nextPatchVersion(version: string) {
  const parts = versionParts(version);
  return `${parts.major}.${parts.minor}.${parts.patch + 1}`;
}

export function releaseVersionsForEvents<T extends VersionedReleaseRange>(
  events: T[],
  config: ReleaseVersionConfig,
) {
  const anchor = versionParts(config.anchorVersion);
  let previous: ReturnType<typeof versionParts> | null = null;
  return new Map(
    [...events]
      .sort((left, right) => left.endDate.localeCompare(right.endDate))
      .map((event) => {
        previous = event.releaseVersion
          ? versionParts(event.releaseVersion)
          : previous
            ? { ...previous, minor: previous.minor + 1, patch: 0 }
            : {
                major: anchor.major,
                minor:
                  anchor.minor +
                  Math.round(
                    (Date.parse(`${event.endDate}T00:00:00Z`) -
                      Date.parse(`${config.anchorDate}T00:00:00Z`)) /
                      (config.cadenceDays * 86_400_000),
                  ),
                patch: anchor.patch,
              };
        return [
          event.endDate,
          `${previous.major}.${previous.minor}.${previous.patch}`,
        ] as const;
      }),
  );
}

export function monthWeeks(year: number, month: number) {
  const first = new Date(Date.UTC(year, month, 1));
  const last = new Date(Date.UTC(year, month + 1, 0));
  const start = new Date(first);
  const end = new Date(last);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  end.setUTCDate(end.getUTCDate() + 6 - end.getUTCDay());

  const dates: string[] = [];
  for (
    const cursor = new Date(start);
    cursor <= end;
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    dates.push(iso(cursor));
  }
  return Array.from({ length: dates.length / 7 }, (_, index) =>
    dates.slice(index * 7, index * 7 + 7),
  );
}

export function timelineEventsForYear<T extends RepeatableTimelineRange>(
  events: T[],
  year: number,
  cadenceDays = 14,
) {
  const yearStart = Date.UTC(year, 0, 1);
  const yearEnd = Date.UTC(year, 11, 31);
  const day = 86_400_000;
  const occurrence = (event: T, start: number, end: number): T => ({
    ...event,
    startDate: iso(new Date(start)),
    endDate: iso(new Date(end)),
  });

  return events.flatMap((event) => {
    if (event.recurrence === 'yearly') {
      const startPart = event.startDate.slice(5);
      const endPart = event.endDate.slice(5);
      const currentStart = Date.parse(`${year}-${startPart}T00:00:00Z`);
      const currentEnd = Date.parse(
        `${endPart < startPart ? year + 1 : year}-${endPart}T00:00:00Z`,
      );
      const current = occurrence(event, currentStart, currentEnd);
      return endPart < startPart
        ? [
            occurrence(
              event,
              Date.parse(`${year - 1}-${startPart}T00:00:00Z`),
              Date.parse(`${year}-${endPart}T00:00:00Z`),
            ),
            current,
          ]
        : [current];
    }
    if (event.recurrence !== 'fortnightly') return [event];

    const baseStart = Date.parse(`${event.startDate}T00:00:00Z`);
    const duration = Date.parse(`${event.endDate}T00:00:00Z`) - baseStart;
    const step = cadenceDays * day;
    let start = baseStart + Math.floor((yearStart - baseStart) / step) * step;
    while (start + duration < yearStart) start += step;
    const repeated: T[] = [];
    while (start <= yearEnd) {
      repeated.push(occurrence(event, start, start + duration));
      start += step;
    }
    return repeated;
  });
}

export function moveTimelineEdge<T extends TimelineRange>(
  event: T,
  edge: 'start' | 'end',
  date: string,
) {
  const moved = {
    ...event,
    startDate: edge === 'start' ? date : event.startDate,
    endDate: edge === 'end' ? date : event.endDate,
  };
  return moved.endDate < moved.startDate ? null : moved;
}

export function timelineSegments<T extends TimelineRange>(
  events: T[],
  week: string[],
  monthPrefix: string,
) {
  const visible = week.filter((date) => date.startsWith(monthPrefix));
  const first = visible[0];
  const last = visible.at(-1);
  if (!first || !last) return [];

  return events
    .filter((event) => event.endDate >= first && event.startDate <= last)
    .sort(
      (left, right) =>
        left.startDate.localeCompare(right.startDate) ||
        left.title.localeCompare(right.title),
    )
    .map((event) => {
      const startDate = event.startDate < first ? first : event.startDate;
      const endDate = event.endDate > last ? last : event.endDate;
      const start = week.indexOf(startDate) + 1;
      return {
        event,
        start,
        span: week.indexOf(endDate) - start + 2,
      };
    });
}
