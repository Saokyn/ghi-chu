// Thư mục + phân tích gợi ý AI (JSON lộn xộn, think, fence, cắt cụt…)
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractJson, parseSuggestions, folderTree, folderCounts, inFolder, folderScope, batchNotes, buildSortMessages, snippetForAi, localSuggest, parseTags, findFolderByName, NONE } from '../app/js/folders.js';

const F = [
  { id: 'f1', name: 'Công việc', sort: 1 }, { id: 'f2', name: 'Tài chính', sort: 2 }, { id: 'f3', name: 'Sức khỏe', sort: 3 },
  { id: 'f4', name: 'Dự án A', sort: 1, parent_id: 'f1' },
];
const N = [
  { id: 'a', type: 'text', title: 'Họp sprint', content: 'deadline thứ 6' },
  { id: 'b', type: 'text', title: 'Thuế TNCN', content: 'nộp tờ khai trước 15/10' },
  { id: 'c', type: 'link', title: '', url: 'https://www.youtube.com/watch?v=x', link_meta: { title: 'Cách nấu phở' }, content: 'ninh xương 8 tiếng' },
];

test('extractJson: JSON sạch, fence, think, chữ thừa, dấu phẩy thừa, nháy cong, khoá không nháy, cắt cụt', () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJson('Đây là kết quả:\n```json\n{"a": [1,2,],}\n```\nHết.'), { a: [1, 2] });
  assert.deepEqual(extractJson('<think>suy nghĩ {"x":0}</think>{"ok":true}'), { ok: true });
  assert.deepEqual(extractJson('{\u201ca\u201d: \u201cb\u201d}'), { a: 'b' });
  assert.deepEqual(extractJson('{suggestions: [{id: "n1", folder: "X"}]}'), { suggestions: [{ id: 'n1', folder: 'X' }] });
  assert.deepEqual(extractJson('{"s":"có } ngoặc trong chuỗi","b":2}'), { s: 'có } ngoặc trong chuỗi', b: 2 });
  const cut = extractJson('{"suggestions":[{"id":"n1","folder":"A","reason":"x"},{"id":"n2","folder":"B","rea');
  assert.deepEqual(cut, { suggestions: [{ id: 'n1', folder: 'A', reason: 'x' }] });
  assert.equal(extractJson('không có json'), null);
});

test('parseSuggestions: ánh xạ n1..nN → ghi chú, thư mục có sẵn (không phân biệt dấu/hoa) hoặc thư mục mới', () => {
  const out = parseSuggestions(`<think>...</think>\`\`\`json
  {"suggestions":[
    {"id":"n1","folder":"cong viec","new":false,"reason":"Họp dự án"},
    {"id":"n2","folder":"TÀI CHÍNH","reason":"Thuế"},
    {"id":"n3","folder":"Nấu ăn","new":true,"reason":"Công thức món ăn"},
    {"id":"n9","folder":"Công việc"},
    {"id":"n1","folder":"Sức khỏe"},
    {"id":"x","folder":"Sức khỏe"}
  ]}\`\`\``, N, F);
  assert.deepEqual(out.map(s => [s.note_id, s.folder_id, s.new_name]), [['a', 'f1', null], ['b', 'f2', null], ['c', null, 'Nấu ăn']]);
  assert.equal(out[0].reason, 'Họp dự án');
});
test('parseSuggestions: mảng trần, dạng {n1:"..."}, đường dẫn "Cha › Con", bỏ gợi ý rỗng/Chưa phân loại', () => {
  assert.deepEqual(parseSuggestions('[{"id":1,"folder":"Công việc › Dự án A"}]', N, F).map(s => s.folder_id), ['f4']);
  assert.deepEqual(parseSuggestions('{"n1":"Tài chính","n2":"","n3":"Chưa phân loại"}', N, F).map(s => [s.note_id, s.folder_id]), [['a', 'f2']]);
  assert.deepEqual(parseSuggestions('xin lỗi tôi không biết', N, F), []);
});

test('folderTree / folderCounts / inFolder (lồng 1 cấp, thư mục đã xoá → chưa phân loại)', () => {
  assert.deepEqual(folderTree(F).map(f => [f.id, f.depth]), [['f1', 0], ['f4', 1], ['f2', 0], ['f3', 0]]);
  const notes = [{ folder_id: 'f1' }, { folder_id: 'f4' }, { folder_id: 'f2' }, { folder_id: null }, { folder_id: 'deleted' }];
  const c = folderCounts(notes, F);
  assert.deepEqual([c.f1, c.f4, c.f2, c.f3, c[NONE]], [2, 1, 1, 0, 2]);
  assert.deepEqual([...folderScope(F, 'f1')].sort(), ['f1', 'f4']);
  assert.equal(notes.filter(n => inFolder(n, 'f1', F)).length, 2);
  assert.equal(notes.filter(n => inFolder(n, NONE, F)).length, 2);
  assert.equal(notes.filter(n => inFolder(n, null, F)).length, 5);
  assert.equal(findFolderByName(F, '  sức   KHOẺ ')?.id ?? findFolderByName(F, 'suc khoe')?.id, 'f3');
});

test('batchNotes + buildSortMessages: chia lô, chỉ gửi chữ ngắn, mã n1..', () => {
  const many = Array.from({ length: 60 }, (_, i) => ({ id: 'id' + i, type: 'text', title: 'Ghi chú ' + i, content: 'x'.repeat(500) }));
  const b = batchNotes(many, { size: 25, chars: 5000 });
  assert.ok(b.length >= 3 && b.every(x => x.length <= 25)); assert.equal(b.flat().length, 60);
  const msgs = buildSortMessages(N, F);
  assert.match(msgs[1].content, /n1: Họp sprint/); assert.match(msgs[1].content, /n3: \[link\] Cách nấu phở · youtube\.com/);
  assert.match(msgs[1].content, /- Công việc\n  - Công việc › Dự án A/);
  assert.ok(!msgs[1].content.includes('id0') && !msgs[1].content.includes('"a"'));
  assert.ok(snippetForAi(many[0]).length < 260, 'đoạn trích ngắn');
  assert.ok(!snippetForAi({ type: 'image', title: 'Bảng trắng', image_path: 'data:image/png;base64,AAAA' }).includes('base64'), 'không gửi ảnh');
});

test('localSuggest + parseTags', () => {
  assert.equal(localSuggest(N[1], F)?.folder_id, 'f2');
  assert.equal(localSuggest({ title: 'Đo huyết áp', content: 'mạch 72' }, F)?.folder_id, 'f3');
  assert.equal(localSuggest({ title: 'abc', content: 'xyz' }, F), null);
  assert.deepEqual(parseTags('#Việc nhà, gấp; #gấp, du lịch'), ['việc-nhà', 'gấp', 'du-lịch']);
  assert.deepEqual(parseTags('#a #b'), ['a', 'b']);
});
