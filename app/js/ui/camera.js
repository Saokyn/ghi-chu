// Chụp ảnh cho ghi chú hình ảnh (Giai đoạn 8).
// - Điện thoại: <input type=file accept=image/* capture=environment> — mở thẳng camera sau của máy (ổn định nhất trên iOS/Android).
// - Máy tính (hoặc khi người dùng chọn "Camera trong app"): getUserMedia với nút đổi camera trước/sau.
// - Không mở được camera → quay về ô chọn ảnh/chụp ảnh của hệ điều hành.
import { icon } from '../icons.js';
import { toast } from '../util.js';
import { openModal } from './dialogs.js';

export const isTouchDevice = () => typeof matchMedia === 'function' && matchMedia('(pointer:coarse)').matches;
export const canLiveCamera = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && window.isSecureContext !== false;

/** Mở camera của hệ điều hành qua input capture. PHẢI gọi đồng bộ trong sự kiện bấm (iOS chặn nếu không). → File | null */
export function pickCapture({ facing = 'environment' } = {}) {
  return new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*'; inp.setAttribute('capture', facing); inp.hidden = true; inp.dataset.capture = '1';
    let done = false; const fin = f => { if (done) return; done = true; inp.remove(); resolve(f || null); };
    inp.addEventListener('change', () => fin(inp.files && inp.files[0]));
    inp.addEventListener('cancel', () => fin(null));
    document.body.appendChild(inp);
    inp.click();
  });
}

/** Camera trong app (getUserMedia). → File (JPEG) | null. */
export function openLiveCamera() {
  return new Promise(resolve => {
    let stream = null, facing = 'environment', done = false, devices = 0;
    const m = openModal(`<div class="dlg cam-dlg" role="dialog" aria-label="Chụp ảnh">
      <div class="dh"><div class="tic t-image">${icon('camera', 20)}</div><h3>Chụp ảnh</h3><button class="ib" data-c="x" title="Đóng">${icon('x', 18)}</button></div>
      <div class="cam-view"><video playsinline muted autoplay></video><div class="cam-msg" data-msg>Đang mở camera…</div></div>
      <div class="cam-bar"><button class="btn" data-c="x">Hủy</button><button class="cam-shot" data-c="shot" title="Chụp" aria-label="Chụp" disabled></button><button class="btn" data-c="flip" title="Đổi camera trước/sau">${icon('switchcam', 16)}<span>Đổi camera</span></button></div></div>`,
      { onClose: () => { stop(); if (!done) resolve(null); } });
    const v = m.el.querySelector('video'), msg = m.el.querySelector('[data-msg]'), shot = m.el.querySelector('[data-c=shot]'), flip = m.el.querySelector('[data-c=flip]');
    function stop() { if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; }
    async function start() {
      stop(); shot.disabled = true; msg.hidden = false; msg.textContent = 'Đang mở camera…';
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false });
        if (m.closed) return stop();
        v.srcObject = stream; v.classList.toggle('mirror', facing === 'user');
        await v.play().catch(() => {});
        msg.hidden = true; shot.disabled = false;
        try { devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput').length; } catch { devices = 0; }
        flip.hidden = devices === 1;
      } catch (e) {
        const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
        msg.innerHTML = `${denied ? 'Bạn chưa cho phép dùng camera.' : 'Không mở được camera trên thiết bị này.'}<br><button class="btn sm" data-c="native" style="margin-top:10px">${icon('upload', 14)}Dùng ô chọn ảnh / camera của máy</button>`;
      }
    }
    m.el.addEventListener('click', async e => {
      const b = e.target.closest('[data-c]'); if (!b) return;
      const c = b.dataset.c;
      if (c === 'x') return m.close();
      if (c === 'flip') { facing = facing === 'environment' ? 'user' : 'environment'; return start(); }
      if (c === 'native') { const p = pickCapture(); stop(); done = true; m.close(true); return resolve(await p); }
      if (c === 'shot' && stream) {
        const w = v.videoWidth, h = v.videoHeight; if (!w || !h) return;
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(v, 0, 0, w, h); // ảnh lưu không lật gương, kể cả camera trước
        const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.92));
        if (!blob) return toast('Không chụp được ảnh.', { kind: 'err' });
        done = true; stop(); m.close(true);
        resolve(new File([blob], `chup-${Date.now()}.jpg`, { type: 'image/jpeg' }));
      }
    });
    start();
  });
}

/** Nút "Chụp ảnh" thông minh: điện thoại → camera hệ điều hành; máy tính → camera trong app; không có camera → chọn file. */
export function takePhoto({ live = null } = {}) {
  const useLive = live ?? (!isTouchDevice() && canLiveCamera());
  return useLive ? openLiveCamera() : pickCapture();
}
