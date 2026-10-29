// CSDL trong bộ nhớ cho kiểm thử/chạy thử khô Bản tin: mô phỏng đúng ngữ nghĩa của RPC news_write_note
// (giữ phần dưới MARKER, xoá ghi chú = bỏ theo dõi). Không chạm CSDL thật.
import { MARKER } from '../../supabase/functions/_shared/news.js';
import type { NewsDb } from '../../supabase/functions/news-digest/run.ts';

export class MemDb implements NewsDb {
  items: any[] = []; notes = new Map<string, { user_id: string; title: string; content: string; topic: string }>();
  links = new Map<string, string | null>(); status: Record<string, any> = {}; n = 0;
  constructor(public targetMap: Record<string, string[]>) {}
  async seen(t: string) { return this.items.filter((i) => i.topic_id === t).map((i) => ({ url: i.url, hash: i.hash })); }
  async insertItems(t: string, rows: any[]) {
    let k = 0; for (const r of rows) if (!this.items.some((i) => i.topic_id === t && i.url === r.url)) { this.items.push({ ...r, topic_id: t }); k++; }
    return k;
  }
  async recentItems(t: string, since: string) { return this.items.filter((i) => i.topic_id === t && i.day >= since); }
  async targets(t: string) { return this.targetMap[t] || []; }
  async writeNote(t: string, uid: string, title: string, head: string) {
    if (!(this.targetMap[t] || []).includes(uid)) return null;
    if (!head.endsWith(MARKER + '\n')) throw new Error('p_head phải kết thúc bằng MARKER');
    const key = t + '|' + uid;
    if (this.links.has(key)) {
      const id = this.links.get(key); if (!id) return null;
      const n = this.notes.get(id)!; const i = n.content.indexOf(MARKER);
      const u = i >= 0 ? n.content.slice(i + MARKER.length).replace(/^\n/, '') : n.content.trim();
      n.title = title; n.content = (head + u).slice(0, 200_000); return id;
    }
    const id = 'note-' + ++this.n; this.notes.set(id, { user_id: uid, title, content: head, topic: t }); this.links.set(key, id); return id;
  }
  async setStatus(t: string, p: Record<string, unknown>) { this.status[t] = { ...(this.status[t] || {}), ...p }; }
  deleteNote(id: string) { this.notes.delete(id); for (const [k, v] of this.links) if (v === id) this.links.set(k, null); }
}
