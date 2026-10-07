// Web Push không cần thư viện: mã hoá RFC 8291 (aes128gcm, RFC 8188) + VAPID RFC 8292 (ES256). Chỉ dùng WebCrypto → chạy được trên Deno và Node.
const subtle = globalThis.crypto.subtle;
const te = new TextEncoder();
export const b64u = {
  enc(buf) { const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf); let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
  dec(str) { const s = atob(String(str).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(str).length + 3) % 4)); return Uint8Array.from(s, c => c.charCodeAt(0)); },
};
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
async function hmac(key, data) { const k = await subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return new Uint8Array(await subtle.sign('HMAC', k, data)); }
/** JWK (EC P-256) từ khoá công khai dạng thô 65 byte (+ d tuỳ chọn) */
export function p256Jwk(pubRaw, d) {
  const j = { kty: 'EC', crv: 'P-256', x: b64u.enc(pubRaw.slice(1, 33)), y: b64u.enc(pubRaw.slice(33, 65)), ext: true };
  if (d) j.d = typeof d === 'string' ? d : b64u.enc(d);
  return j;
}
/**
 * Mã hoá nội dung push cho một subscription.
 * @param {{p256dh:string, auth:string}} sub   khoá của trình duyệt (base64url)
 * @param {Uint8Array} plaintext
 * @param {{senderPrivate?:string, senderPublic?:string, salt?:Uint8Array}} [fixed]  chỉ dùng để kiểm thử với vector RFC
 */
export async function encryptPayload(sub, plaintext, fixed = {}) {
  const uaPub = b64u.dec(sub.p256dh), authSecret = b64u.dec(sub.auth);
  if (uaPub.length !== 65 || authSecret.length < 16) throw new Error('subscription keys không hợp lệ');
  let asPriv, asPub;
  if (fixed.senderPrivate) {
    asPub = b64u.dec(fixed.senderPublic);
    asPriv = await subtle.importKey('jwk', p256Jwk(asPub, fixed.senderPrivate), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  } else {
    const kp = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    asPriv = kp.privateKey; asPub = new Uint8Array(await subtle.exportKey('raw', kp.publicKey));
  }
  const uaKey = await subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: uaKey }, asPriv, 256));
  const prkKey = await hmac(authSecret, ecdh);
  const ikm = (await hmac(prkKey, cat(te.encode('WebPush: info\0'), uaPub, asPub, new Uint8Array([1])))).slice(0, 32);
  const salt = fixed.salt || globalThis.crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, cat(te.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, cat(te.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);
  const key = await subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, cat(plaintext, new Uint8Array([2]))));
  const rs = 4096, hdr = new Uint8Array(21); hdr.set(salt, 0); new DataView(hdr.buffer).setUint32(16, rs); hdr[20] = 65;
  return cat(hdr, asPub, ct);
}
/** Header Authorization VAPID: "vapid t=<JWT ES256>, k=<khoá công khai>" */
export async function vapidAuth(endpoint, { publicKey, privateKey, subject }, ttlSec = 12 * 3600) {
  const aud = new URL(endpoint).origin;
  const enc = o => b64u.enc(te.encode(JSON.stringify(o)));
  const unsigned = enc({ typ: 'JWT', alg: 'ES256' }) + '.' + enc({ aud, exp: Math.floor(Date.now() / 1000) + ttlSec, sub: subject });
  const k = await subtle.importKey('jwk', p256Jwk(b64u.dec(publicKey), privateKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, k, te.encode(unsigned)));
  return `vapid t=${unsigned}.${b64u.enc(sig)}, k=${publicKey}`;
}
/**
 * Gửi một thông báo. Trả { ok, status, gone } — gone=true khi subscription hết hạn (404/410) nên xoá.
 */
export async function sendPush(sub, payload, vapid, { ttl = 86400, urgency = 'high', topic } = {}) {
  const body = await encryptPayload(sub, te.encode(typeof payload === 'string' ? payload : JSON.stringify(payload)));
  const headers = { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: String(ttl), Urgency: urgency, Authorization: await vapidAuth(sub.endpoint, vapid) };
  if (topic) headers.Topic = topic;
  const r = await fetch(sub.endpoint, { method: 'POST', headers, body });
  const text = r.ok ? '' : (await r.text().catch(() => '')).slice(0, 300);
  return { ok: r.ok, status: r.status, gone: r.status === 404 || r.status === 410, text };
}
