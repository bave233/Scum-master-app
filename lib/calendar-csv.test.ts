import assert from 'node:assert/strict';
import test from 'node:test';
import { parseProjectCalendarCsv } from './calendar-csv.ts';

void test('imports matching project rows and skips missing dates', () => {
  const csv = `PROJECT GANTT,,,,
#,Task Name,"Actual
Start Date","Actual
End Date"
DEV-1,"Build iOS app, phase 1",01/09/2026,05/09/2026
DEV-1,Android QA,06/09/2026,10/09/2026
DEV-2,Approval flow,01/09/2026,02/09/2026
DEV-3,Mobile API,01/09/2026,
`;

  assert.deepEqual(parseProjectCalendarCsv(csv), {
    events: [
      {
        sourceKey: 'project-csv:DEV-1:1',
        title: 'Build iOS app, phase 1',
        startDate: '2026-09-01',
        endDate: '2026-09-05',
        color: '#2563eb',
      },
      {
        sourceKey: 'project-csv:DEV-1:2',
        title: 'Android QA',
        startDate: '2026-09-06',
        endDate: '2026-09-10',
        color: '#2563eb',
      },
    ],
    matched: 3,
    skipped: 1,
  });
});
