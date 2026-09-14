export type Sprint = {
  startDate: string;
  endDate: string;
};

export type Leave = { date: string; units: number };

const day = 86_400_000;

export function addDays(date: string, amount: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + amount * day)
    .toISOString()
    .slice(0, 10);
}

export function datesBetween(startDate: string, endDate: string) {
  const dates: string[] = [];
  for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
    dates.push(date);
  }
  return dates;
}

export function isWeekday(date: string) {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return weekday !== 0 && weekday !== 6;
}

export function capacityFor(
  sprint: Sprint,
  holidayDates: string[],
  leaves: Leave[],
  plannedMandays: number,
) {
  const holidays = new Set(holidayDates);
  let workdays = 0;

  for (const date of datesBetween(sprint.startDate, sprint.endDate)) {
    if (isWeekday(date) && !holidays.has(date)) workdays += 1;
  }

  const leaveDays = leaves.reduce(
    (total, leave) =>
      leave.date >= sprint.startDate &&
      leave.date <= sprint.endDate &&
      isWeekday(leave.date) &&
      !holidays.has(leave.date)
        ? total + leave.units
        : total,
    0,
  );
  const availableMandays = Math.max(0, workdays - leaveDays);
  return {
    workdays,
    leaveDays,
    availableMandays,
    plannedMandays,
    remainingMandays: availableMandays - plannedMandays,
    utilization: availableMandays
      ? (plannedMandays / availableMandays) * 100
      : 0,
  };
}
