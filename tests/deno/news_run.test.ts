// deno test --node-modules-dir=none --allow-read tests/deno/news_run.test.ts
import { assert, assertEquals, assertMatch } from 'jsr:@std/assert@1';
import { runTopic, dueToday } from '../../supabase/functions/news-digest/run.ts';
import { MARKER } from '../../supabase/functions/_shared/news.js';
import { MemDb } from '../tools/news-memdb.ts';

const F = new URL('../fixtures/toram/', import.meta.url);
const fx = (fail = new Set<string>()) => async (u: string) => {
  const id = /information_id=(\d+)/.exec(u)?.[1]; const t = /type_code=(\w+)/.exec(u)?.[1] || 'all';
  if (id && fail.has(id)) throw new Error('HTTP 503');
  try { return await Deno.readTextFile(new URL(id ? `detail-${id}.html` : `list-${t}.html`, F)); } catch { throw new Error('HTTP 404'); }
};
const T = { id: 't1', name: 'Toram – Sự kiện', sources: ['https://en.toram.jp/information/?type_code=all'], template: { parser: 'toram' }, keep_days: 7, enabled: true };
const D29 = Date.parse('2026-10-29T00:00:00Z'), DAY = 864e5;

Deno.test('chạy lần đầu: tạo 1 ghi chú/người nhận, mục chèn dưới 📅 29/10/2026, mỗi mục có link trang đã tải', async () => {
  const db = new MemDb({ t1: ['u1', 'u2'] });
  const r = await runTopic(db, T, { fetchText: fx(new Set(['11351'])), now: D29 });
  assertEquals([r.status, r.added, r.notes], ['partial', 9, 2]);
  const c = db.notes.get('note-1')!.content;
  assertMatch(c, /^📰 Toram – Sự kiện[^\n]*\n\n📅 29\/10\/2026\n▸ Sự kiện đang diễn ra\n• /);
  assert(c.includes('▸ Boss / rớt đồ') && c.includes('▸ Cập nhật mới') && c.endsWith(MARKER + '\n'));
  const links = c.split('\n').filter((l) => l.startsWith('  https://'));
  assertEquals(links.length, 9); assert(!c.includes('11351'));
  assertEquals(db.status.t1.last_status, 'partial'); assertEquals(db.status.t1.last_result.trig, 'cron');
});

Deno.test('ngày hôm sau: chỉ mục mới, lên ĐẦU dưới 📅 30/10; chữ người dùng dưới MARKER giữ nguyên; đủ 7 ngày bị bỏ', async () => {
  const db = new MemDb({ t1: ['u1'] });
  await runTopic(db, T, { fetchText: fx(new Set(['11351'])), now: D29 });
  const n = db.notes.get('note-1')!; n.content = n.content.replace('📰', '📰 (người dùng sửa phần trên)') + 'Kế hoạch: farm boss Halloween\n';
  const r2 = await runTopic(db, T, { fetchText: fx(), now: D29 + DAY });
  assertEquals([r2.status, r2.added], ['ok', 1]);
  const c = n.content;
  assert(c.indexOf('📅 30/10/2026') < c.indexOf('📅 29/10/2026') && c.indexOf('📅 30/10/2026') > 0);
  assert(c.endsWith(MARKER + '\nKế hoạch: farm boss Halloween\n') && !c.includes('người dùng sửa phần trên'));
  const r3 = await runTopic(db, T, { fetchText: fx(), now: D29 + 7 * DAY });       // 05/11: 29/10 và 30/10 đã quá 7 ngày
  assertEquals(r3.added, 0);
  assert(!n.content.includes('📅 29/10/2026') && n.content.includes('📅 30/10/2026'));   // 29/10 đủ 7 ngày → bỏ; 30/10 mới 6 ngày → còn
  await runTopic(db, T, { fetchText: fx(), now: D29 + 8 * DAY });
  assert(!n.content.includes('📅') && n.content.includes('Chưa có tin mới'));
  assert(n.content.endsWith('Kế hoạch: farm boss Halloween\n'));
});

Deno.test('xoá ghi chú = bỏ theo dõi; nguồn hỏng hết = lỗi, không ghi gì; dueToday', async () => {
  const db = new MemDb({ t1: ['u1'] });
  await runTopic(db, T, { fetchText: fx(), now: D29 });
  db.deleteNote('note-1');
  const r = await runTopic(db, T, { fetchText: fx(), now: D29 + DAY });
  assertEquals([r.notes, db.notes.size], [0, 0]);
  const db2 = new MemDb({ t1: ['u1'] });
  const e = await runTopic(db2, T, { fetchText: async () => { throw new Error('HTTP 403'); }, now: D29 });
  assertEquals([e.status, db2.notes.size, db2.items.length], ['error', 0, 0]);
  assertMatch(e.summary, /Không đọc được nguồn nào/);
  const ran = { ...T, last_run_at: new Date(D29).toISOString(), last_result: { trig: 'cron' } };
  assertEquals([dueToday(ran, D29 + 3600e3), dueToday(ran, D29 + DAY), dueToday({ ...ran, last_result: { trig: 'manual' } }, D29), dueToday({ ...T, enabled: false })], [false, true, true, false]);
});
