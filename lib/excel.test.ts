import assert from 'node:assert/strict';
import test from 'node:test';
import { excelColumns, parseSprintSheet, timelineColumns } from './excel.ts';

void test('parses a custom sprint range and rejects reversed dates', () => {
  const rows = [
    [...excelColumns],
    ['SPRINT', 7, 'Sprint 7', '2026-09-07', '2026-09-19', 0.5],
    [
      'MEMBER',
      7,
      'Sprint 7',
      '2026-09-07',
      '2026-09-20',
      0.5,
      'Alice',
      null,
      null,
      8,
    ],
    [
      'LEAVE',
      7,
      'Sprint 7',
      '2026-09-07',
      '2026-09-20',
      0.5,
      'Alice',
      '2026-09-11',
      0.5,
      null,
    ],
  ];

  assert.deepEqual(parseSprintSheet(rows).leaves, [
    { displayName: 'Alice', date: '2026-09-11', units: 0.5 },
  ]);
  rows[1][4] = '2026-09-06';
  assert.throws(() => parseSprintSheet(rows), /หลัง Start Date/);
});

void test('parses timeline rows from an exported sprint workbook', () => {
  const rows = [
    [...excelColumns, ...timelineColumns],
    [
      'SPRINT',
      7,
      'Sprint 7',
      '2026-09-07',
      '2026-09-19',
      1,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ],
    [
      'TIMELINE',
      null,
      null,
      '2026-09-10',
      '2026-09-18',
      null,
      null,
      null,
      null,
      null,
      3,
      'Checkout QA',
      'https://example.atlassian.net/browse/EPIC-3',
      '#2563EB',
    ],
  ];

  assert.deepEqual(parseSprintSheet(rows).timelineEvents, [
    {
      id: 3,
      title: 'Checkout QA',
      epicUrl: 'https://example.atlassian.net/browse/EPIC-3',
      startDate: '2026-09-10',
      endDate: '2026-09-18',
      color: '#2563eb',
      kind: 'timeline',
      recurrence: 'none',
    },
  ]);
});
