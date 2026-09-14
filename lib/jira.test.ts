import assert from 'node:assert/strict';
import test from 'node:test';
import {
  jiraFieldId,
  jiraMandaysFromComment,
  jiraMandaysFromComments,
  jiraPersonKey,
  jiraSprintMatches,
  jiraSubtaskPlatform,
} from './jira.ts';

void test('matches renamed Jira users by stable accountId', () => {
  assert.equal(
    jiraPersonKey('New display name', 'abc-123'),
    jiraPersonKey('Old display name', 'abc-123'),
  );
  assert.notEqual(jiraPersonKey('Alice'), jiraPersonKey('Alicee'));
});

void test('resolves the Jira field display name to its API id', () => {
  const fields = [{ id: 'customfield_10028', name: 'Story_Points' }];
  assert.equal(jiraFieldId('Story_Points', fields), 'customfield_10028');
  assert.equal(jiraFieldId('story points', fields), 'customfield_10028');
});

void test('distinguishes same-named Jira sprints by their dates', () => {
  const sprint = [
    {
      startDate: '2026-08-31T04:16:05.873Z',
      endDate: '2026-09-11T11:38:30.000Z',
    },
  ];
  assert.equal(jiraSprintMatches(sprint, '2026-08-31', '2026-09-11'), true);
  assert.equal(jiraSprintMatches(sprint, '2026-08-24', '2026-09-06'), false);
});

void test('reads strict Manday comments from platform subtasks', () => {
  const comment = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'MD: 1.5' }] },
    ],
  };
  assert.equal(jiraMandaysFromComment(comment), 1.5);
  assert.equal(jiraMandaysFromComment({ text: 'MD:0.25' }), 0.25);
  assert.equal(jiraMandaysFromComment({ text: 'MD:2,5' }), 2.5);
  assert.equal(jiraMandaysFromComment({ text: 'Estimate 1.5' }), null);
  assert.equal(
    jiraMandaysFromComments([
      { body: { text: 'Build ready' } },
      { body: comment },
    ]),
    1.5,
  );
  assert.equal(jiraSubtaskPlatform('[IOS] Checkout'), 'iOS');
  assert.equal(jiraSubtaskPlatform('[FE][iOS] Checkout'), 'iOS');
  assert.equal(jiraSubtaskPlatform('[Dev][Android] Checkout'), 'Android');
  assert.equal(jiraSubtaskPlatform('[Andoird] Checkout'), 'Android');
  assert.equal(jiraSubtaskPlatform('[QA] Checkout'), 'QA');
  assert.equal(jiraSubtaskPlatform('Checkout'), null);
});
