import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const people = sqliteTable(
  'people',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    displayName: text('display_name').notNull(),
    accountId: text('account_id'),
    platform: text('platform'),
  },
  (table) => [
    uniqueIndex('idx_people_display_name').on(table.displayName),
    uniqueIndex('idx_people_account_id').on(table.accountId),
  ],
);

export const sprints = sqliteTable(
  'sprints',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    startDate: text('start_date').notNull(),
    endDate: text('end_date').notNull(),
    mdPerStoryPoint: real('md_per_story_point').notNull().default(1),
  },
  (table) => [uniqueIndex('idx_sprints_name').on(table.name)],
);

export const holidays = sqliteTable(
  'holidays',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    date: text('date').notNull(),
    name: text('name').notNull(),
    source: text('source').notNull().default('manual'),
    active: integer('active').notNull().default(1),
  },
  (table) => [uniqueIndex('idx_holidays_date').on(table.date)],
);

export const leaves = sqliteTable(
  'leaves',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    personId: integer('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    units: real('units').notNull(),
  },
  (table) => [
    uniqueIndex('idx_leaves_person_date').on(table.personId, table.date),
    index('idx_leaves_date').on(table.date),
  ],
);

export const jiraSettings = sqliteTable('jira_settings', {
  id: integer('id').primaryKey(),
  baseUrl: text('base_url').notNull(),
  email: text('email').notNull(),
  apiToken: text('api_token').notNull(),
  storyPointField: text('story_point_field')
    .notNull()
    .default('customfield_10016'),
});

export const jiraEfforts = sqliteTable(
  'jira_efforts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    personId: integer('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    sprintId: integer('sprint_id')
      .notNull()
      .references(() => sprints.id, { onDelete: 'cascade' }),
    storyPoints: real('story_points').notNull().default(0),
    mandays: real('mandays'),
    issueCount: integer('issue_count').notNull().default(0),
    issuesJson: text('issues_json').notNull().default('[]'),
    syncedAt: text('synced_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_jira_efforts_person_sprint').on(
      table.personId,
      table.sprintId,
    ),
  ],
);

export const timelineEvents = sqliteTable('timeline_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sourceKey: text('source_key').unique(),
  projectTitle: text('project_title'),
  title: text('title').notNull(),
  epicUrl: text('epic_url').notNull(),
  startDate: text('start_date').notNull(),
  endDate: text('end_date').notNull(),
  color: text('color').notNull().default('#2563eb'),
  kind: text('kind').notNull().default('timeline'),
  recurrence: text('recurrence').notNull().default('none'),
  releaseVersion: text('release_version'),
});

export const appSettings = sqliteTable('app_settings', {
  id: integer('id').primaryKey(),
  appName: text('app_name').notNull(),
  ownerName: text('owner_name').notNull(),
  releaseAnchorDate: text('release_anchor_date').notNull(),
  releaseAnchorVersion: text('release_anchor_version').notNull(),
  releaseCadenceDays: integer('release_cadence_days').notNull().default(14),
  importKeywords: text('import_keywords').notNull(),
});
