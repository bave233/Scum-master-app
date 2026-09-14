import assert from 'node:assert/strict';
import test from 'node:test';
import { addDays, capacityFor, datesBetween } from './capacity.ts';

void test('custom sprint range excludes weekends, holidays and half-day leave', () => {
  const result = capacityFor(
    { startDate: '2026-09-07', endDate: '2026-09-16' },
    ['2026-09-14'],
    [
      { date: '2026-09-15', units: 0.5 },
      { date: '2026-09-19', units: 1 },
    ],
    5,
  );

  assert.equal(addDays('2026-09-07', 13), '2026-09-20');
  assert.deepEqual(datesBetween('2026-09-07', '2026-09-09'), [
    '2026-09-07',
    '2026-09-08',
    '2026-09-09',
  ]);
  assert.deepEqual(result, {
    workdays: 7,
    leaveDays: 0.5,
    availableMandays: 6.5,
    plannedMandays: 5,
    remainingMandays: 1.5,
    utilization: 76.92307692307693,
  });
});
