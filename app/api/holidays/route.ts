import { env } from 'cloudflare:workers';
import { addDays } from '@/lib/capacity';

type ThaiHoliday = {
  title?: unknown;
  name?: unknown;
  start_date?: unknown;
  end_date?: unknown;
  date?: unknown;
};
const string = (value: unknown) => (typeof value === 'string' ? value : '');

export async function POST(request: Request) {
  try {
    const { year } = await request.json<{ year?: unknown }>();
    const parsedYear = Number(year);
    if (
      !Number.isInteger(parsedYear) ||
      parsedYear < 2000 ||
      parsedYear > 2100
    ) {
      throw new Error('ปีไม่ถูกต้อง');
    }

    const response = await fetch(
      `https://thailandformats.com/api/v1/holidays/${parsedYear}`,
    );
    if (!response.ok) throw new Error('ดาวน์โหลดวันหยุดไทยไม่สำเร็จ');
    const payload = (await response.json()) as
      | ThaiHoliday[]
      | { data?: ThaiHoliday[]; holidays?: ThaiHoliday[] };
    const holidays = Array.isArray(payload)
      ? payload
      : (payload.data ?? payload.holidays ?? []);
    const dates: { date: string; name: string }[] = [];

    for (const holiday of holidays) {
      const name = string(holiday.title ?? holiday.name).trim();
      const start = string(holiday.start_date ?? holiday.date).slice(0, 10);
      const end = string(holiday.end_date).slice(0, 10) || start;
      if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(start) || end < start) continue;
      for (let current = start; current <= end; current = addDays(current, 1)) {
        dates.push({ date: current, name });
      }
    }
    if (!dates.length) throw new Error('ไม่พบวันหยุดไทยสำหรับปีนี้');

    await env.DB.batch(
      dates.map((holiday) =>
        env.DB.prepare(`
          INSERT INTO holidays (date, name, source, active)
          VALUES (?, ?, 'th-public', 1)
          ON CONFLICT(date) DO UPDATE SET
            name = excluded.name,
            source = excluded.source
          WHERE holidays.source = 'th-public'
        `).bind(holiday.date, holiday.name),
      ),
    );
    return Response.json({ count: dates.length });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : 'อัปเดตวันหยุดไทยไม่สำเร็จ',
      },
      { status: 400 },
    );
  }
}
