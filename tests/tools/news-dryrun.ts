// Chạy thử khô Bản tin với mạng THẬT (đúng đường safeFetch của edge function) nhưng CSDL trong bộ nhớ — không ghi gì lên Supabase.
//   deno run --node-modules-dir=none --allow-net --allow-read --allow-env tests/tools/news-dryrun.ts [url…]
import { safeFetch, readLimited } from '../../supabase/functions/_shared/webcore.ts';
import { runTopic, makeFetchText } from '../../supabase/functions/news-digest/run.ts';
import { MemDb } from './news-memdb.ts';

const urls = Deno.args.length ? Deno.args : ['https://en.toram.jp/information/?type_code=all'];
const topic = { id: 'dry', name: 'Toram – Sự kiện', sources: urls, template: { parser: urls.some((u) => /rss|feed/.test(u)) ? 'rss' : 'toram' }, keep_days: 7, enabled: true };
const db = new MemDb({ dry: ['me'] });
const t0 = Date.now();
const r = await runTopic(db, topic, { fetchText: makeFetchText(safeFetch, readLimited), trig: 'dry-run' });
console.log(`== ${r.status} · ${r.summary} · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
for (const l of r.log) console.log('  log:', l);
console.log('\n' + (db.notes.get('note-1')?.content ?? '(không có ghi chú)'));
