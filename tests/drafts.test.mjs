import test from 'node:test';
import assert from 'node:assert/strict';
import { saveDraft, loadDraft, clearDraft, draftDiffers, listNewDrafts, draftIdFor, draftKey } from '../app/js/drafts.js';

function mem() { const m = new Map(); return { get length() { return m.size; }, key: i => [...m.keys()][i] ?? null, getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m }; }

test('lưu / đọc / xoá bản nháp theo người dùng + ghi chú', () => {
  const s = mem();
  assert.equal(draftIdFor('n1', 'x'), 'n1'); assert.equal(draftIdFor(null, 'x'), 'new.x');
  saveDraft('u1', 'n1', { type: 'text', title: 'Chợ', content: 'mua rau\nmua cá', base: '2026-10-01T00:00:00Z' }, s);
  const d = loadDraft('u1', 'n1', s);
  assert.equal(d.content, 'mua rau\nmua cá'); assert.equal(d.base, '2026-10-01T00:00:00Z'); assert.equal(d.url, '');
  assert.equal(loadDraft('u2', 'n1', s), null, 'người dùng khác không thấy');
  assert.ok(s._m.has(draftKey('u1', 'n1')));
  clearDraft('u1', 'n1', s); assert.equal(loadDraft('u1', 'n1', s), null);
});
test('draftDiffers so với bản đã lưu', () => {
  assert.equal(draftDiffers(null, {}), false);
  assert.equal(draftDiffers({ title: 'a', content: 'b', url: '' }, { title: 'a', content: 'b', url: null }), false);
  assert.equal(draftDiffers({ title: 'a', content: 'b2', url: '' }, { title: 'a', content: 'b' }), true);
  assert.equal(draftDiffers({ title: ' ', content: '', url: '' }, null), false);
  assert.equal(draftDiffers({ title: '', content: 'x', url: '' }, null), true);
});
test('listNewDrafts: chỉ ghi chú mới, mới nhất trước, dọn bản rỗng/quá cũ/hỏng', () => {
  const s = mem(), now = Date.parse('2026-10-17T12:00:00Z');
  saveDraft('u1', 'new.a', { content: 'A', at: '2026-10-17T10:00:00Z' }, s);
  saveDraft('u1', 'new.b', { content: 'B', at: '2026-10-17T11:00:00Z' }, s);
  saveDraft('u1', 'new.c', { content: '  ', at: '2026-10-17T11:30:00Z' }, s);
  saveDraft('u1', 'new.old', { content: 'cũ', at: '2026-08-01T00:00:00Z' }, s);
  saveDraft('u1', 'n9', { content: 'đã lưu' }, s);
  saveDraft('u2', 'new.z', { content: 'Z' }, s);
  s.setItem(draftKey('u1', 'new.bad'), '{oops');
  const l = listNewDrafts('u1', s, now);
  assert.deepEqual(l.map(x => x.id), ['new.b', 'new.a']);
  assert.equal(s.getItem(draftKey('u1', 'new.c')), null); assert.equal(s.getItem(draftKey('u1', 'new.old')), null); assert.equal(s.getItem(draftKey('u1', 'new.bad')), null);
  assert.ok(s.getItem(draftKey('u1', 'n9')) && s.getItem(draftKey('u2', 'new.z')));
});
test('bộ nhớ đầy → không ném lỗi', () => {
  const s = mem(); s.setItem = () => { throw new Error('QuotaExceeded'); };
  assert.equal(saveDraft('u', 'n', { content: 'x' }, s), false);
});
