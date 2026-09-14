'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import Image from 'next/image';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CloudOff,
  Download,
  ExternalLink,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Trash2,
  Upload,
  Users,
} from 'lucide-react';
import { readSheet } from 'read-excel-file/browser';
import writeXlsxFile, { type SheetData } from 'write-excel-file/browser';
import { backupFormat } from '@/lib/backup';
import { addDays, capacityFor } from '@/lib/capacity';
import { decodeCsv, parseProjectCalendarCsv } from '@/lib/calendar-csv';
import {
  excelColumns,
  parseSprintSheet,
  timelineColumns,
  timelineOptionColumns,
} from '@/lib/excel';
import {
  monthWeeks,
  moveTimelineEdge,
  nextPatchVersion,
  releaseVersionsForEvents,
  timelineEventsForYear,
  timelineSegments,
} from '@/lib/timeline';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Toaster, toast } from '@/components/ui/toast';

const platforms = ['iOS', 'Android', 'QA'] as const;
type Platform = (typeof platforms)[number];
type Person = {
  id: number;
  displayName: string;
  accountId: string | null;
  platform: Platform | null;
};
type JiraUser = { accountId: string; displayName: string };
type Sprint = {
  id: number;
  name: string;
  startDate: string;
  endDate: string;
  mdPerStoryPoint: number;
};
type Holiday = {
  id: number;
  date: string;
  name: string;
  source: 'manual' | 'th-public';
  active: number;
};
type Leave = { id: number; personId: number; date: string; units: number };
type Issue = {
  key: string;
  summary: string;
  status: string;
  storyPoints: number;
  mandays?: number | null;
};
type Effort = {
  personId: number;
  sprintId: number;
  storyPoints: number;
  mandays: number | null;
  issueCount: number;
  issuesJson: string;
  syncedAt: string;
};
type AppSettings = {
  appName: string;
  ownerName: string;
  releaseAnchorDate: string;
  releaseAnchorVersion: string;
  releaseCadenceDays: number;
  importKeywords: string;
};
type TimelineEvent = {
  id: number;
  sourceKey?: string | null;
  projectTitle?: string | null;
  title: string;
  epicUrl: string;
  startDate: string;
  endDate: string;
  color: string;
  kind: 'timeline' | 'release' | 'hotfix';
  recurrence: 'none' | 'fortnightly' | 'yearly';
  releaseVersion?: string | null;
};
type SprintRange = Sprint & { title: string };
type AppData = {
  people: Person[];
  sprints: Sprint[];
  holidays: Holiday[];
  leaves: Leave[];
  efforts: Effort[];
  timelineEvents: TimelineEvent[];
  appSettings: AppSettings;
  jira: {
    baseUrl: string;
    email: string;
    storyPointField: string;
    configured: number;
  };
};
type Modal =
  | 'person'
  | 'sprint'
  | 'leave'
  | 'holiday'
  | 'jira'
  | 'timeline'
  | 'timelineImport'
  | 'settings'
  | 'issues'
  | null;
type DeleteTarget = {
  action: string;
  id?: number;
  projectTitle?: string;
  label: string;
} | null;
type PendingImport = {
  rows: unknown[][];
  sprint: { id: number; name: string };
  memberCount: number;
  leaveCount: number;
  timelineCount: number;
} | null;

const thaiDate = new Intl.DateTimeFormat('th-TH', {
  day: 'numeric',
  month: 'short',
  year: '2-digit',
});
const formatDate = (date: string) =>
  thaiDate.format(new Date(`${date}T00:00:00Z`));
const number = (value: number) =>
  value.toLocaleString('th-TH', { maximumFractionDigits: 2 });
const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const formValue = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === 'string' ? value : '';
};
const parseIssues = (effort?: Effort): Issue[] => {
  try {
    return effort ? JSON.parse(effort.issuesJson) : [];
  } catch {
    return [];
  }
};

