import assert from 'node:assert/strict';
import test from 'node:test';
import { backupFormat, parseBackup } from './backup.ts';

void test('accepts one complete backup and rejects an unknown format', () => {
  const backup = {
    format: backupFormat,
    version: 1,
    appSettings: {},
    jira: {},
    people: [],
    sprints: [],
    holidays: [],
    leaves: [],
    efforts: [],
    timelineEvents: [],
  };

  assert.equal(parseBackup(backup).people.length, 0);
  assert.throws(() => parseBackup({ ...backup, format: 'other' }));
});
