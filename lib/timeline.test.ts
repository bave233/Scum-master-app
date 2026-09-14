import assert from 'node:assert/strict';
import test from 'node:test';
import {
  monthWeeks,
  moveTimelineEdge,
  nextPatchVersion,
  releaseVersionsForEvents,
  timelineEventsForYear,
  timelineSegments,
} from './timeline.ts';

void test('lays out overlapping timeline ranges as stacked week segments', () => {
  const week = monthWeeks(2026, 8)[1];
  const segments = timelineSegments(
    [
      {
        id: 1,
        title: 'Development',
        startDate: '2026-09-07',
        endDate: '2026-09-11',
      },
      { id: 2, title: 'QA', startDate: '2026-09-10', endDate: '2026-09-14' },
    ],
    week,
    '2026-09',
  );

  assert.deepEqual(
    segments.map(({ event, start, span }) => [event.title, start, span]),
    [
      ['Development', 2, 5],
      ['QA', 5, 3],
    ],
  );
});

void test('moves one release edge without crossing the other edge', () => {
  const event = {
    id: 1,
    title: 'Release cycle',
    startDate: '2026-01-06',
    endDate: '2026-01-13',
  };
  assert.equal(moveTimelineEdge(event, 'start', '2026-01-14'), null);
  assert.deepEqual(moveTimelineEdge(event, 'end', '2026-01-14'), {
    ...event,
    endDate: '2026-01-14',
  });
});

void test('repeats a fortnightly freeze and release cycle through the year', () => {
  const events = timelineEventsForYear(
    [
      {
        id: 1,
        title: 'Release cycle',
        startDate: '2026-01-06',
        endDate: '2026-01-13',
        recurrence: 'fortnightly' as const,
      },
    ],
    2027,
  );

  assert.deepEqual(
    events.slice(0, 2).map((event) => [event.startDate, event.endDate]),
    [
      ['2027-01-05', '2027-01-12'],
      ['2027-01-19', '2027-01-26'],
    ],
  );
});

void test('numbers releases from 2.66.0 and continues after an override', () => {
  const releases = [
    {
      id: 1,
      title: 'Release cycle',
      startDate: '2026-09-01',
      endDate: '2026-09-08',
    },
    {
      id: 2,
      title: 'Release cycle',
      startDate: '2026-09-15',
      endDate: '2026-09-22',
      releaseVersion: '2.66.1',
    },
    {
      id: 3,
      title: 'Release cycle',
      startDate: '2026-09-29',
      endDate: '2026-10-06',
    },
  ];

  assert.deepEqual(
    [
      ...releaseVersionsForEvents(releases, {
        anchorDate: '2026-09-08',
        anchorVersion: '2.66.0',
        cadenceDays: 14,
      }).values(),
    ],
    ['2.66.0', '2.66.1', '2.67.0'],
  );
  assert.equal(nextPatchVersion('2.66'), '2.66.1');
  assert.equal(nextPatchVersion('2.66.1'), '2.66.2');
});