export default function Home() {
  const [data, setData] = useState<AppData | null>(null);
  const [selectedSprintId, setSelectedSprintId] = useState<number | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [issuePersonId, setIssuePersonId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<DeleteTarget>(null);
  const [pendingImport, setPendingImport] = useState<PendingImport>(null);
  const [personQuery, setPersonQuery] = useState('');
  const [jiraUsers, setJiraUsers] = useState<JiraUser[]>([]);
  const [searchedPeople, setSearchedPeople] = useState(false);
  const [searchingPeople, setSearchingPeople] = useState(false);
  const [personPlatform, setPersonPlatform] = useState<Platform>('iOS');
  const [platformFilter, setPlatformFilter] = useState<'all' | Platform>('all');
  const [timelineYear, setTimelineYear] = useState(new Date().getFullYear());
  const [editingTimeline, setEditingTimeline] = useState<TimelineEvent | null>(
    null,
  );
  const [editingReleaseEvents, setEditingReleaseEvents] = useState<
    TimelineEvent[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(true);
  const sprintImportInput = useRef<HTMLInputElement>(null);
  const backupInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const response = await fetch('/api/data');
    if (!response.ok) throw new Error('โหลดข้อมูลไม่สำเร็จ');
    const fresh = await response.json<AppData>();
    setData(fresh);
    setSelectedSprintId((current) =>
      current && fresh.sprints.some((item) => item.id === current)
        ? current
        : (fresh.sprints[0]?.id ?? null),
    );
  }, []);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    const initialCheck = window.setTimeout(update, 0);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    // oxlint-disable-next-line react/react-compiler -- initial client data load
    load().catch((error: Error) =>
      toast.add({
        title: 'เปิดข้อมูลไม่ได้',
        description: error.message,
        type: 'error',
      }),
    );
    return () => {
      window.clearTimeout(initialCheck);
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, [load]);

  const sprint = data?.sprints.find((item) => item.id === selectedSprintId);
  const holidayYearKey = [
    ...new Set([
      String(timelineYear),
      ...(sprint
        ? [sprint.startDate.slice(0, 4), sprint.endDate.slice(0, 4)]
        : []),
    ]),
  ].join(',');
  const requestThaiHolidays = useCallback(
    async (years: number[]) => {
      const responses = await Promise.all(
        years.map((year) =>
          fetch('/api/holidays', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ year }),
          }),
        ),
      );
      const failed = responses.find((response) => !response.ok);
      if (failed) {
        const result = await failed.json<{ error?: string }>();
        throw new Error(result.error ?? 'อัปเดตวันหยุดไทยไม่สำเร็จ');
      }
      await load();
    },
    [load],
  );

  useEffect(() => {
    if (online && holidayYearKey) {
      // oxlint-disable-next-line react/react-compiler -- async public-holiday sync
      void requestThaiHolidays(holidayYearKey.split(',').map(Number)).catch(
        () => undefined,
      );
    }
  }, [holidayYearKey, online, requestThaiHolidays]);

  async function syncThaiHolidays() {
    if (!holidayYearKey) return;
    setBusy(true);
    try {
      await requestThaiHolidays(holidayYearKey.split(',').map(Number));
      toast.add({ title: 'อัปเดตวันหยุดไทยแล้ว', type: 'success' });
    } catch (error) {
      toast.add({
        title: 'ใช้วันหยุดที่บันทึกไว้ต่อไป',
        description: error instanceof Error ? error.message : '',
        type: 'warning',
      });
    } finally {
      setBusy(false);
    }
  }

  const holidayDates = useMemo(
    () =>
      data?.holidays
        .filter((holiday) => holiday.active)
        .map((holiday) => holiday.date) ?? [],
    [data?.holidays],
  );
  const rows = useMemo(() => {
    if (!data || !sprint) return [];
    return data.people.map((person) => {
      const leaves = data.leaves.filter(
        (leave) => leave.personId === person.id,
      );
      const effort = data.efforts.find(
        (item) => item.personId === person.id && item.sprintId === sprint.id,
      );
      return {
        person,
        effort,
        capacity: capacityFor(
          sprint,
          holidayDates,
          leaves,
          effort?.mandays ?? 0,
        ),
      };
    });
  }, [data, holidayDates, sprint]);
  const sprintRanges = useMemo(
    () =>
      data?.sprints.map(
        (item): SprintRange => ({ ...item, title: item.name }),
      ) ?? [],
    [data?.sprints],
  );
  const visibleRows = useMemo(
    () =>
      platformFilter === 'all'
        ? rows
        : rows.filter((row) => row.person.platform === platformFilter),
    [platformFilter, rows],
  );
  const platformCapacities = platforms.map((platform) => {
    const members = rows.filter((row) => row.person.platform === platform);
    return {
      platform,
      people: members.length,
      capacity: members.reduce(
        (sum, row) => sum + row.capacity.availableMandays,
        0,
      ),
      storyPoints: members.reduce(
        (sum, row) => sum + (row.effort?.storyPoints ?? 0),
        0,
      ),
      planned: members.reduce(
        (sum, row) => sum + row.capacity.plannedMandays,
        0,
      ),
      issues: members.reduce(
        (sum, row) => sum + (row.effort?.issueCount ?? 0),
        0,
      ),
      remaining: members.reduce(
        (sum, row) => sum + row.capacity.remainingMandays,
        0,
      ),
      leaves: members.reduce((sum, row) => sum + row.capacity.leaveDays, 0),
    };
  });
  const platformSummary = platformCapacities.reduce(
    (sum, item) => ({
      people: sum.people + item.people,
      capacity: sum.capacity + item.capacity,
      storyPoints: sum.storyPoints + item.storyPoints,
      planned: sum.planned + item.planned,
      issues: sum.issues + item.issues,
      remaining: sum.remaining + item.remaining,
      leaves: sum.leaves + item.leaves,
    }),
    {
      people: 0,
      capacity: 0,
      storyPoints: 0,
      planned: 0,
      issues: 0,
      remaining: 0,
      leaves: 0,
    },
  );

  const totals = visibleRows.reduce(
    (sum, row) => ({
      capacity: sum.capacity + row.capacity.availableMandays,
      storyPoints: sum.storyPoints + (row.effort?.storyPoints ?? 0),
      planned: sum.planned + row.capacity.plannedMandays,
      issues: sum.issues + (row.effort?.issueCount ?? 0),
      remaining: sum.remaining + row.capacity.remainingMandays,
      leaves: sum.leaves + row.capacity.leaveDays,
    }),
    {
      capacity: 0,
      storyPoints: 0,
      planned: 0,
      issues: 0,
      remaining: 0,
      leaves: 0,
    },
  );
  const lastSync = visibleRows
    .map((row) => row.effort?.syncedAt)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => left.localeCompare(right))
    .at(-1);
  const selectedIssues = parseIssues(
    data?.efforts.find(
      (effort) =>
        effort.personId === issuePersonId &&
        effort.sprintId === selectedSprintId,
    ),
  );
  const selectedPerson = data?.people.find(
    (person) => person.id === issuePersonId,
  );

  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool || !sprint) return;
    const lifecycle = new AbortController();
    void Promise.resolve(
      context.registerTool(
        {
          name: 'read_current_sprint_capacity',
          title: 'Read current sprint capacity',
          description:
            'Read the visible sprint capacity summary and each team member workload without changing data.',
          inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true, untrustedContentHint: false },
          execute: (input) => {
            if (
              typeof input !== 'object' ||
              input === null ||
              Array.isArray(input) ||
              Object.keys(input).length
            ) {
              throw new Error('Input must be an empty object');
            }
            return {
              sprint: sprint.name,
              startDate: sprint.startDate,
              endDate: sprint.endDate,
              capacityMandays: totals.capacity,
              storyPoints: totals.storyPoints,
              jiraMandays: totals.planned,
              remainingMandays: totals.remaining,
              platform: platformFilter,
              members: visibleRows.map((row) => ({
                displayName: row.person.displayName,
                availableMandays: row.capacity.availableMandays,
                storyPoints: row.effort?.storyPoints ?? 0,
                jiraMandays: row.capacity.plannedMandays,
                remainingMandays: row.capacity.remainingMandays,
              })),
            };
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => undefined);
    return () => lifecycle.abort();
  }, [
    platformFilter,
    sprint,
    totals.capacity,
    totals.remaining,
    totals.storyPoints,
    totals.planned,
    visibleRows,
  ]);

  async function mutate(
    action: string,
    values: Record<string, unknown>,
    success: string,
  ) {
    setBusy(true);
    try {
      const response = await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...values }),
      });
      const result = await response.json<{ error?: string }>();
      if (!response.ok) throw new Error(result.error ?? 'บันทึกไม่สำเร็จ');
      await load();
      setModal(null);
      setDeleting(null);
      toast.add({ title: success, type: 'success' });
      return true;
    } catch (error) {
      toast.add({
        title: 'ทำรายการไม่สำเร็จ',
        description: error instanceof Error ? error.message : '',
        type: 'error',
      });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function syncJira() {
    if (!sprint) return;
    setBusy(true);
    try {
      const response = await fetch('/api/jira', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sprintId: sprint.id }),
      });
      const result = await response.json<{
        error?: string;
        issueCount?: number;
        unlinked?: string[];
        missingMandays?: string[];
      }>();
      if (!response.ok) throw new Error(result.error ?? 'Sync ไม่สำเร็จ');
      await load();
      const notes = [
        result.unlinked?.length
          ? `ยังจับคู่ด้วยชื่อ: ${result.unlinked.join(', ')}`
          : '',
        result.missingMandays?.length
          ? `ไม่พบ Comment MD: ตัวเลข — ${result.missingMandays.join(', ')}`
          : '',
      ].filter(Boolean);
      toast.add({
        title: `Sync Jira แล้ว ${result.issueCount ?? 0} งาน`,
        description: notes.join(' · ') || undefined,
        type: 'success',
      });
    } catch (error) {
      toast.add({
        title: 'ใช้ข้อมูล Jira ล่าสุดต่อไป',
        description: error instanceof Error ? error.message : 'เชื่อมต่อไม่ได้',
        type: 'warning',
      });
    } finally {
      setBusy(false);
    }
  }

  async function searchJiraPeople() {
    const query = personQuery.trim();
    if (query.length < 2) return;
    setSearchingPeople(true);
    setSearchedPeople(true);
    try {
      const response = await fetch(
        `/api/jira/users?query=${encodeURIComponent(query)}`,
      );
      const result = await response.json<{
        users?: JiraUser[];
        error?: string;
      }>();
      if (!response.ok) throw new Error(result.error ?? 'ค้นหาไม่สำเร็จ');
      setJiraUsers(result.users ?? []);
    } catch (error) {
      setJiraUsers([]);
      toast.add({
        title: 'ค้นหาสมาชิกใน Jira ไม่สำเร็จ',
        description: error instanceof Error ? error.message : '',
        type: 'error',
      });
    } finally {
      setSearchingPeople(false);
    }
  }

  function openPersonModal() {
    setPersonPlatform(platformFilter === 'all' ? 'iOS' : platformFilter);
    setJiraUsers([]);
    setSearchedPeople(false);
    setModal('person');
  }

  function openTimelineModal(
    event?: TimelineEvent,
    releaseEvents: TimelineEvent[] = [],
  ) {
    setEditingTimeline(event ?? null);
    setEditingReleaseEvents(releaseEvents);
    setModal('timeline');
  }

  function openHotfixModal(date: string, releaseVersion: string) {
    openTimelineModal({
      id: 0,
      title: 'Hotfix',
      epicUrl: '',
      startDate: date,
      endDate: date,
      color: '#f59e0b',
      kind: 'hotfix',
      recurrence: 'none',
      releaseVersion,
    });
  }

  async function exportExcel() {
    if (!sprint) return;
    try {
      const columns = [
        ...excelColumns,
        ...timelineColumns,
        ...timelineOptionColumns,
        'Available MD',
        'Planned MD',
        'Remaining MD',
      ];
      const row = (values: Record<string, string | number | null>) =>
        columns.map((column) => values[column] ?? null);
      const header = columns.map((column) => ({
        value: column,
        fontWeight: 'bold' as const,
        backgroundColor: '#DFFF7B',
      }));
      const workbook: SheetData = [
        header,
        row({
          'Record Type': 'SPRINT',
          'Sprint ID': sprint.id,
          'Sprint Name': sprint.name,
          'Start Date': sprint.startDate,
          'End Date': sprint.endDate,
          'MD per SP': sprint.mdPerStoryPoint,
        }),
        ...rows.map((item) =>
          row({
            'Record Type': 'MEMBER',
            'Sprint ID': sprint.id,
            'Sprint Name': sprint.name,
            'Start Date': sprint.startDate,
            'End Date': sprint.endDate,
            'MD per SP': sprint.mdPerStoryPoint,
            'Jira Display Name': item.person.displayName,
            'Story Points': item.effort?.storyPoints ?? 0,
            'Available MD': item.capacity.availableMandays,
            'Planned MD': item.capacity.plannedMandays,
            'Remaining MD': item.capacity.remainingMandays,
          }),
        ),
        ...data!.leaves
          .filter(
            (leave) =>
              leave.date >= sprint.startDate && leave.date <= sprint.endDate,
          )
          .map((leave) =>
            row({
              'Record Type': 'LEAVE',
              'Sprint ID': sprint.id,
              'Sprint Name': sprint.name,
              'Start Date': sprint.startDate,
              'End Date': sprint.endDate,
              'MD per SP': sprint.mdPerStoryPoint,
              'Jira Display Name':
                data!.people.find((person) => person.id === leave.personId)
                  ?.displayName ?? '',
              'Leave Date': leave.date,
              'Leave Units': leave.units,
            }),
          ),
        ...data!.timelineEvents.map((event) =>
          row({
            'Record Type': 'TIMELINE',
            'Start Date': event.startDate,
            'End Date': event.endDate,
            'Timeline ID': event.id,
            'Timeline Title': event.title,
            'Epic URL': event.epicUrl,
            'Timeline Color': event.color,
            'Timeline Type': event.kind,
            'Timeline Repeat': event.recurrence,
          }),
        ),
      ];
      await writeXlsxFile(workbook, {
        sheet: 'Sprint',
        stickyRowsCount: 1,
        columns: columns.map((column) => ({
          width: Math.max(14, column.length + 2),
        })),
      }).toFile(
        `${sprint.name.replaceAll(/[^a-zA-Z0-9ก-๙_-]/g, '_')}-capacity.xlsx`,
      );
    } catch (error) {
      toast.add({
        title: 'Export Excel ไม่สำเร็จ',
        description: error instanceof Error ? error.message : '',
        type: 'error',
      });
    }
  }

  async function chooseImport(
    file: File | undefined,
    target: 'sprint' | 'timeline',
    projectTitle = '',
  ) {
    if (!file) return;
    try {
      if (target === 'timeline') {
        const imported = parseProjectCalendarCsv(
          decodeCsv(await file.arrayBuffer()),
          data?.appSettings.importKeywords
            .split(',')
            .map((keyword) => keyword.trim()),
        );
        if (!imported.events.length) {
          const keywords = data?.appSettings.importKeywords ?? '';
          throw new Error(
            imported.matched
              ? 'พบงานที่ตรง keyword แต่ไม่มีช่วงวันที่ที่ใช้ได้'
              : `ไม่พบ Task Name ที่มี keyword: ${keywords}`,
          );
        }
        if (
          await mutate(
            'importCalendarCsv',
            { projectTitle, events: imported.events },
            `Import Calendar แล้ว ${imported.events.length} รายการ${imported.skipped ? ` · ข้าม ${imported.skipped} รายการที่วันที่ไม่ครบ` : ''}`,
          )
        ) {
          setTimelineYear(Number(imported.events[0].startDate.slice(0, 4)));
        }
        return;
      }
      const fileRows = (await readSheet(file, 1)) as unknown[][];
      const imported = parseSprintSheet(fileRows);
      setPendingImport({
        rows: fileRows,
        sprint: { id: imported.sprint.id, name: imported.sprint.name },
        memberCount: imported.members.length,
        leaveCount: imported.leaves.length,
        timelineCount: imported.timelineEvents.length,
      });
    } catch (error) {
      toast.add({
        title: `Import ${target === 'sprint' ? 'Sprint' : 'Timeline'} ไม่สำเร็จ`,
        description: error instanceof Error ? error.message : '',
        type: 'error',
      });
    } finally {
      if (target === 'sprint' && sprintImportInput.current) {
        sprintImportInput.current.value = '';
      }
    }
  }

  function downloadBackup() {
    if (!data) return;
    const backup = {
      format: backupFormat,
      version: 1,
      exportedAt: new Date().toISOString(),
      appSettings: data.appSettings,
      jira: {
        baseUrl: data.jira.baseUrl,
        email: data.jira.email,
        storyPointField: data.jira.storyPointField,
      },
      people: data.people,
      sprints: data.sprints,
      holidays: data.holidays,
      leaves: data.leaves,
      efforts: data.efforts,
      timelineEvents: data.timelineEvents,
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(backup, null, 2)], {
        type: 'application/json',
      }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `${data.appSettings.appName.replaceAll(/[^a-zA-Z0-9ก-๙_-]/g, '_')}-backup.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function restoreBackup(file?: File) {
    if (!file) return;
    try {
      const backup = JSON.parse(await file.text()) as unknown;
      await mutate('restoreBackup', { backup }, 'Restore ข้อมูลทั้งหมดแล้ว');
    } catch (error) {
      toast.add({
        title: 'Restore Backup ไม่สำเร็จ',
        description: error instanceof Error ? error.message : '',
        type: 'error',
      });
    } finally {
      if (backupInput.current) backupInput.current.value = '';
    }
  }

  return (
    <Toaster>
      <div className="min-h-screen bg-background text-foreground">
        <header className="sticky top-0 z-30 border-b border-white/8 bg-[#0b2628]/95 text-white backdrop-blur">
          <div className="mx-auto flex min-h-16 max-w-[1500px] items-center justify-between gap-4 px-4 sm:px-8">
            <div className="flex items-center gap-3">
              <div className="size-10 overflow-hidden rounded-xl bg-white shadow-[0_0_24px_rgba(201,255,74,.18)]">
                <Image
                  src="/scum-master-logo.png"
                  alt=""
                  width={40}
                  height={40}
                  className="size-full object-contain"
                />
              </div>
              <div>
                <p className="text-[15px] font-semibold leading-none">
                  {data?.appSettings.appName ?? 'Team Capacity App'}
                </p>
                <p className="mt-1 text-xs text-white/55">
                  Capacity &amp; timeline
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge
                className={
                  online
                    ? 'bg-white/10 text-white'
                    : 'bg-amber-300 text-amber-950'
                }
              >
                {online ? (
                  'Online'
                ) : (
                  <>
                    <CloudOff /> Offline
                  </>
                )}
              </Badge>
              <Button
                variant="ghost"
                size="icon"
                className="text-white hover:bg-white/10 hover:text-white"
                onClick={() => setModal('settings')}
                aria-label="ตั้งค่าแอป"
              >
                <Settings />
              </Button>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-[1500px] px-4 py-7 sm:px-8 sm:py-10">
          <section className="mb-7 flex flex-col justify-between gap-5 xl:flex-row xl:items-end">
            <div>
              <p className="mb-2 text-sm font-medium text-muted-foreground">
                TEAM WORKLOAD
              </p>
              <h1 className="text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
                กำลังทีมใน Sprint
              </h1>
              <p className="mt-2 text-base text-muted-foreground">
                เห็นงานที่รับไว้ วันลาที่ใช้ และ Manday ที่ยังเหลือในที่เดียว
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {data && data.sprints.length > 0 && (
                <NativeSelect
                  className="min-w-52"
                  value={selectedSprintId ?? ''}
                  onChange={(event) =>
                    setSelectedSprintId(Number(event.target.value))
                  }
                  aria-label="เลือก Sprint"
                >
                  {data.sprints.map((item) => (
                    <NativeSelectOption key={item.id} value={item.id}>
                      {item.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              )}
              <Button variant="outline" onClick={() => setModal('sprint')}>
                <Plus /> Sprint
              </Button>
              {sprint && (
                <Button
                  variant="destructive"
                  onClick={() =>
                    setDeleting({
                      action: 'deleteSprint',
                      id: sprint.id,
                      label: sprint.name,
                    })
                  }
                >
                  <Trash2 /> ลบ Sprint
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => void exportExcel()}
                disabled={!sprint}
              >
                <Download /> Export
              </Button>
              <Button
                variant="outline"
                onClick={() => sprintImportInput.current?.click()}
                disabled={!data?.sprints.length || busy}
              >
                <Upload /> Import Sprint
              </Button>
              <Input
                ref={sprintImportInput}
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={(event) =>
                  void chooseImport(event.target.files?.[0], 'sprint')
                }
                aria-label="เลือกไฟล์ Excel เพื่อนำเข้า Sprint"
              />
              <Button
                onClick={syncJira}
                disabled={!sprint || !online || busy}
                className="bg-[#c9ff4a] text-[#102829] hover:bg-[#b8eb41]"
              >
                {busy ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <RefreshCw />
                )}{' '}
                Sync Jira
              </Button>
            </div>
          </section>

          {!data ? (
            <div className="space-y-5">
              <div className="grid gap-4 md:grid-cols-3">
                {[1, 2, 3].map((item) => (
                  <Skeleton key={item} className="h-32 rounded-2xl" />
                ))}
              </div>
              <Skeleton className="h-80 rounded-2xl" />
            </div>
          ) : !sprint ? (
            <Card className="border-dashed py-14 text-center">
              <CardContent>
                <CalendarDays className="mx-auto mb-4 size-10 text-muted-foreground" />
                <h2 className="text-xl font-semibold">เริ่มจากสร้าง Sprint แรก</h2>
                <p className="mx-auto mt-2 max-w-md text-muted-foreground">
                  เลือกช่วงวันของ Sprint แล้วระบบจะคำนวณวันทำงานให้ทันที
                </p>
                <Button className="mt-5" onClick={() => setModal('sprint')}>
                  <Plus /> เพิ่ม Sprint
                </Button>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="font-semibold">{sprint.name}</span>
                  <span className="text-sm text-muted-foreground">
                    {formatDate(sprint.startDate)} –{' '}
                    {formatDate(sprint.endDate)}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    Excel: 1 SP = {number(sprint.mdPerStoryPoint)} MD
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>
                    {lastSync
                      ? `Jira ล่าสุด ${new Date(lastSync).toLocaleString('th-TH')}`
                      : 'ยังไม่เคย Sync Jira'}
                  </span>
                </div>
              </div>

              <section className="mb-6 space-y-4">
                {[
                  { platform: 'SUMMARY', ...platformSummary },
                  ...platformCapacities,
                ].map((item) => (
                  <div
                    key={item.platform}
                    className="grid gap-4 md:grid-cols-3"
                  >
                    <MetricCard
                      label={`TEAM CAPACITY · ${item.platform}`}
                      value={`${number(item.capacity)} MD`}
                      note={`${item.people} คน · ลา ${number(item.leaves)} วัน`}
                      tone={item.platform === 'SUMMARY' ? 'blue' : 'lime'}
                    />
                    <MetricCard
                      label={`JIRA EFFORT · ${item.platform}`}
                      value={`${number(item.planned)} MD`}
                      note={`${item.issues} Sub-task · ${number(item.storyPoints)} SP`}
                      tone={item.platform === 'SUMMARY' ? 'blue' : 'cyan'}
                    />
                    <MetricCard
                      label={`REMAINING · ${item.platform}`}
                      value={`${item.remaining >= 0 ? '+' : ''}${number(item.remaining)} MD`}
                      note={
                        item.remaining >= 0 ? 'ยังรับงานเพิ่มได้' : 'งานเกินกำลังที่มี'
                      }
                      tone={
                        item.platform === 'SUMMARY'
                          ? 'blue'
                          : item.remaining >= 0
                            ? 'plain'
                            : 'danger'
                      }
                    />
                  </div>
                ))}
              </section>

              <Tabs defaultValue="capacity" className="gap-5">
                <TabsList
                  variant="line"
                  className="lk w-full justify-start overflow-x-auto border-b"
                >
                  <TabsTrigger value="capacity">Capacity</TabsTrigger>
                  <TabsTrigger value="team">สมาชิกและวันลา</TabsTrigger>
                  <TabsTrigger value="holidays">วันหยุด</TabsTrigger>
                  <TabsTrigger value="timeline">Timeline ทั้งปี</TabsTrigger>
                </TabsList>
                <TabsContent value="capacity">
                  <Card>
                    <CardHeader className="border-b">
                      <CardTitle className="flex items-center justify-between gap-3">
                        ภาพรวมรายคน
                        <span className="flex items-center gap-2">
                          <NativeSelect
                            value={platformFilter}
                            onChange={(event) =>
                              setPlatformFilter(
                                event.target.value as 'all' | Platform,
                              )
                            }
                            aria-label="กรอง Platform"
                          >
                            <NativeSelectOption value="all">
                              ทุก Platform
                            </NativeSelectOption>
                            {platforms.map((platform) => (
                              <NativeSelectOption
                                key={platform}
                                value={platform}
                              >
                                {platform}
                              </NativeSelectOption>
                            ))}
                          </NativeSelect>
                          <Button size="sm" onClick={openPersonModal}>
                            <Plus /> สมาชิก
                          </Button>
                        </span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-0">
                      {visibleRows.length === 0 ? (
                        <Empty
                          title={
                            platformFilter === 'all'
                              ? 'ยังไม่มีสมาชิก'
                              : `ยังไม่มีสมาชิก ${platformFilter}`
                          }
                          action="เพิ่มสมาชิก"
                          onClick={openPersonModal}
                        />
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="pl-4">สมาชิก</TableHead>
                              <TableHead>Platform</TableHead>
                              <TableHead>Available</TableHead>
                              <TableHead>ลา</TableHead>
                              <TableHead>Jira effort</TableHead>
                              <TableHead className="min-w-52">
                                Workload
                              </TableHead>
                              <TableHead>Remaining</TableHead>
                              <TableHead className="text-right">
                                จัดการ
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {visibleRows.map((row) => (
                              <TableRow key={row.person.id}>
                                <TableCell className="pl-4 font-semibold">
                                  {row.person.displayName}
                                </TableCell>
                                <TableCell>
                                  <Badge variant="outline">
                                    {row.person.platform ?? 'ยังไม่ระบุ'}
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  {number(row.capacity.availableMandays)} MD
                                </TableCell>
                                <TableCell>
                                  {number(row.capacity.leaveDays)} วัน
                                </TableCell>
                                <TableCell>
                                  <button
                                    className="inline-flex items-center gap-1 font-semibold text-[#087f83] hover:underline"
                                    onClick={() => {
                                      setIssuePersonId(row.person.id);
                                      setModal('issues');
                                      if (online && !busy) void syncJira();
                                    }}
                                  >
                                    {number(row.capacity.plannedMandays)} MD{' '}
                                    <ChevronRight className="size-3.5" />
                                  </button>
                                  <span className="ml-2 text-xs text-muted-foreground">
                                    {row.effort?.issueCount ?? 0} งาน
                                  </span>
                                </TableCell>
                                <TableCell>
                                  <div className="flex items-center gap-3">
                                    <Progress
                                      value={Math.min(
                                        row.capacity.utilization,
                                        100,
                                      )}
                                      className={
                                        row.capacity.utilization > 100
                                          ? '[&_[data-slot=progress-indicator]]:bg-red-500'
                                          : '[&_[data-slot=progress-indicator]]:bg-[#19aeb3]'
                                      }
                                    />
                                    <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">
                                      {number(row.capacity.utilization)}%
                                    </span>
                                  </div>
                                </TableCell>
                                <TableCell
                                  className={
                                    row.capacity.remainingMandays < 0
                                      ? 'font-semibold text-red-600'
                                      : 'font-semibold text-emerald-700'
                                  }
                                >
                                  {row.capacity.remainingMandays >= 0
                                    ? '+'
                                    : ''}
                                  {number(row.capacity.remainingMandays)} MD
                                </TableCell>
                                <TableCell className="text-right">
                                  <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    onClick={() =>
                                      setDeleting({
                                        action: 'deletePerson',
                                        id: row.person.id,
                                        label: row.person.displayName,
                                      })
                                    }
                                    aria-label={`ลบ ${row.person.displayName}`}
                                  >
                                    <Trash2 />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="team">
                  <Card>
                    <CardHeader className="border-b">
                      <CardTitle className="flex items-center justify-between gap-3">
                        สมาชิกทีม{' '}
                        <span className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setModal('leave')}
                            disabled={!data.people.length}
                          >
                            <CalendarDays /> บันทึกวันลา
                          </Button>
                          <Button size="sm" onClick={openPersonModal}>
                            <Plus /> สมาชิก
                          </Button>
                        </span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {data.people.map((person) => {
                        const leaves = data.leaves.filter(
                          (leave) =>
                            leave.personId === person.id &&
                            leave.date >= sprint.startDate &&
                            leave.date <= sprint.endDate,
                        );
                        return (
                          <div
                            key={person.id}
                            className="rounded-xl border p-4"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="font-semibold">
                                  {person.displayName}
                                </p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {person.accountId ? (
                                    <Badge variant="outline">
                                      เชื่อม Jira แล้ว
                                    </Badge>
                                  ) : (
                                    <Badge variant="secondary">
                                      ยังจับคู่ด้วยชื่อ
                                    </Badge>
                                  )}
                                </p>
                              </div>
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                onClick={() =>
                                  setDeleting({
                                    action: 'deletePerson',
                                    id: person.id,
                                    label: person.displayName,
                                  })
                                }
                                aria-label={`ลบ ${person.displayName}`}
                              >
                                <Trash2 />
                              </Button>
                            </div>
                            <div className="mt-4 space-y-2">
                              <Label htmlFor={`platform-${person.id}`}>
                                Platform
                              </Label>
                              <NativeSelect
                                id={`platform-${person.id}`}
                                value={person.platform ?? ''}
                                onChange={(event) =>
                                  void mutate(
                                    'setPersonPlatform',
                                    {
                                      id: person.id,
                                      platform: event.target.value,
                                    },
                                    `ย้าย ${person.displayName} ไป ${event.target.value} แล้ว`,
                                  )
                                }
                                aria-label={`Platform ของ ${person.displayName}`}
                              >
                                <NativeSelectOption value="" disabled>
                                  เลือก Platform
                                </NativeSelectOption>
                                {platforms.map((platform) => (
                                  <NativeSelectOption
                                    key={platform}
                                    value={platform}
                                  >
                                    {platform}
                                  </NativeSelectOption>
                                ))}
                              </NativeSelect>
                            </div>
                            <div className="mt-4 space-y-2">
                              {leaves.length ? (
                                leaves.map((leave) => (
                                  <div
                                    key={leave.id}
                                    className="flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-xs"
                                  >
                                    <span>
                                      {formatDate(leave.date)} ·{' '}
                                      {leave.units === 0.5 ? 'ครึ่งวัน' : 'เต็มวัน'}
                                    </span>
                                    <button
                                      className="text-muted-foreground hover:text-destructive"
                                      onClick={() =>
                                        setDeleting({
                                          action: 'deleteLeave',
                                          id: leave.id,
                                          label: `วันลา ${formatDate(leave.date)}`,
                                        })
                                      }
                                      aria-label="ลบวันลา"
                                    >
                                      <Trash2 className="size-3.5" />
                                    </button>
                                  </div>
                                ))
                              ) : (
                                <p className="text-xs text-muted-foreground">
                                  ไม่มีวันลาใน Sprint นี้
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="holidays">
                  <Card>
                    <CardHeader className="border-b">
                      <CardTitle className="flex flex-wrap items-center justify-between gap-2">
                        วันหยุดบริษัท
                        <span className="flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={!online || busy}
                            onClick={() => void syncThaiHolidays()}
                          >
                            <RefreshCw /> อัปเดตวันหยุดไทย
                          </Button>
                          <Button size="sm" onClick={() => setModal('holiday')}>
                            <Plus /> วันหยุด
                          </Button>
                        </span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {data.holidays.length ? (
                        <div className="divide-y">
                          {data.holidays.map((holiday) => (
                            <div
                              key={holiday.id}
                              className={`flex items-center justify-between gap-4 py-3 ${holiday.active ? '' : 'opacity-45'}`}
                            >
                              <div>
                                <p className="flex flex-wrap items-center gap-2 font-medium">
                                  {holiday.name}
                                  <Badge variant="outline">
                                    {holiday.source === 'th-public'
                                      ? 'วันหยุดไทย'
                                      : 'กำหนดเอง'}
                                  </Badge>
                                </p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {formatDate(holiday.date)}
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                <Switch
                                  checked={Boolean(holiday.active)}
                                  onCheckedChange={(checked) =>
                                    void mutate(
                                      'toggleHoliday',
                                      { id: holiday.id, active: checked },
                                      checked ? 'ใช้วันหยุดนี้แล้ว' : 'ไม่นับวันหยุดนี้แล้ว',
                                    )
                                  }
                                  aria-label={`${holiday.active ? 'ปิด' : 'เปิด'} ${holiday.name}`}
                                />
                                {holiday.source === 'manual' && (
                                  <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    onClick={() =>
                                      setDeleting({
                                        action: 'deleteHoliday',
                                        id: holiday.id,
                                        label: holiday.name,
                                      })
                                    }
                                    aria-label={`ลบ ${holiday.name}`}
                                  >
                                    <Trash2 />
                                  </Button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <Empty
                          title="ยังไม่มีวันหยุดบริษัท"
                          action="เพิ่มวันหยุด"
                          onClick={() => setModal('holiday')}
                        />
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="timeline">
                  <YearCalendar
                    year={timelineYear}
                    events={data.timelineEvents}
                    settings={data.appSettings}
                    sprintRanges={sprintRanges}
                    holidays={data.holidays.filter((holiday) => holiday.active)}
                    onPreviousYear={() => setTimelineYear((year) => year - 1)}
                    onNextYear={() => setTimelineYear((year) => year + 1)}
                    onToday={() => setTimelineYear(new Date().getFullYear())}
                    onAdd={() => openTimelineModal()}
                    onAddHotfix={openHotfixModal}
                    onImport={() => setModal('timelineImport')}
                    onDeleteProject={(projectTitle) =>
                      setDeleting({
                        action: 'deleteTimelineProject',
                        projectTitle,
                        label: `Timeline โปรเจกต์ ${projectTitle}`,
                      })
                    }
                    onEdit={openTimelineModal}
                    onMoveRelease={(releaseEvents, event, edge, date) => {
                      const moved = moveTimelineEdge(event, edge, date);
                      if (!moved) {
                        toast.add({
                          title: 'วางวันที่นี้ไม่ได้',
                          description:
                            'Freeze code ต้องอยู่วันเดียวกับหรือก่อน Release',
                          type: 'warning',
                        });
                        return;
                      }
                      if (event.id > 0) {
                        void mutate(
                          'updateTimeline',
                          moved,
                          `เลื่อน${edge === 'start' ? ' Freeze code' : ' Release'}แล้ว`,
                        );
                        return;
                      }
                      void mutate(
                        'saveReleaseYear',
                        {
                          year: timelineYear,
                          events: releaseEvents.map((item) =>
                            item.startDate === event.startDate &&
                            item.endDate === event.endDate
                              ? moved
                              : item,
                          ),
                        },
                        `เลื่อน${edge === 'start' ? ' Freeze code' : ' Release'}แล้ว`,
                      );
                    }}
                  />
                </TabsContent>
              </Tabs>
            </>
          )}
        </main>
        {data?.appSettings.ownerName && (
          <footer className="mx-auto max-w-[1500px] px-4 pb-5 text-right text-xs text-muted-foreground sm:px-8">
            © {new Date().getFullYear()} {data.appSettings.ownerName}
          </footer>
        )}

        <Dialog
          open={modal !== null && modal !== 'issues'}
          onOpenChange={(open) => !open && setModal(null)}
        >
          <DialogContent className="sm:max-w-md">
            {modal === 'person' && (
              <>
                <DialogHeader>
                  <DialogTitle>เพิ่มหรือเชื่อมสมาชิกจาก Jira</DialogTitle>
                  <DialogDescription>
                    ค้นหาแล้วเลือกจาก Jira เพื่อจับคู่งานด้วย account ID
                  </DialogDescription>
                </DialogHeader>
                {data?.jira.configured ? (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="new-person-platform">Platform</Label>
                      <NativeSelect
                        id="new-person-platform"
                        value={personPlatform}
                        onChange={(event) =>
                          setPersonPlatform(event.target.value as Platform)
                        }
                      >
                        {platforms.map((platform) => (
                          <NativeSelectOption key={platform} value={platform}>
                            {platform}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </div>
                    <form
                      className="flex gap-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void searchJiraPeople();
                      }}
                    >
                      <div className="flex-1 space-y-2">
                        <Label htmlFor="jira-person-search">ชื่อหรืออีเมล</Label>
                        <Input
                          id="jira-person-search"
                          value={personQuery}
                          onChange={(event) =>
                            setPersonQuery(event.target.value)
                          }
                          placeholder="พิมพ์อย่างน้อย 2 ตัวอักษร"
                        />
                      </div>
                      <Button
                        type="submit"
                        className="mt-6"
                        disabled={
                          personQuery.trim().length < 2 || searchingPeople
                        }
                      >
                        {searchingPeople ? (
                          <LoaderCircle className="animate-spin" />
                        ) : (
                          <Search />
                        )}
                        ค้นหา
                      </Button>
                    </form>
                    <div className="max-h-72 space-y-2 overflow-y-auto">
                      {jiraUsers.map((user) => (
                        <button
                          key={user.accountId}
                          type="button"
                          className="flex w-full items-center justify-between rounded-xl border p-3 text-left hover:bg-muted"
                          disabled={busy}
                          onClick={() =>
                            void mutate(
                              'addPerson',
                              {
                                displayName: user.displayName,
                                accountId: user.accountId,
                                platform: personPlatform,
                              },
                              'เพิ่มและเชื่อมสมาชิกกับ Jira แล้ว',
                            )
                          }
                        >
                          <span className="font-medium">
                            {user.displayName}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            เลือก
                          </span>
                        </button>
                      ))}
                      {searchedPeople &&
                        !searchingPeople &&
                        !jiraUsers.length && (
                          <p className="rounded-xl bg-muted p-4 text-center text-sm text-muted-foreground">
                            ไม่พบผู้ใช้ ตรวจสอบชื่อหรือสิทธิ์ Browse users and groups
                          </p>
                        )}
                    </div>
                  </>
                ) : (
                  <div className="rounded-xl bg-muted p-4 text-sm">
                    กรุณาตั้งค่า Jira URL, email และ API token ก่อนค้นหาสมาชิก
                    <Button
                      className="mt-3 w-full"
                      onClick={() => setModal('jira')}
                    >
                      <Settings /> ตั้งค่า Jira
                    </Button>
                  </div>
                )}
              </>
            )}
            {modal === 'sprint' && (
              <SimpleForm
                title="เพิ่ม Sprint"
                description="กำหนดวันเริ่มต้นและวันสิ้นสุดได้เอง"
                busy={busy}
                onSubmit={(form) =>
                  mutate(
                    'addSprint',
                    {
                      name: formValue(form, 'name'),
                      startDate: formValue(form, 'startDate'),
                      endDate: formValue(form, 'endDate'),
                      mdPerStoryPoint: Number(
                        formValue(form, 'mdPerStoryPoint'),
                      ),
                    },
                    'เพิ่ม Sprint แล้ว',
                  )
                }
                fields={
                  <>
                    <Field
                      label="ชื่อ Sprint ใน Jira"
                      name="name"
                      placeholder="เช่น O2O Sprint 42"
                    />
                    <Field label="วันเริ่มต้น" name="startDate" type="date" />
                    <Field label="วันสิ้นสุด" name="endDate" type="date" />
                    <Field
                      label="Manday ต่อ 1 Story Point"
                      name="mdPerStoryPoint"
                      type="number"
                      defaultValue="1"
                      min="0.1"
                      step="0.1"
                    />
                  </>
                }
              />
            )}
            {modal === 'holiday' && (
              <SimpleForm
                title="เพิ่มวันหยุดบริษัท"
                description="วันหยุดจะถูกหักออกจากทุกคนโดยอัตโนมัติ"
                busy={busy}
                onSubmit={(form) =>
                  mutate(
                    'addHoliday',
                    {
                      name: formValue(form, 'name'),
                      date: formValue(form, 'date'),
                    },
                    'เพิ่มวันหยุดแล้ว',
                  )
                }
                fields={
                  <>
                    <Field
                      label="ชื่อวันหยุด"
                      name="name"
                      placeholder="เช่น วันหยุดบริษัท"
                    />
                    <Field label="วันที่" name="date" type="date" />
                  </>
                }
              />
            )}
            {modal === 'leave' && data && (
              <SimpleForm
                title="บันทึกวันลา"
                description="เลือกวันเดียวหรือช่วงวัน และลาเต็มวันหรือครึ่งวันได้"
                busy={busy}
                onSubmit={(form) =>
                  mutate(
                    'addLeave',
                    {
                      personId: Number(formValue(form, 'personId')),
                      sprintId: sprint?.id,
                      startDate: formValue(form, 'startDate'),
                      endDate: formValue(form, 'endDate'),
                      units: Number(formValue(form, 'units')),
                    },
                    'บันทึกวันลาแล้ว',
                  )
                }
                fields={
                  <>
                    <SelectField
                      label="สมาชิก"
                      name="personId"
                      options={data.people.map((person) => ({
                        value: person.id,
                        label: person.displayName,
                      }))}
                    />
                    <Field
                      label="วันเริ่มลา"
                      name="startDate"
                      type="date"
                      defaultValue={today()}
                    />
                    <Field
                      label="วันสิ้นสุด"
                      name="endDate"
                      type="date"
                      defaultValue={today()}
                    />
                    <SelectField
                      label="ระยะเวลา"
                      name="units"
                      options={[
                        { value: 1, label: 'เต็มวัน' },
                        { value: 0.5, label: 'ครึ่งวัน' },
                      ]}
                    />
                  </>
                }
              />
            )}
            {modal === 'timelineImport' && (
              <SimpleForm
                title="Import Timeline"
                description="ตั้งชื่อโปรเจกต์ แล้วเลือก CSV ที่มี Task Name และช่วงวันที่"
                busy={busy}
                submitLabel="Import Timeline"
                onSubmit={(form) => {
                  const file = form.get('file');
                  void chooseImport(
                    file instanceof File ? file : undefined,
                    'timeline',
                    formValue(form, 'projectTitle'),
                  );
                }}
                fields={
                  <>
                    <Field
                      label="ชื่อโปรเจกต์"
                      name="projectTitle"
                      placeholder="เช่น Gold Tier 2026"
                    />
                    <Field
                      label="ไฟล์ Timeline"
                      name="file"
                      type="file"
                      accept=".csv,text/csv"
                    />
                  </>
                }
              />
            )}
            {modal === 'timeline' && (
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  const releaseSchedule = editingTimeline?.kind === 'release';
                  const hotfix = editingTimeline?.kind === 'hotfix';
                  const updating = Boolean(editingTimeline?.id);
                  const startDate = formValue(form, 'startDate');
                  const endDate = hotfix
                    ? startDate
                    : formValue(form, 'endDate');
                  if (releaseSchedule) {
                    void mutate(
                      'saveReleaseYear',
                      {
                        year: timelineYear,
                        events: editingReleaseEvents.map((item) =>
                          item.startDate === editingTimeline.startDate &&
                          item.endDate === editingTimeline.endDate
                            ? {
                                ...item,
                                startDate,
                                endDate,
                                releaseVersion: formValue(
                                  form,
                                  'releaseVersion',
                                ),
                              }
                            : item,
                        ),
                      },
                      'บันทึกรอบและเลขเวอร์ชัน Release แล้ว',
                    );
                    return;
                  }
                  void mutate(
                    updating ? 'updateTimeline' : 'addTimeline',
                    {
                      id: editingTimeline?.id,
                      title: hotfix ? 'Hotfix' : formValue(form, 'title'),
                      epicUrl: hotfix ? '' : formValue(form, 'epicUrl'),
                      startDate,
                      endDate,
                      color: hotfix ? '#f59e0b' : formValue(form, 'color'),
                      kind: hotfix ? 'hotfix' : 'timeline',
                      recurrence: 'none',
                      releaseVersion: hotfix
                        ? formValue(form, 'releaseVersion')
                        : null,
                    },
                    hotfix
                      ? updating
                        ? 'แก้ไข Hotfix แล้ว'
                        : 'เพิ่ม Hotfix แล้ว'
                      : updating
                        ? 'แก้ไข Timeline แล้ว'
                        : 'เพิ่ม Timeline แล้ว',
                  );
                }}
              >
                <DialogHeader>
                  <DialogTitle>
                    {editingTimeline?.kind === 'release'
                      ? 'ตั้งค่ารอบ Freeze / Release'
                      : editingTimeline?.kind === 'hotfix'
                        ? editingTimeline.id
                          ? 'แก้ไข Hotfix'
                          : 'เพิ่ม Hotfix'
                        : editingTimeline
                          ? 'แก้ไข Timeline'
                          : 'เพิ่ม Timeline'}
                  </DialogTitle>
                  <DialogDescription>
                    {editingTimeline?.kind === 'release'
                      ? 'แก้วันที่และเลขเวอร์ชัน รอบถัดไปจะเพิ่ม minor อัตโนมัติ'
                      : editingTimeline?.kind === 'hotfix'
                        ? 'กำหนดวันที่และเลขเวอร์ชันพิเศษ โดยไม่เปลี่ยนรอบ Release ปกติ'
                        : 'กำหนดช่วง Development หรือ QA และเชื่อมกับ Epic'}
                  </DialogDescription>
                </DialogHeader>
                {editingTimeline?.kind !== 'release' &&
                  editingTimeline?.kind !== 'hotfix' && (
                    <>
                      <Field
                        label="Title"
                        name="title"
                        defaultValue={editingTimeline?.title}
                        placeholder="เช่น Checkout QA"
                      />
                      <Field
                        label="Epic link"
                        name="epicUrl"
                        type="url"
                        defaultValue={editingTimeline?.epicUrl}
                        placeholder="https://company.atlassian.net/browse/EPIC-123"
                      />
                    </>
                  )}
                <Field
                  label={
                    editingTimeline?.kind === 'release'
                      ? 'Freeze code รอบแรก'
                      : editingTimeline?.kind === 'hotfix'
                        ? 'วันที่ Hotfix'
                        : 'วันเริ่มต้น'
                  }
                  name="startDate"
                  type="date"
                  defaultValue={
                    editingTimeline?.startDate ??
                    (timelineYear === new Date().getFullYear()
                      ? today()
                      : `${timelineYear}-01-01`)
                  }
                />
                {editingTimeline?.kind !== 'hotfix' && (
                  <Field
                    label={
                      editingTimeline?.kind === 'release'
                        ? 'วันที่ Release'
                        : 'วันสิ้นสุด'
                    }
                    name="endDate"
                    type="date"
                    defaultValue={
                      editingTimeline?.endDate ??
                      (timelineYear === new Date().getFullYear()
                        ? today()
                        : `${timelineYear}-01-01`)
                    }
                  />
                )}
                {(editingTimeline?.kind === 'release' ||
                  editingTimeline?.kind === 'hotfix') && (
                  <Field
                    label="Release version"
                    name="releaseVersion"
                    defaultValue={editingTimeline.releaseVersion ?? ''}
                    placeholder="เช่น 2.67 หรือ 2.66.1"
                    inputMode="decimal"
                    pattern="[0-9]+\.[0-9]+(\.[0-9]+)?"
                    title="กรอกเป็น 2.67 หรือ 2.66.1"
                  />
                )}
                {editingTimeline?.kind !== 'release' &&
                  editingTimeline?.kind !== 'hotfix' && (
                    <Field
                      label="สี"
                      name="color"
                      type="color"
                      defaultValue={editingTimeline?.color ?? '#2563eb'}
                      className="h-11 p-1"
                    />
                  )}
                <DialogFooter className="sm:justify-between">
                  <div className="flex gap-2">
                    {editingTimeline &&
                      editingTimeline.id > 0 &&
                      editingTimeline.kind !== 'release' && (
                        <>
                          <Button
                            type="button"
                            variant="destructive"
                            onClick={() => {
                              setModal(null);
                              setDeleting({
                                action: 'deleteTimeline',
                                id: editingTimeline.id,
                                label:
                                  editingTimeline.kind === 'hotfix'
                                    ? `Hotfix ${editingTimeline.releaseVersion}`
                                    : editingTimeline.title,
                              });
                            }}
                          >
                            <Trash2 /> ลบ Timeline
                          </Button>
                          {editingTimeline.kind === 'timeline' &&
                            editingTimeline.epicUrl && (
                              <a
                                href={editingTimeline.epicUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-sm font-medium hover:bg-muted"
                              >
                                <ExternalLink className="size-4" /> เปิด Epic
                              </a>
                            )}
                        </>
                      )}
                  </div>
                  <Button type="submit" disabled={busy}>
                    {busy && <LoaderCircle className="animate-spin" />}
                    บันทึก
                  </Button>
                </DialogFooter>
              </form>
            )}
            {modal === 'settings' && data && (
              <>
                <SimpleForm
                  title="ตั้งค่าแอป"
                  description="ค่าทั้งหมดเก็บรวมกับข้อมูล local และติดไปกับ Backup"
                  busy={busy}
                  onSubmit={(form) =>
                    mutate(
                      'saveAppSettings',
                      {
                        releaseAnchorDate: formValue(form, 'releaseAnchorDate'),
                        releaseAnchorVersion: formValue(
                          form,
                          'releaseAnchorVersion',
                        ),
                        releaseCadenceDays: Number(
                          formValue(form, 'releaseCadenceDays'),
                        ),
                        importKeywords: formValue(form, 'importKeywords'),
                      },
                      'บันทึกการตั้งค่าแอปแล้ว',
                    )
                  }
                  fields={
                    <>
                      <Field
                        label="วันที่ Release ตั้งต้น"
                        name="releaseAnchorDate"
                        type="date"
                        defaultValue={data.appSettings.releaseAnchorDate}
                      />
                      <Field
                        label="เวอร์ชันตั้งต้น"
                        name="releaseAnchorVersion"
                        defaultValue={data.appSettings.releaseAnchorVersion}
                        pattern="[0-9]+\.[0-9]+(\.[0-9]+)?"
                        title="กรอกเป็น 2.67 หรือ 2.66.1"
                      />
                      <Field
                        label="จำนวนวันต่อรอบ Release"
                        name="releaseCadenceDays"
                        type="number"
                        min="7"
                        max="90"
                        step="1"
                        defaultValue={data.appSettings.releaseCadenceDays}
                      />
                      <Field
                        label="Keyword สำหรับ Import Timeline (คั่นด้วย comma)"
                        name="importKeywords"
                        defaultValue={data.appSettings.importKeywords}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setModal('jira')}
                      >
                        <Settings /> ตั้งค่าการเชื่อมต่อ Jira
                      </Button>
                    </>
                  }
                />
                <div className="border-t pt-4">
                  <p className="text-sm font-semibold">ข้อมูลและการส่งต่อ</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Backup รวม Sprint, สมาชิก, วันลา, วันหยุด, Timeline และการตั้งค่า
                    แต่ไม่รวม Jira API token
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={downloadBackup}
                    >
                      <Download /> ดาวน์โหลด Backup
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => backupInput.current?.click()}
                    >
                      <Upload /> Restore Backup
                    </Button>
                    <Input
                      ref={backupInput}
                      type="file"
                      accept=".json,application/json"
                      className="hidden"
                      onChange={(event) =>
                        void restoreBackup(event.target.files?.[0])
                      }
                      aria-label="เลือกไฟล์ Backup"
                    />
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={() => {
                        setModal(null);
                        setDeleting({
                          action: 'resetAllData',
                          label: 'ข้อมูลทั้งหมดในแอป',
                        });
                      }}
                    >
                      <Trash2 /> ล้างข้อมูลทั้งหมด
                    </Button>
                  </div>
                </div>
              </>
            )}
            {modal === 'jira' && data && (
              <SimpleForm
                title="เชื่อมต่อ Jira"
                description="อ่าน Sub-task [iOS], [Android], [QA] และ Comment แรกแบบ MD: 1.5 · token เก็บในเครื่องนี้เท่านั้น"
                busy={busy}
                onSubmit={(form) =>
                  mutate(
                    'saveJira',
                    {
                      baseUrl: formValue(form, 'baseUrl'),
                      email: formValue(form, 'email'),
                      apiToken: formValue(form, 'apiToken'),
                      storyPointField: formValue(form, 'storyPointField'),
                    },
                    'บันทึก Jira แล้ว',
                  )
                }
                fields={
                  <>
                    <Field
                      label="Jira URL"
                      name="baseUrl"
                      type="url"
                      defaultValue={data.jira.baseUrl}
                      placeholder="https://company.atlassian.net"
                    />
                    <Field
                      label="Jira email"
                      name="email"
                      type="email"
                      defaultValue={data.jira.email}
                    />
                    <Field
                      label={
                        data.jira.configured
                          ? 'API token (เว้นว่างเพื่อใช้ค่าเดิม)'
                          : 'API token'
                      }
                      name="apiToken"
                      type="password"
                      required={!data.jira.configured}
                    />
                    <Field
                      label="Story Point field"
                      name="storyPointField"
                      defaultValue={data.jira.storyPointField || 'Story_Points'}
                    />
                  </>
                }
              />
            )}
          </DialogContent>
        </Dialog>

        <Dialog
          open={modal === 'issues'}
          onOpenChange={(open) => !open && setModal(null)}
        >
          <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>งานของ {selectedPerson?.displayName}</DialogTitle>
              <DialogDescription>
                {sprint?.name} · Manday จาก Comment MD: ล่าสุดของงาน Platform
              </DialogDescription>
            </DialogHeader>
            {selectedIssues.length ? (
              <div className="divide-y rounded-xl border">
                {selectedIssues.map((issue) => (
                  <div
                    key={issue.key}
                    className="grid grid-cols-[auto_1fr_auto] gap-3 p-3"
                  >
                    <Badge
                      variant="outline"
                      className="cursor-pointer"
                      render={
                        <a
                          href={`${data?.jira.baseUrl ?? ''}/browse/${encodeURIComponent(issue.key)}`}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`เปิด ${issue.key} ใน Jira`}
                        />
                      }
                    >
                      {issue.key} <ExternalLink data-icon="inline-end" />
                    </Badge>
                    <div>
                      <p className="font-medium leading-snug">
                        {issue.summary}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {issue.status}
                      </p>
                    </div>
                    <span className="font-semibold">
                      {issue.mandays == null
                        ? 'ไม่มี MD'
                        : `${number(issue.mandays)} MD`}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-xl bg-muted p-6 text-center text-muted-foreground">
                ยังไม่มีงานที่ Sync ได้สำหรับคนนี้
              </p>
            )}
          </DialogContent>
        </Dialog>

        <AlertDialog
          open={Boolean(deleting)}
          onOpenChange={(open) => !open && setDeleting(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>ลบ {deleting?.label}?</AlertDialogTitle>
              <AlertDialogDescription>
                {deleting?.action === 'deletePerson'
                  ? 'สมาชิกคนนี้ รวมวันลาและ Jira effort ทุก Sprint จะถูกลบ และไม่สามารถย้อนกลับได้'
                  : deleting?.action === 'deleteTimelineProject'
                    ? 'Timeline ทุกช่วงของโปรเจกต์นี้จะถูกลบ และไม่สามารถย้อนกลับได้'
                    : deleting?.action === 'resetAllData'
                      ? 'Sprint, สมาชิก, วันลา, วันหยุด, Timeline, Jira token และการตั้งค่าทั้งหมดจะถูกลบ แนะนำให้ดาวน์โหลด Backup ก่อน'
                      : 'รายการนี้จะถูกลบออกจากข้อมูล local และไม่สามารถย้อนกลับได้'}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={busy}
                onClick={() =>
                  deleting &&
                  mutate(
                    deleting.action,
                    deleting.projectTitle
                      ? { projectTitle: deleting.projectTitle }
                      : { id: deleting.id },
                    deleting.action === 'resetAllData'
                      ? 'ล้างข้อมูลทั้งหมดแล้ว'
                      : 'ลบข้อมูลแล้ว',
                  )
                }
              >
                ลบ
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog
          open={Boolean(pendingImport)}
          onOpenChange={(open) => !open && setPendingImport(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Replace {pendingImport?.sprint.name}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                ระบบจะใช้ Sprint ID {pendingImport?.sprint.id} เพื่อแทนที่ข้อมูล Sprint
                เดิม รวม {pendingImport?.memberCount ?? 0} คน และวันลา{' '}
                {pendingImport?.leaveCount ?? 0} รายการ พร้อม Timeline{' '}
                {pendingImport?.timelineCount ?? 0} ช่วง
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
              <AlertDialogAction
                disabled={busy}
                onClick={async () => {
                  if (!pendingImport) return;
                  if (
                    await mutate(
                      'replaceSprint',
                      { rows: pendingImport.rows },
                      'Import และ replace Sprint แล้ว',
                    )
                  ) {
                    setPendingImport(null);
                    setSelectedSprintId(pendingImport.sprint.id);
                  }
                }}
              >
                Replace Sprint
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </Toaster>
  );
}

const monthName = new Intl.DateTimeFormat('th-TH', { month: 'long' });
const weekDays = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const contrastText = (hex: string) => {
  const [red, green, blue] = [1, 3, 5].map((index) =>
    Number.parseInt(hex.slice(index, index + 2), 16),
  );
  return red * 299 + green * 587 + blue * 114 > 160_000 ? '#102829' : '#ffffff';
};

function YearCalendar({
  year,
  events,
  settings,
  sprintRanges,
  holidays,
  onPreviousYear,
  onNextYear,
  onToday,
  onAdd,
  onAddHotfix,
  onImport,
  onDeleteProject,
  onEdit,
  onMoveRelease,
}: {
  year: number;
  events: TimelineEvent[];
  settings: AppSettings;
  sprintRanges: SprintRange[];
  holidays: Holiday[];
  onPreviousYear: () => void;
  onNextYear: () => void;
  onToday: () => void;
  onAdd: () => void;
  onAddHotfix: (date: string, releaseVersion: string) => void;
  onImport: () => void;
  onDeleteProject: (projectTitle: string) => void;
  onEdit: (event: TimelineEvent, releaseEvents?: TimelineEvent[]) => void;
  onMoveRelease: (
    events: TimelineEvent[],
    event: TimelineEvent,
    edge: 'start' | 'end',
    date: string,
  ) => void;
}) {
  const [dragging, setDragging] = useState<{
    event: TimelineEvent;
    edge: 'start' | 'end';
  } | null>(null);
  const holidayByDate = new Map(
    holidays.map((holiday) => [holiday.date, holiday]),
  );
  const regularEvents = timelineEventsForYear(
    events.filter((event) => event.kind === 'timeline'),
    year,
  );
  const hotfixEvents = events.filter(
    (event) =>
      event.kind === 'hotfix' &&
      event.startDate >= `${year}-01-01` &&
      event.startDate <= `${year}-12-31`,
  );
  const savedReleaseEvents = events.filter(
    (event) =>
      event.kind === 'release' &&
      event.recurrence === 'none' &&
      event.endDate >= `${year}-01-01` &&
      event.startDate <= `${year}-12-31`,
  );
  const releaseSchedule = events.find(
    (event) => event.kind === 'release' && event.recurrence !== 'none',
  ) ?? {
    id: 0,
    title: 'Release cycle',
    epicUrl: '',
    startDate: addDays(settings.releaseAnchorDate, -7),
    endDate: settings.releaseAnchorDate,
    color: '#94a3b8',
    kind: 'release' as const,
    recurrence: 'fortnightly' as const,
  };
  const releaseEvents = savedReleaseEvents.length
    ? savedReleaseEvents
    : timelineEventsForYear(
        [releaseSchedule],
        year,
        settings.releaseCadenceDays,
      );
  const releaseVersionByDate = releaseVersionsForEvents(releaseEvents, {
    anchorDate: settings.releaseAnchorDate,
    anchorVersion: settings.releaseAnchorVersion,
    cadenceDays: settings.releaseCadenceDays,
  });
  const calendarEvents = [...regularEvents, ...releaseEvents];
  const freezeByDate = new Map(
    releaseEvents.map((event) => [event.startDate, event]),
  );
  const releaseByDate = new Map(
    releaseEvents.map((event) => [event.endDate, event]),
  );
  const hotfixByDate = new Map(
    hotfixEvents.map((event) => [event.startDate, event]),
  );
  const hotfixVersionFor = (date: string) => {
    const latest = [
      ...releaseEvents.map((event) => ({
        date: event.endDate,
        version: releaseVersionByDate.get(event.endDate)!,
      })),
      ...hotfixEvents.map((event) => ({
        date: event.startDate,
        version: event.releaseVersion!,
      })),
    ]
      .filter((item) => item.date <= date && item.version)
      .sort((left, right) => left.date.localeCompare(right.date))
      .at(-1);
    return nextPatchVersion(latest?.version ?? settings.releaseAnchorVersion);
  };
  const todayDate = today();

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 border-b">
        <div>
          <CardTitle>Development Timeline พ.ศ. {year + 543}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            ลากวง Freeze หรือ Release เพื่อย้ายรอบ · คลิกวันที่เพื่อเพิ่ม Hotfix
          </p>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-2">
              <i className="size-5 rounded-full border-2 border-cyan-700" />
              Freeze code
            </span>
            <span className="inline-flex items-center gap-2">
              <i className="h-1 w-8 bg-slate-300" /> Regression / QA
            </span>
            <span className="inline-flex items-center gap-2">
              <i className="size-5 rounded-full border-2 border-red-500" />
              Release
            </span>
            <span className="inline-flex items-center gap-2">
              <i className="size-5 rounded-full border-2 border-amber-500" />
              Hotfix
            </span>
            <span className="inline-flex items-center gap-2">
              <i className="h-4 w-8 rounded border border-blue-300 bg-blue-100" />
              ช่วง Sprint
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={onPreviousYear}
            aria-label="ปีก่อนหน้า"
          >
            <ChevronLeft />
          </Button>
          <Button variant="outline" onClick={onToday}>
            ปีปัจจุบัน
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={onNextYear}
            aria-label="ปีถัดไป"
          >
            <ChevronRight />
          </Button>
          <Button onClick={onAdd}>
            <Plus /> เพิ่ม Timeline
          </Button>
          <Button variant="outline" onClick={onImport}>
            <Upload /> Import Timeline
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {Array.from({ length: 12 }, (_, month) => {
          const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
          return (
            <section key={month} className="overflow-hidden rounded-xl border">
              <h3 className="bg-[#0b2628] px-3 py-2 font-semibold text-white">
                {monthName.format(new Date(Date.UTC(year, month, 1)))}
              </h3>
              <div className="grid grid-cols-7 bg-muted text-center text-xs font-medium text-muted-foreground">
                {weekDays.map((day) => (
                  <span key={day} className="py-1.5">
                    {day}
                  </span>
                ))}
              </div>
              {monthWeeks(year, month).map((week) => {
                const segments = timelineSegments(
                  calendarEvents,
                  week,
                  monthPrefix,
                );
                const sprintSegments = timelineSegments(
                  sprintRanges,
                  week,
                  monthPrefix,
                );
                const projectTitles = [
                  ...new Set(
                    segments.flatMap(({ event }) =>
                      event.projectTitle ? [event.projectTitle] : [],
                    ),
                  ),
                ];
                const ungroupedSegments = segments.filter(
                  ({ event }) => !event.projectTitle,
                );
                return (
                  <div key={week[0]} className="border-t">
                    <div className="grid grid-cols-7">
                      {week.map((date) => {
                        const inMonth = date.startsWith(monthPrefix);
                        const holiday = inMonth
                          ? holidayByDate.get(date)
                          : undefined;
                        const freeze = inMonth
                          ? freezeByDate.get(date)
                          : undefined;
                        const release = inMonth
                          ? releaseByDate.get(date)
                          : undefined;
                        const hotfix = inMonth
                          ? hotfixByDate.get(date)
                          : undefined;
                        const displayedReleaseVersion = release
                          ? releaseVersionByDate.get(release.endDate)
                          : undefined;
                        return (
                          <div
                            key={date}
                            title={[
                              holiday?.name,
                              freeze && `Freeze: ${freeze.title}`,
                              release && `Release: ${displayedReleaseVersion}`,
                              hotfix && `Hotfix: ${hotfix.releaseVersion}`,
                            ]
                              .filter(Boolean)
                              .join('\n')}
                            onDragOver={(event) => {
                              if (!dragging || !inMonth) return;
                              event.preventDefault();
                              event.dataTransfer.dropEffect = 'move';
                            }}
                            onDrop={(event) => {
                              event.preventDefault();
                              if (dragging && inMonth) {
                                onMoveRelease(
                                  releaseEvents,
                                  dragging.event,
                                  dragging.edge,
                                  date,
                                );
                              }
                              setDragging(null);
                            }}
                            className={`min-h-16 border-r p-1 last:border-r-0 ${
                              inMonth
                                ? ''
                                : 'bg-muted/35 text-muted-foreground/35'
                            } ${holiday && release ? 'bg-yellow-100 text-yellow-900' : holiday && freeze ? 'bg-blue-100 text-blue-900' : hotfix ? 'bg-amber-50 text-amber-800' : freeze ? 'bg-cyan-50 text-cyan-800' : holiday || release ? 'bg-red-50 text-red-700' : ''}`}
                          >
                            <button
                              type="button"
                              disabled={!inMonth}
                              draggable={Boolean(freeze || release)}
                              onClick={() => {
                                const marker = release ?? freeze;
                                if (marker) {
                                  onEdit(
                                    {
                                      ...marker,
                                      releaseVersion: releaseVersionByDate.get(
                                        marker.endDate,
                                      ),
                                    },
                                    releaseEvents,
                                  );
                                } else if (hotfix) {
                                  onEdit(hotfix);
                                } else {
                                  onAddHotfix(date, hotfixVersionFor(date));
                                }
                              }}
                              onDragStart={(event) => {
                                const marker = release ?? freeze;
                                if (!marker) return;
                                event.dataTransfer.effectAllowed = 'move';
                                setDragging({
                                  event: marker,
                                  edge: release ? 'end' : 'start',
                                });
                              }}
                              onDragEnd={() => setDragging(null)}
                              aria-label={
                                release
                                  ? `ลากเพื่อเลื่อน Release ของ ${release.title}`
                                  : freeze
                                    ? `ลากเพื่อเลื่อน Freeze code ของ ${freeze.title}`
                                    : hotfix
                                      ? `แก้ไข Hotfix ${hotfix.releaseVersion}`
                                      : `เพิ่ม Hotfix วันที่ ${formatDate(date)}`
                              }
                              className={`inline-grid size-6 place-items-center rounded-full text-xs ${
                                release
                                  ? 'cursor-grab border-2 border-red-500 font-semibold text-red-600 active:cursor-grabbing'
                                  : freeze
                                    ? 'cursor-grab border-2 border-cyan-700 font-semibold text-cyan-800 active:cursor-grabbing'
                                    : hotfix
                                      ? 'border-2 border-amber-500 font-semibold text-amber-700'
                                      : date === todayDate
                                        ? 'cursor-pointer bg-[#2563eb] font-semibold text-white'
                                        : 'cursor-pointer hover:bg-muted'
                              }`}
                            >
                              {Number(date.slice(-2))}
                            </button>
                            {(displayedReleaseVersion ||
                              hotfix?.releaseVersion) && (
                              <p className="mt-0.5 truncate text-[10px] font-bold leading-tight">
                                v
                                {displayedReleaseVersion ??
                                  hotfix?.releaseVersion}
                              </p>
                            )}
                            {holiday && (
                              <p className="mt-0.5 truncate text-xs font-medium">
                                {holiday.name}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {(sprintSegments.length > 0 || segments.length > 0) && (
                      <div className="space-y-1 px-1 pb-1.5">
                        {sprintSegments.map(({ event, start, span }) => (
                          <div
                            key={`sprint-${event.id}-${week[0]}`}
                            className="grid grid-cols-7"
                          >
                            <div
                              className="truncate rounded border border-blue-300 bg-blue-100 px-2 py-1 text-left text-xs font-semibold text-blue-950"
                              style={{ gridColumn: `${start} / span ${span}` }}
                              title={`${event.title}: ${formatDate(event.startDate)} – ${formatDate(event.endDate)}`}
                              aria-label={`${event.title} ตั้งแต่ ${formatDate(event.startDate)} ถึง ${formatDate(event.endDate)}`}
                            >
                              {event.title} · {formatDate(event.startDate)} –{' '}
                              {formatDate(event.endDate)}
                            </div>
                          </div>
                        ))}
                        {ungroupedSegments.map(({ event, start, span }) => (
                          <div
                            key={`${event.id}-${week[0]}`}
                            className="grid grid-cols-7"
                          >
                            {event.kind === 'release' ? (
                              <button
                                type="button"
                                className="relative h-5 focus-visible:outline-2 focus-visible:outline-offset-1"
                                style={{
                                  gridColumn: `${start} / span ${span}`,
                                }}
                                title={`${event.title}: Freeze ${event.startDate} → Release ${event.endDate}`}
                                aria-label={`แก้ไขรอบ ${event.title}`}
                                onClick={() => onEdit(event)}
                              >
                                <span className="absolute inset-x-1 top-1/2 h-1 -translate-y-1/2 bg-slate-300" />
                                <span className="absolute top-1/2 right-0 -translate-y-1/2 border-y-[5px] border-l-[8px] border-y-transparent border-l-slate-300" />
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="truncate rounded px-2 py-1 text-left text-xs font-semibold shadow-sm hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-1"
                                style={{
                                  gridColumn: `${start} / span ${span}`,
                                  backgroundColor: event.color,
                                  color: contrastText(event.color),
                                }}
                                title={`${event.title} (${event.startDate} – ${event.endDate})`}
                                aria-label={`แก้ไข ${event.title}`}
                                onClick={() => onEdit(event)}
                              >
                                {event.title}
                              </button>
                            )}
                          </div>
                        ))}
                        {projectTitles.map((projectTitle) => {
                          const projectSegments = segments.filter(
                            ({ event }) => event.projectTitle === projectTitle,
                          );
                          const projectColor = projectSegments[0].event.color;
                          return (
                            <section
                              key={`${projectTitle}-${week[0]}`}
                              className="space-y-1 rounded-lg border-2 bg-white/70 p-1.5"
                              style={{ borderColor: projectColor }}
                            >
                              <div className="flex items-center justify-between gap-2 px-1">
                                <p
                                  className="truncate text-xs font-bold"
                                  style={{ color: projectColor }}
                                >
                                  {projectTitle}
                                </p>
                                <button
                                  type="button"
                                  className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                  onClick={() => onDeleteProject(projectTitle)}
                                  aria-label={`ลบ Timeline ทั้งหมดของโปรเจกต์ ${projectTitle}`}
                                >
                                  <Trash2 className="size-3.5" />
                                </button>
                              </div>
                              {projectSegments.map(({ event, start, span }) => (
                                <div
                                  key={`${event.id}-${week[0]}`}
                                  className="grid grid-cols-7"
                                >
                                  <button
                                    type="button"
                                    className="truncate rounded px-2 py-1 text-left text-xs font-semibold shadow-sm hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-1"
                                    style={{
                                      gridColumn: `${start} / span ${span}`,
                                      backgroundColor: event.color,
                                      color: contrastText(event.color),
                                    }}
                                    title={`${event.title} (${event.startDate} – ${event.endDate})`}
                                    aria-label={`แก้ไข ${event.title}`}
                                    onClick={() => onEdit(event)}
                                  >
                                    {event.title}
                                  </button>
                                </div>
                              ))}
                            </section>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          );
        })}
      </CardContent>
    </Card>
  );
}

function MetricCard({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone: 'lime' | 'cyan' | 'blue' | 'plain' | 'danger';
}) {
  const colors = {
    lime: 'bg-[#dfff7b] text-[#163131]',
    cyan: 'bg-[#bff4f0] text-[#143535]',
    blue: 'bg-[#2563eb] text-white',
    plain: 'bg-white',
    danger: 'bg-[#ffe0dc] text-[#791f18]',
  };
  return (
    <Card
      className={`${colors[tone]} min-h-32 justify-between ring-0 shadow-[0_10px_30px_rgba(9,41,42,.08)]`}
    >
      <CardHeader>
        <p className="text-xs font-semibold tracking-[0.12em] opacity-60">
          {label}
        </p>
        <p className="text-3xl font-semibold tracking-[-0.04em]">{value}</p>
      </CardHeader>
      <CardContent>
        <p className="text-sm opacity-65">{note}</p>
      </CardContent>
    </Card>
  );
}

function Empty({
  title,
  action,
  onClick,
}: {
  title: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <div className="py-14 text-center">
      <Users className="mx-auto mb-3 size-8 text-muted-foreground" />
      <p className="font-medium">{title}</p>
      <Button variant="outline" size="sm" className="mt-4" onClick={onClick}>
        <Plus /> {action}
      </Button>
    </div>
  );
}

function Field(
  props: ComponentProps<typeof Input> & { label: string; name: string },
) {
  const { label, name, ...input } = props;
  return (
    <div className="grid gap-2">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} required {...input} />
    </div>
  );
}

function SelectField({
  label,
  name,
  options,
}: {
  label: string;
  name: string;
  options: { value: string | number; label: string }[];
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={name}>{label}</Label>
      <NativeSelect className="w-full" id={name} name={name}>
        {options.map((option) => (
          <NativeSelectOption key={option.value} value={option.value}>
            {option.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  );
}

function SimpleForm({
  title,
  description,
  fields,
  busy,
  submitLabel = 'บันทึก',
  onSubmit,
}: {
  title: string;
  description: string;
  fields: ReactNode;
  busy: boolean;
  submitLabel?: string;
  onSubmit: (form: FormData) => void;
}) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(new FormData(event.currentTarget));
      }}
    >
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <div className="my-5 grid gap-4">{fields}</div>
      <DialogFooter>
        <Button type="submit" disabled={busy}>
          {busy ? <LoaderCircle className="animate-spin" /> : null}{' '}
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}
