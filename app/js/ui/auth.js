// Màn hình đăng nhập / đăng ký / quên mật khẩu, và hộp đặt mật khẩu mới (Supabase PASSWORD_RECOVERY).
import { esc, toast } from '../util.js';
import { icon } from '../icons.js';
import { openModal } from './dialogs.js';

export function renderAuth(root, app) {
  const s = app.appSettings, demo = app.data?.mode === 'demo';
  let mode = 'signin';
  const draw = () => {
    root.innerHTML = `<div class="auth">
      <section class="auth-art">
        <div class="brand">${app.logoHTML(s, 20)}<div><b>${app.wordmarkHTML(s.app_name)}</b></div></div>
        <h2>${esc(s.tagline || 'Nghĩ là ghi, cần là thấy')}</h2>
        <p>Ghi chú văn bản, hình ảnh, đường link và để AI tóm tắt ý chính — tự đồng bộ trên mọi thiết bị.</p>
        <div class="pts">
          <div class="pt"><span>${icon('clipboard', 18)}</span>Dán ảnh bằng Ctrl+V để lưu ngay</div>
          <div class="pt"><span>${icon('clock', 18)}</span>Biết từng dòng được viết lúc nào</div>
          <div class="pt"><span>${icon('ai', 18)}</span>AI rút ý chính từ đoạn văn hoặc link</div>
          <div class="pt"><span>${icon('cloud', 18)}</span>Đồng bộ tức thì giữa điện thoại và máy tính</div>
        </div>
      </section>
      <section class="auth-card"><div class="auth-box">
        ${mode === 'forgot' ? `
          <h1>Quên mật khẩu</h1><p class="sub">Nhập email đã đăng ký, chúng tôi sẽ gửi liên kết đặt lại mật khẩu.</p>
          <form data-f="forgot">
            <label class="field"><span class="lbl">Email</span><input class="inp" type="email" name="email" required autocomplete="email" placeholder="ban@example.com"></label>
            <div class="err-t" data-err hidden></div>
            <button class="btn pri" type="submit">${icon('mail', 16)}Gửi liên kết đặt lại</button>
          </form>
          <div class="auth-links"><button data-m="signin">${icon('left', 14)} Quay lại đăng nhập</button></div>`
        : `
          <h1>${mode === 'signin' ? 'Chào mừng trở lại' : 'Tạo tài khoản mới'}</h1>
          <p class="sub">${mode === 'signin' ? 'Đăng nhập để xem ghi chú của bạn.' : 'Chỉ cần email và mật khẩu.'}</p>
          <div class="auth-tabs" role="tablist"><button class="${mode === 'signin' ? 'on' : ''}" data-m="signin" role="tab">Đăng nhập</button><button class="${mode === 'signup' ? 'on' : ''}" data-m="signup" role="tab">Đăng ký</button></div>
          <form data-f="${mode}">
            <label class="field"><span class="lbl">Email</span><input class="inp" type="email" name="email" required autocomplete="email" placeholder="ban@example.com"></label>
            <label class="field"><span class="lbl">Mật khẩu</span><div class="inpw">${icon('lock', 16)}<input class="inp" type="password" name="password" required minlength="6" autocomplete="${mode === 'signin' ? 'current-password' : 'new-password'}" placeholder="Ít nhất 6 ký tự"><div class="ia"><button type="button" class="ib" data-eye title="Hiện/ẩn mật khẩu">${icon('eye', 17)}</button></div></div></label>
            ${mode === 'signup' && demo ? `<label class="chk"><input type="checkbox" name="seed" checked> Thêm vài ghi chú mẫu để xem thử</label>` : ''}
            <div class="err-t" data-err hidden></div>
            <button class="btn pri" type="submit">${mode === 'signin' ? 'Đăng nhập' : 'Tạo tài khoản'}</button>
          </form>
          <div class="auth-links">${mode === 'signin' ? `<button data-m="forgot">Quên mật khẩu?</button><button data-m="signup">Chưa có tài khoản? Đăng ký</button>` : `<span></span><button data-m="signin">Đã có tài khoản? Đăng nhập</button>`}</div>`}
        ${demo ? `<div class="demo-note">${icon('info', 16)}<div><b>Chế độ demo</b> — chưa cấu hình Supabase nên tài khoản và ghi chú chỉ lưu trong trình duyệt này. Điền <code>SUPABASE_URL</code> và <code>SUPABASE_ANON_KEY</code> trong <code>config.js</code> để dùng thật.</div></div>` : ''}
      </div></section></div>`;
    const f = root.querySelector('form');
    setTimeout(() => f?.querySelector('input')?.focus(), 30);
  };
  draw();
  root.onclick = e => {
    const m = e.target.closest('[data-m]'); if (m) { mode = m.dataset.m; draw(); return; }
    const eye = e.target.closest('[data-eye]');
    if (eye) { const i = eye.closest('.inpw').querySelector('input'); i.type = i.type === 'password' ? 'text' : 'password'; eye.innerHTML = icon(i.type === 'password' ? 'eye' : 'eyeoff', 17); }
  };
  root.onsubmit = async e => {
    e.preventDefault();
    const f = e.target, fd = new FormData(f), err = f.querySelector('[data-err]'), btn = f.querySelector('[type=submit]');
    const email = String(fd.get('email') || '').trim(), password = String(fd.get('password') || '');
    err.hidden = true; btn.disabled = true; const old = btn.innerHTML; btn.innerHTML = '<span class="spin" style="width:16px;height:16px;border-color:rgba(255,255,255,.4);border-top-color:#fff"></span>';
    try {
      if (f.dataset.f === 'signin') await app.data.auth.signIn({ email, password });
      else if (f.dataset.f === 'signup') {
        if (app.appSettings.allow_signup === false) throw new Error('Quản trị viên đang tắt đăng ký tài khoản mới.');
        const r = await app.data.auth.signUp({ email, password, seed: fd.get('seed') === 'on' });
        if (r.needsConfirm) { toast('Đã gửi email xác nhận — hãy mở thư rồi đăng nhập', { kind: 'info', ms: 8000 }); mode = 'signin'; draw(); return; }
      } else if (f.dataset.f === 'forgot') {
        await app.data.auth.resetPassword(email);
        toast('Đã gửi liên kết đặt lại mật khẩu tới ' + email, { kind: 'info', ms: 7000 }); mode = 'signin'; draw(); return;
      }
    } catch (ex) {
      err.textContent = ex.message; err.hidden = false;
    }
    if (btn.isConnected) { btn.disabled = false; btn.innerHTML = old; }
  };
}

/** Supabase gửi người dùng về app sau khi bấm liên kết đặt lại mật khẩu → cho nhập mật khẩu mới. */
export function showRecovery(app) {
  const m = openModal(`<div class="dlg" role="dialog" style="max-width:420px"><div class="dh"><h3>Đặt mật khẩu mới</h3></div>
    <form class="db" data-rf><label class="field"><span class="lbl">Mật khẩu mới</span><input class="inp" type="password" name="pw" minlength="6" required autofocus autocomplete="new-password"></label><div class="err-t" data-err hidden></div>
    <button class="btn pri" style="width:100%">Lưu mật khẩu</button></form></div>`, { dismissible: false });
  m.el.querySelector('[data-rf]').onsubmit = async e => {
    e.preventDefault();
    try { await app.data.auth.updatePassword(new FormData(e.target).get('pw')); toast('Đã đổi mật khẩu'); m.close(true); }
    catch (ex) { const er = m.el.querySelector('[data-err]'); er.textContent = ex.message; er.hidden = false; }
  };
}
