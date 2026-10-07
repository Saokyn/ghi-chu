// Mã hoá Web Push đúng vector RFC 8291 §5 + chữ ký VAPID kiểm chứng được.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { encryptPayload, vapidAuth, b64u, p256Jwk } from '../supabase/functions/_shared/webpush.js';

test('RFC 8291 §5: ra đúng thân thông điệp mẫu', async () => {
  const expected = 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN';
  const out = await encryptPayload(
    { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' },
    new TextEncoder().encode('When I grow up, I want to be a watermelon'),
    { senderPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', senderPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8', salt: b64u.dec('DGv6ra1nlYgDCS1FRnbzlw') });
  assert.equal(b64u.enc(out), expected);
  assert.equal(out.length, b64u.dec(expected).length); // 144 byte (header RFC ghi 145 nhưng thân mẫu giải mã ra 144)
});

test('VAPID JWT: ES256 kiểm chứng bằng khoá công khai, aud = origin', async () => {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)), d = (await crypto.subtle.exportKey('jwk', kp.privateKey)).d;
  const h = await vapidAuth('https://fcm.googleapis.com/fcm/send/abc', { publicKey: b64u.enc(pub), privateKey: d, subject: 'https://saokyn.github.io/ghi-chu/' });
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h); assert.ok(m);
  const claims = JSON.parse(new TextDecoder().decode(b64u.dec(m[2])));
  assert.equal(claims.aud, 'https://fcm.googleapis.com'); assert.ok(claims.exp > Date.now() / 1000);
  const vk = await crypto.subtle.importKey('jwk', p256Jwk(pub), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, vk, b64u.dec(m[3]), new TextEncoder().encode(m[1] + '.' + m[2])));
});

test('bản sao lunar.js / recur.js trong _shared khớp với app/js', () => {
  for (const f of ['lunar.js', 'recur.js'])
    assert.equal(fs.readFileSync(new URL('../supabase/functions/_shared/' + f, import.meta.url), 'utf8'), fs.readFileSync(new URL('../app/js/' + f, import.meta.url), 'utf8'), f);
});
