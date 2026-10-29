// Chạy MỘT chủ đề Bản tin: đọc nguồn → mục mới (khử trùng theo URL/hash đã lưu) → đọc trang bài → tóm tắt tiếng Việt
// → lưu news_items → dựng lại ghi chú cho từng người nhận (giữ phần dưới MARKER, qua RPC news_write_note).
// Không phụ thuộc Supabase: `db` là giao diện nhỏ để kiểm thử + chạy thử khô (dry run) không ghi CSDL thật.
import * as N from '../_shared/news.js';

export interface NewsDb {
  seen(topicId: string): Promise<{ url: string; hash: string }[]>;
  insertItems(topicId: string, items: any[]): Promise<number>;
  recentItems(topicId: string, sinceDay: string): Promise<any[]>;
  targets(topicId: string): Promise<string[]>;
  writeNote(topicId: string, userId: string, title: string, head: string): Promise<string | null>;
  setStatus(topicId: string, patch: Record<string, unknown>): Promise<void>;
}
export const UA = 'GhiChu-BanTin/1.0 (+https://saokyn.github.io/ghi-chu/)';

export async function runTopic(db: NewsDb, topic: any, opts: { fetchText: (u: string) => Promise<string>; ai?: ((items: any[]) => Promise<Record<number, string>>) | null; now?: number; trig?: string }) {
  const now = opts.now ?? Date.now(), today = N.vnDay(now), keep = topic.keep_days || N.KEEP_DAYS;
  let status = 'ok', summary = '', notes = 0, added = 0;
  const log: string[] = [];
  try {
    const seen = await db.seen(topic.id);
    const r = await N.collect(topic, { fetchText: opts.fetchText, seen, ai: opts.ai ?? null, now });
    log.push(...r.log);
    if (!r.fetched.length) throw new Error('Không đọc được nguồn nào');
    added = r.items.length ? await db.insertItems(topic.id, r.items.map((i: any) => ({
      url: i.url, hash: i.hash, title: String(i.title).slice(0, 500), grp: i.grp, summary: String(i.summary).slice(0, 1000),
      ai: !!i.ai, end_date: i.end_date, published: i.published, day: i.day,
    }))) : 0;
    const items = await db.recentItems(topic.id, N.addDays(today, -(keep - 1)));
    const head = N.renderNote({ topic, items, user: '', today });
    for (const uid of await db.targets(topic.id)) if (await db.writeNote(topic.id, uid, `📰 ${topic.name}`, head)) notes++;
    if (log.some((l) => /^Không đọc được|^Trang bài không đúng/.test(l))) status = 'partial';
    summary = `${added} mục mới · ${items.length} mục trong ${keep} ngày · cập nhật ${notes} ghi chú`;
  } catch (e) {
    status = 'error'; summary = 'Lỗi: ' + String((e as Error)?.message || e).slice(0, 300);
  }
  await db.setStatus(topic.id, { last_run_at: new Date(now).toISOString(), last_status: status, last_result: { summary, log: log.slice(-20), trig: opts.trig || 'cron' } });
  return { status, summary, added, notes, log };
}

/** fetchText dùng safeFetch (https, chặn SSRF, giới hạn kích thước). */
export function makeFetchText(safeFetch: any, readLimited: any, ms = 12_000) {
  return async (url: string) => {
    const res = await safeFetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/rss+xml,application/xml;q=0.9,*/*;q=0.5', 'Accept-Language': 'en,vi;q=0.8' } }, ms, { httpsOnly: true });
    if (!res.ok) { await res.body?.cancel(); throw new Error('HTTP ' + res.status); }
    return await readLimited(res, 1_500_000);
  };
}

/** Lần chạy theo lịch: bỏ qua chủ đề đã chạy theo lịch hôm nay (giờ VN) → cron gọi lại lúc 07:20 chỉ làm phần còn dở. */
export function dueToday(topic: any, now = Date.now()) {
  if (!topic.enabled) return false;
  const r = topic.last_result || {};
  return !(topic.last_run_at && r.trig === 'cron' && N.vnDay(Date.parse(topic.last_run_at)) === N.vnDay(now));
}
