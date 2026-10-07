// Kiểm thử LIVE pha 3 trên GitHub Pages với tài khoản admin: thư mục (mẫu/RPC, tạo, kéo-thả, chuyển, lọc), 1 lần “AI sắp xếp” thật bằng AI dùng chung
// trên các ghi chú thử tạm thời (chỉ các ghi chú thử được chọn), chip gợi ý, RLS. Dọn sạch, không đổi prefs, đăng xuất. Không in mật khẩu/email/khoá.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const LIVE = process.env.LIVE || 'https://saokyn.github.io/ghi-chu/';
const OUT = new URL('../../out/live/', import.meta.url).pathname; fs.mkdirSync(OUT, { recursive: true });
const PW = fs.readFileSync(new URL('../../.test-password', import.meta.url), 'utf8').trim();
let ok = true; const check = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) ok = false; };
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const ctx = await b.newContext({ viewport: { width: 1280, height: 860 }, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' });
const p = await ctx.newPage(); p.setDefaultTimeout(20000);
const errs = []; p.on('pageerror', e => errs.push(e.message));
const TAG = '[KT3 ' + Date.now().toString(36) + ']';
const A = (fn, arg) => p.evaluate(fn, arg);
const hide = () => A(() => document.querySelector('#toast')?.classList.remove('show'));
let base = null, made = { notes: [] }, entered = false;
try {
  await p.goto(LIVE); await p.waitForSelector('.auth');
  await p.fill('input[name=email]', process.env.TEST_EMAIL); await p.fill('input[name=password]', PW);
  await p.click('form button[type=submit]'); await p.waitForSelector('#content .head'); entered = true;
  check(await A(() => window.__app.user.role) === 'admin', 'đăng nhập live bằng tài khoản admin');
  base = await A(async () => { const a = window.__app; return { uid: a.user.id, prefs: await a.data.prefs.get(), folders: (await a.data.folders.list()).map(f => f.id), notes: a.notes.length, shared: a.sharedAi && { provider: a.sharedAi.provider, model: a.sharedAi.model, left: Math.min(a.sharedAi.limit_hour - a.sharedAi.used_hour, a.sharedAi.limit_day - a.sharedAi.used_day) } }; });
  fs.writeFileSync('/tmp/p3base.json', JSON.stringify({ uid: base.uid, folders: base.folders, tag: TAG }), { mode: 0o600 });
  console.log(`    trước: ${base.folders.length} thư mục, ${base.notes} ghi chú · AI chung: ${base.shared?.provider}/${base.shared?.model} · còn ${base.shared?.left} lượt`);
  // 1) Thư mục mẫu (RPC create_template_folders) — chỉ khi tài khoản chưa có thư mục
  if (!base.folders.length) {
    check(await p.locator('.side [data-fact=tpl]').count() === 1, 'chưa có thư mục → nút “Tạo thư mục mẫu”');
    await p.click('.side [data-fact=tpl]'); await p.waitForFunction(() => window.__app.folders.length >= 5, null, { timeout: 15000 });
    check(await A(() => window.__app.folders.map(f => f.name).join(',')) === 'Công việc,Cá nhân,Tài chính,Sức khỏe,Ý tưởng', 'tạo 5 thư mục mẫu (RPC, theo bảng folder_templates)');
  }
  // thư mục thử riêng (+ con)
  const tf = await A(async TAG => { const a = window.__app; const f = await a.data.folders.create({ name: TAG + ' Thư mục', color: 'peach', icon: '🧪' }); const c = await a.data.folders.create({ name: 'Con', parent_id: f.id }); await a.reloadFolders(); return { f: f.id, c: c.id }; }, TAG);
  const dupErr = await A(async TAG => { try { await window.__app.data.folders.create({ name: ' ' + TAG.toUpperCase() + ' thư MỤC ' }); return 'không lỗi'; } catch (e) { return e.message; } }, TAG);
  check(/Đã có thư mục/.test(dupErr), 'máy chủ chặn trùng tên cùng cấp (unique, không phân biệt hoa thường): ' + dupErr);
  const nest = await A(async c => { try { await window.__app.data.folders.create({ name: 'Cháu', parent_id: c }); return 'không lỗi'; } catch (e) { return e.message; } }, tf.c);
  check(nest !== 'không lỗi', 'máy chủ chặn lồng quá 1 cấp: ' + nest.slice(0, 80));
  // 2) Ghi chú thử
  const ids = await A(async TAG => {
    const a = window.__app, out = [];
    for (const [t, c] of [['Hoá đơn tiền điện tháng 9', '450.000đ, hạn thanh toán 15/10, chuyển khoản qua ngân hàng'], ['Họp dự án website khách hàng', 'Chuẩn bị báo cáo tiến độ sprint, demo thứ Hai'], ['Lịch tái khám huyết áp', 'Uống thuốc đều, đo huyết áp sáng tối, tái khám 20/10'], ['Ý tưởng app học từ vựng', 'Flashcard + nhắc ôn tập theo đường cong lãng quên']])
      out.push((await a.createNote({ title: TAG + ' ' + t, content: c, type: 'text' })).id);
    return out;
  }, TAG);
  made.notes.push(...ids);
  check(ids.length === 4, 'tạo 4 ghi chú thử tạm thời');
  // 3) Kéo-thả + Chuyển vào thư mục + lọc
  await p.reload(); await p.waitForSelector('#content .head'); await p.waitForTimeout(500);
  await hide(); await p.dragAndDrop(`#region [data-open="${ids[3]}"]`, `.side [data-fdrop="${tf.f}"]`); await p.waitForTimeout(800);
  check(await A(id => window.__app.data.notes.list().then(l => l.find(n => n.id === id)?.folder_id), ids[3]) === tf.f, 'kéo-thả vào thư mục thử → lưu trên máy chủ');
  await p.hover(`#region [data-open="${ids[3]}"]`); await p.click(`#region [data-open="${ids[3]}"] [data-act=move]`); await p.waitForSelector('.fdlg .fmlist');
  await p.click(`.fdlg [data-to="${tf.c}"]`); await p.waitForSelector('.fdlg', { state: 'detached' }); await p.waitForTimeout(600);
  check(await A(id => window.__app.data.notes.list().then(l => l.find(n => n.id === id)?.folder_id), ids[3]) === tf.c, '“Chuyển vào thư mục” → thư mục con');
  await p.click(`.side [data-folder="${tf.f}"]`); await p.waitForTimeout(300);
  check(await p.locator('#region [data-open]').count() === 1, 'lọc thư mục cha: thấy ghi chú trong thư mục con');
  await p.screenshot({ path: OUT + 'p3-folder-filter-live.png' });
  await p.click(`.side [data-folder="${tf.f}"]`); await p.waitForTimeout(200);
  await A(() => { const ai = window.__app.ai, orig = ai.chat; window.__aiLog = []; ai.chat = async (...a) => { const t = Date.now(); try { const o = await orig(...a); window.__aiLog.push({ ok: true, ms: Date.now() - t, max: a[2]?.maxTokens, len: o.length, think: /<think>/i.test(o), tail: o.replace(/<think>[\s\S]*?(<\/think>|$)/i, '').trim().slice(-160) }); return o; } catch (e) { window.__aiLog.push({ ok: false, ms: Date.now() - t, err: e.message }); throw e; } }; });
  // 4) AI sắp xếp thật (AI dùng chung) — chỉ 3 ghi chú thử chưa phân loại
  const sel = ids.slice(0, 3);
  await A(async sel => { const m = await import('./js/ui/folders.js'); m.openAiSort(window.__app, { ids: sel }); }, sel);
  await p.waitForSelector('.aisort [data-s=go]');
  check(await p.locator('.aisort .scope.on', { hasText: 'Đã chọn' }).count() === 1 && (await p.textContent('.aisort')).includes('AI dùng chung'), 'hộp AI sắp xếp: phạm vi “Đã chọn” (3), dùng AI dùng chung');
  await p.screenshot({ path: OUT + 'p3-aisort-start-live.png' });
  const t0 = Date.now();
  await p.click('.aisort [data-s=go]'); await p.waitForSelector('.aisort .suglist, .aisort .empty, .aisort .callout.warn', { timeout: 150000 });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const rows = await p.locator('.aisort .sug').count();
  const warn = await p.locator('.aisort .callout.warn').count() ? await p.textContent('.aisort .callout.warn') : '';
  const sugs = await p.$$eval('.aisort .sug', els => els.map(e => ({ t: e.querySelector('.sgb b').textContent.slice(0, 50), to: e.querySelector('[data-tgt] option:checked').textContent, why: e.querySelector('.sgb small')?.textContent.trim() || '' })));
  console.log(`    AI trả lời sau ${secs}s: ${rows} gợi ý${warn ? ' · cảnh báo: ' + warn.trim().slice(0, 120) : ''}`);
  for (const s of sugs) console.log(`      · ${s.t.replace(TAG, '').trim()} → ${s.to.trim()}  (${s.why})`);
  check(rows >= 2, 'AI dùng chung trả về JSON gợi ý hợp lệ cho ≥2/3 ghi chú');
  check(await A(sel => window.__app.data.notes.list().then(l => sel.every(id => !l.find(n => n.id === id).folder_id)), sel), 'chưa chuyển gì trước khi bấm “Áp dụng đã chọn”');
  await p.screenshot({ path: OUT + 'p3-aisort-review-live.png' });
  // bỏ chọn dòng cuối, áp dụng phần còn lại
  const before = await A(() => window.__app.folders.map(f => f.id));
  const lastRow = p.locator('.aisort .sug').last(); await lastRow.locator('[data-ck]').uncheck();
  const skipped = await A(r => r, await lastRow.evaluate(e => e.querySelector('.sgb b').textContent));
  const picks = await p.$$eval('.aisort .sug', els => els.filter(e => e.querySelector('[data-ck]').checked).map(e => e.querySelector('[data-tgt]').value));
  await p.click('.aisort [data-s=apply]'); await p.waitForSelector('.aisort', { state: 'detached', timeout: 30000 }); await p.waitForTimeout(800);
  const after = await A(async sel => { const l = await window.__app.data.notes.list(); return sel.map(id => { const n = l.find(x => x.id === id); return { t: n.title, f: n.folder_id }; }); }, sel);
  const moved = after.filter(x => x.f).length;
  check(moved === picks.filter(v => v).length, `áp dụng: ${moved} ghi chú đã chuyển đúng số đã chọn`);
  check(!after.find(x => x.t === skipped)?.f, 'dòng bị bỏ chọn giữ nguyên Chưa phân loại');
  const newF = (await A(() => window.__app.folders.map(f => ({ id: f.id, name: f.name })))).filter(f => !before.includes(f.id));
  if (newF.length) console.log('    thư mục mới do AI đề xuất (sẽ xoá khi dọn):', newF.map(f => f.name).join(', '));
  await p.screenshot({ path: OUT + 'p3-after-sort-live.png' });
  // 5) Chip gợi ý khi lưu ghi chú mới (1 lần gọi AI)
  await A(() => window.__app.newNote('text')); await p.waitForSelector('.editor-dlg .title-in');
  await p.fill('.editor-dlg .title-in', TAG + ' Mua thuốc hạ sốt cho bé'); await p.fill('.editor-dlg .ta', 'Paracetamol, nhiệt kế, oresol');
  await p.keyboard.press('Control+s'); await p.waitForFunction(() => window.__app.modalEditor?.noteId(), null, { timeout: 20000 });
  made.notes.push(await A(() => window.__app.modalEditor.noteId()));
  const chip = await p.waitForSelector('.editor-dlg .fsug:not([hidden])', { timeout: 90000 }).then(() => true).catch(() => false);
  check(chip, 'chip “Gợi ý: …” hiện sau khi lưu ghi chú mới' + (chip ? ': ' + (await p.textContent('.editor-dlg .fsug')).replace(/\s+/g, ' ').replace('Chuyển', '').trim() : ''));
  await p.screenshot({ path: OUT + 'p3-suggest-chip-live.png' });
  console.log('    nhật ký AI:', JSON.stringify(await A(() => window.__aiLog)).replaceAll(TAG, '[TAG]'));
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  // 6) RLS
  const rls = await A(async ({ f }) => {
    const cfg = await import('./config.js'); const url = window.__app.data.client.supabaseUrl;
    const anon = await fetch(url + '/rest/v1/folders?select=id,name', { headers: { apikey: cfg.SUPABASE_ANON_KEY } }); const at = await anon.text();
    const anonT = await fetch(url + '/rest/v1/folder_templates?select=name', { headers: { apikey: cfg.SUPABASE_ANON_KEY } }); const tt = await anonT.text();
    const sb = window.__app.data.client;
    const bad = await sb.from('notes').insert({ user_id: window.__app.user.id, title: 'x', folder_id: crypto.randomUUID() }).select('id');
    const steal = await sb.from('folders').update({ user_id: crypto.randomUUID() }).eq('id', f).select('user_id').single();
    return { anon: [anon.status, at.slice(0, 40)], tpl: [anonT.status, tt.slice(0, 40)], bad: bad.error?.message || 'inserted:' + JSON.stringify(bad.data), owner: steal.data?.user_id === window.__app.user.id };
  }, tf);
  check(rls.anon[0] === 401 || rls.anon[1] === '[]', 'khách (anon) không đọc được thư mục: ' + rls.anon.join(' '));
  check(rls.tpl[0] === 401 || rls.tpl[1] === '[]', 'khách (anon) không đọc được thư mục mẫu: ' + rls.tpl.join(' '));
  check(!rls.bad.startsWith('inserted'), 'không gắn ghi chú vào thư mục không thuộc về mình: ' + rls.bad.slice(0, 90));
  check(rls.owner, 'không đổi chủ thư mục được (trigger giữ user_id)');
  // 7) Quản trị › Thư mục mẫu (chỉ xem)
  await p.goto(LIVE + '#/quan-tri/thu-muc-mau'); await p.waitForSelector('.tplr');
  check(await p.locator('.tplr').count() >= 5, 'Quản trị › Thư mục mẫu: ' + await p.locator('.tplr').count() + ' mẫu');
  await p.screenshot({ path: OUT + 'p3-templates-admin-live.png' });
  check(errs.length === 0, 'không có lỗi JS: ' + JSON.stringify(errs));
} catch (e) { console.error(e); ok = false; await p.screenshot({ path: '/tmp/p3-live-fail.png' }).catch(() => {}); }
// ---- Dọn dẹp
if (entered) {
  try {
    await p.goto(LIVE); await p.waitForSelector('#content'); await p.waitForTimeout(500);
    const left = await A(async ({ base, made, TAG }) => {
      const a = window.__app, sb = a.data.client;
      const ns = (await a.data.notes.list()).filter(n => made.notes.includes(n.id) || (n.title || '').startsWith(TAG));
      for (const n of ns) await a.data.notes.remove(n);
      const fs = (await a.data.folders.list()).filter(f => !base.folders.includes(f.id));
      for (const f of fs.filter(f => !f.parent_id)) await a.data.folders.remove(f.id);
      for (const f of fs.filter(f => f.parent_id)) await sb.from('folders').delete().eq('id', f.id);
      const prefsNow = await a.data.prefs.get();
      const prefsSame = JSON.stringify(prefsNow) === JSON.stringify(base.prefs);
      if (!prefsSame) await a.data.prefs.save(base.prefs);
      const remain = (await a.data.notes.list()).filter(n => (n.title || '').startsWith(TAG)).length;
      const fl = (await a.data.folders.list()).map(f => f.id);
      return { deletedNotes: ns.length, deletedFolders: fs.length, remain, foldersSame: JSON.stringify(fl.sort()) === JSON.stringify([...base.folders].sort()), prefsSame, notes: a.notes.length };
    }, { base, made, TAG });
    console.log('    dọn:', JSON.stringify(left));
    check(left.remain === 0 && left.foldersSame, 'đã xoá ghi chú thử + thư mục thử/mẫu/AI tạo; thư mục còn lại đúng như trước');
    check(left.prefsSame, 'prefs không đổi');
    await p.goto(LIVE + '#/cai-dat/tai-khoan'); await p.click('[data-s=signout]'); await p.click('.modal [data-c=yes]'); await p.waitForSelector('.auth');
    check(true, 'đã đăng xuất');
  } catch (e) { console.error('dọn lỗi', e); ok = false; }
}
await b.close();
console.log(ok ? 'LIVE P3: QUA' : 'LIVE P3: LỖI'); process.exit(ok ? 0 : 1);
