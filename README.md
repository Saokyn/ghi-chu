# Ghi Chú — ứng dụng ghi chú tiếng Việt

> **Nghĩ là ghi, cần là thấy.**

Web app ghi chú **tĩnh** (HTML/CSS/JS thuần, không cần build) chạy được trên **GitHub Pages**, dữ liệu lưu ở **Supabase** (Postgres + Auth + Storage + Realtime).
Khi chưa cấu hình Supabase, app tự chạy ở **chế độ demo**: mọi thứ lưu trong trình duyệt (localStorage), dùng thử đầy đủ tính năng.

**Tính năng**
- Đăng ký, đăng nhập, đăng xuất, quên mật khẩu.
- 4 loại ghi chú: **Văn bản**, **Hình ảnh** (tải lên hoặc dán bằng Ctrl+V), **Đường link** (tiêu đề, mô tả, ảnh xem trước), **AI tóm tắt** (dán đoạn văn hoặc URL, giữ lại nguồn).
- Tìm kiếm (không phân biệt dấu), ghim (mục "Đã ghim"), lọc theo loại, sao chép nhanh (toast "Đã sao chép").
- Thời gian **Tạo** / **Sửa** dạng `HH:mm dd/MM/yyyy` theo giờ Việt Nam.
- **Thời gian theo từng dòng**: mỗi dòng nhớ lần lưu nó thay đổi; bật/tắt bằng "Hiện thời gian theo dòng".
- **Màu ghi chú**: mỗi ghi chú có nền dịu + vạch nhấn đậm cùng tông (8 màu, tự động cố định theo ghi chú hoặc tự chọn trong trình soạn) để dễ dò tìm; chữ đạt WCAG AA trên mọi màu, sáng lẫn tối.
- **Mặt giấy đọc & soạn** dịu mắt, tách biệt màu giao diện (Giấy ấm / Sepia / Xanh dịu / Tối ấm; mặc định tự theo sáng/tối), chữ 17,5px, giãn dòng ~1,7, tối đa ~70 ký tự/dòng.
- 3 kiểu xem: **Danh sách**, **Lưới thẻ**, **Hai cột**; giao diện **sáng/tối**; giao diện điện thoại. Kiểu xem và chủ đề được nhớ theo từng người dùng.
- Đồng bộ tức thì: Supabase Realtime (chế độ Supabase) hoặc giữa các tab (chế độ demo).
- **Cài đặt → AI**: Grok (xAI), Intern AI, Cloudflare Workers AI (có Account ID), OpenAI-compatible tuỳ chỉnh, Gemini, Groq, OpenRouter, Intern Discovery; hiện/ẩn key, "Kiểm tra kết nối", "Tải danh sách model", proxy tự bật cho nhà cung cấp chặn CORS. Chưa có key thì vẫn tóm tắt được bằng thuật toán trích ý ngay trên máy.
- **Quản trị → Tùy chỉnh giao diện** (chỉ admin): tên app, khẩu hiệu, logo, màu chủ đạo, màu nhấn tối, phông chữ, bố cục và chủ đề mặc định, bo góc, mật độ, cho phép đăng ký… có **xem trước trực tiếp**; lưu vào `app_settings` và áp dụng cho mọi người. Kèm thống kê và danh sách người dùng.

---

## 1. Chạy trên máy

Cần Python 3 (hoặc bất kỳ web server tĩnh nào) — không cần cài gói gì.

```bash
cd notes-app
python3 -m http.server 5180 --directory app     # hoặc: npm run serve
```

Mở <http://localhost:5180/>. Khi `config.js` còn trống, app chạy chế độ demo:
- Đăng ký bằng email bất kỳ (chỉ lưu trong trình duyệt này, mật khẩu được băm SHA-256).
- Muốn thử trang quản trị: **Cài đặt → Tài khoản → "Bật quyền quản trị cho tài khoản này"**.
- Thêm `?demo=1` vào URL để ép chế độ demo kể cả khi đã cấu hình Supabase.
- Xoá dữ liệu demo: **Cài đặt → Đồng bộ & dữ liệu**.

> Không mở trực tiếp `index.html` bằng `file://` — trình duyệt chặn ES module. Hãy dùng web server như trên.

## 2. Cấu hình Supabase (khi đã có project)

Chỉ cần **hai giá trị** từ Supabase, điền vào `app/config.js`:

| Giá trị | Lấy ở đâu | Ví dụ |
|---|---|---|
| `SUPABASE_URL` — **Project URL** | Dashboard → nút **Connect** hoặc **Project Settings → Data API / API** | `https://abcdefghijklmno.supabase.co` |
| `SUPABASE_ANON_KEY` — **anon / publishable key** | **Project Settings → API Keys** (khoá *Publishable* `sb_publishable_…` hoặc khoá *anon* dạng JWT `eyJ…`) | `sb_publishable_…` |

```js
// app/config.js
export const SUPABASE_URL = 'https://abcdefghijklmno.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_xxxxxxxxxxxxxxxx';
```

Khoá anon/publishable là **khoá công khai** — được phép nằm trong mã web tĩnh, dữ liệu được bảo vệ bằng RLS.
**Tuyệt đối không** đặt khoá `service_role` / *secret* vào `config.js`.

Trong **Authentication → URL Configuration** đặt:
- **Site URL**: địa chỉ GitHub Pages, ví dụ `https://<tên-github>.github.io/<tên-repo>/`
- **Redirect URLs**: thêm địa chỉ trên và `http://localhost:5180/` (để link xác nhận email / đặt lại mật khẩu quay về đúng app).

## 3. Áp dụng `supabase/schema.sql`

Dashboard → **SQL Editor** → **New query** → dán toàn bộ nội dung `supabase/schema.sql` → **Run**.
File chạy lại nhiều lần không sao (idempotent). Nó tạo:

> **Cập nhật bản giao diện 2:** schema thêm cột `notes.color` (màu ghi chú, `NULL` = tự động) bằng
> `alter table … add column if not exists` + ràng buộc màu hợp lệ. Hãy **chạy lại toàn bộ `schema.sql`** một lần.
> Chưa chạy lại thì app vẫn hoạt động: màu được lưu tạm trên từng máy (localStorage) và chưa đồng bộ giữa các thiết bị.
> Khẩu hiệu mặc định mới (`Nghĩ là ghi, cần là thấy`) chỉ là giá trị mặc định cho dự án mới — dòng `app_settings`
> đang có **không bị đổi**; muốn dùng thì sửa ở **Quản trị → Tùy chỉnh giao diện → Khẩu hiệu**.

- `profiles` (+ trigger tự tạo khi đăng ký, cột `role`, `prefs` cho chủ đề/kiểu xem),
- `notes` (+ chỉ mục tìm kiếm toàn văn và trigram, trigger `updated_at`),
- `app_settings` (một dòng; ai cũng đọc được, chỉ admin ghi),
- `user_ai_settings` (cấu hình AI theo từng người; chỉ chủ sở hữu đọc/ghi — xem lưu ý bảo mật trong file),
- RLS cho tất cả bảng, hàm `is_admin()` (SECURITY DEFINER),
- bucket ảnh **riêng tư** `note-images`, mỗi người chỉ đọc/ghi trong thư mục `<user_id>/`,
- realtime cho `notes` và `app_settings`,
- RPC cho trang quản trị: `admin_stats()`, `admin_list_users()`, `admin_set_role()`.

## 4. Cấp quyền admin

Sau khi tài khoản đã đăng ký, chạy trong **SQL Editor**:

```sql
update public.profiles set role = 'admin' where email = 'ban@example.com';
```

Đăng xuất rồi đăng nhập lại (hoặc tải lại trang) → mục **Quản trị** xuất hiện ở thanh bên.
Người dùng thường không thể tự đổi `role` (chỉ được cấp quyền UPDATE cột `prefs`). Admin có thể cấp/bỏ quyền admin cho người khác ở **Quản trị → Người dùng** (luôn phải còn ít nhất một admin).

## 5. Edge Function `ai-proxy` (deploy sau)

`supabase/functions/ai-proxy/index.ts` làm 3 việc, luôn kiểm tra JWT người dùng trước:
- `chat` → chuyển tiếp `POST {base_url}/chat/completions` (OpenAI-compatible),
- `models` → `GET {base_url}/models` (Cloudflare: `/ai/models/search`),
- `fetch_url` → đọc nội dung chữ dễ đọc + og:title/description/image của một trang web (cho "Đường link" và "AI tóm tắt" từ URL).

Có chặn SSRF (chỉ http/https công khai, chặn IP nội bộ, kiểm tra lại sau mỗi lần chuyển hướng), giới hạn thời gian và dung lượng, CORS.
Nếu request không kèm key, function dùng key đã đồng bộ trong `user_ai_settings` của chính người gọi.

Khi muốn bật (cần [Supabase CLI](https://supabase.com/docs/guides/cli)):

```bash
supabase login
supabase functions deploy ai-proxy --project-ref <PROJECT_REF>
# (tuỳ chọn) chỉ cho phép gọi từ trang GitHub Pages của bạn:
supabase secrets set ALLOWED_ORIGIN=https://<tên-github>.github.io --project-ref <PROJECT_REF>
```

`SUPABASE_URL` và `SUPABASE_ANON_KEY` được Supabase tự cung cấp cho function. Không đặt `ALLOW_FAKE_IP_DNS` khi deploy (biến này chỉ để chạy thử ở máy có DNS giả lập).
Chưa deploy thì: Grok/Gemini/Groq/OpenRouter… vẫn gọi thẳng từ trình duyệt được; Intern AI và Cloudflare (chặn CORS) cần function này; đọc nội dung link sẽ báo lỗi thân thiện và cho nhập tay.

## 6. Deploy GitHub Pages (sau này)

Mọi đường dẫn trong app đều **tương đối**, nên chạy được ở `https://<tên-github>.github.io/<tên-repo>/`.
Có sẵn workflow `.github/workflows/pages.yml`:
1. Push repo lên GitHub (nhánh `main`).
2. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Mỗi lần push, workflow chạy unit test rồi đăng thư mục `app/` lên Pages.

(Hoặc đơn giản: Pages → Deploy from a branch, chọn thư mục chứa nội dung `app/`.) File `app/.nojekyll` giữ nguyên các thư mục như `vendor/`.

## 7. Kiểm thử

```bash
npm test                               # unit test quy tắc thời gian theo dòng + định dạng ngày (node --test)
npm run serve &                        # phục vụ app ở cổng 5180
node tests/e2e/run.mjs                 # E2E chế độ demo bằng Chrome (playwright-core), chụp ảnh vào out/app/
node tests/e2e/supabase-mode.mjs       # chạy app ở chế độ Supabase với máy chủ GIẢ (không ra Internet)
SB_MISSING_COLOR=1 node tests/e2e/supabase-mode.mjs   # như trên nhưng giả lập DB CHƯA có cột notes.color
node tests/e2e/v2-shots.mjs            # giao diện 2: kiểm tra tương phản AA, lề thời gian thẳng hàng, chụp ảnh vào out/v2/
node tests/tools/render-logos.mjs      # xuất lại logo-concepts.png + biểu tượng PNG (favicon, apple-touch, 192/512)
# RLS trên Postgres cục bộ (cần psql):
#   psql -d test -f tests/sql/supabase_stub.sql -f supabase/schema.sql -f tests/sql/rls_test.sql
# Nâng cấp lên cột màu: xem đầu tệp tests/sql/upgrade_color_test.sql
```

E2E dùng `/usr/bin/google-chrome`; đổi đường dẫn trong `tests/e2e/*.mjs` nếu máy bạn khác.

## 8. Quy tắc "thời gian theo dòng"

Nằm trong `app/js/lineTimes.js` (module thuần, có unit test):
- Mỗi ghi chú lưu `line_times = [{ text, t }]`.
- Khi lưu, so sánh từng dòng mới với các dòng cũ sau khi **chuẩn hoá**: bỏ khoảng trắng và dấu câu (giữ chữ hoa/thường, dấu tiếng Việt). Ví dụ `123`, `1 2 3`, `123,`, `- 123` coi là cùng một dòng → giữ thời gian cũ; `1234` là dòng khác → thời gian mới.
- Ghép theo **LCS** (giữ thứ tự), sau đó ghép bổ sung các dòng bị di chuyển; mỗi dòng cũ chỉ được dùng **một lần** (dòng trùng nhau không "ăn" chung một thời gian).
- Dòng chưa lưu hiển thị "chưa lưu"; lưu xong nhận thời điểm lưu; `updated_at` của ghi chú luôn cập nhật khi lưu.

## 9. Logo, khẩu hiệu, bảng màu

- **Logo "Trang ghi có dấu giờ"**: tờ giấy gấp góc, mỗi dòng có chấm thời gian (xanh = đã lưu, vàng = chưa lưu) — nói đúng tính năng riêng của app. Trong app, nền logo theo **màu chủ đạo** quản trị chọn; favicon/biểu tượng ứng dụng dùng màu mặc định `#4f46e5`. Quản trị vẫn có thể tải logo riêng.
- **Khẩu hiệu mặc định**: *Nghĩ là ghi, cần là thấy* (phương án khác: *Ghi nhanh · nhớ lâu*, *Ghi gọn, tìm nhanh, nhớ lâu*, *Mỗi dòng một dấu thời gian*).
- **Bảng màu** (`app/js/palette.js`): Bạc hà, Trời xanh, Oải hương, Hồng phấn, Đào, Vàng bơ, Rêu non, Xám đá — mỗi màu có bộ sáng (nền nhạt) và bộ tối (sắc trầm), unit test bảo đảm chữ ≥ 4.5:1.

## 10. Cấu trúc thư mục

```
app/                    ← toàn bộ web tĩnh (deploy thư mục này)
  index.html, config.js
  css/                  app.css (sáng/tối, responsive), fonts.css
  fonts/, img/, vendor/supabase.js (supabase-js v2 UMD)
  js/main.js            khởi động, định tuyến (#/, #/cai-dat/…, #/quan-tri/…), trạng thái
  js/lineTimes.js       quy tắc thời gian theo dòng (thuần)
  js/palette.js         bảng màu ghi chú + mặt giấy (nguồn duy nhất; CSS sinh từ đây; unit test kiểm tra AA)
  js/logo.js            logo SVG nội tuyến (theo màu chủ đạo) + chữ logo
  img/logo/             icon.svg, favicon.svg, PNG 32/180/192/512 (+maskable), 3 phương án logo
  manifest.webmanifest  tên, màu, biểu tượng khi "Thêm vào màn hình chính"
  js/format.js          định dạng giờ Việt Nam
  js/data/              index.js (chọn adapter), local.js (demo), supabase.js
  js/ai/                providers.js, client.js, localSummary.js
  js/ui/                notes, editor, dialogs, auth, settings, admin
supabase/schema.sql     schema + RLS + storage + realtime + RPC
supabase/functions/ai-proxy/index.ts
tests/                  unit test, E2E, kiểm thử RLS
```

## 11. Lưu ý bảo mật

- Dữ liệu được bảo vệ bằng **RLS**: mỗi người chỉ thấy ghi chú, ảnh và cấu hình AI của mình; admin cũng **không** đọc được ghi chú hay key của người khác.
- **API key AI** mặc định chỉ lưu trên máy (localStorage). Nếu bật "Đồng bộ key giữa các thiết bị", key được lưu trong bảng `user_ai_settings` (RLS chỉ chủ sở hữu) — người có quyền quản trị project Supabase (service_role) vẫn đọc được. Cần chặt hơn thì mã hoá bằng Supabase Vault và chỉ giải mã trong Edge Function.
- Ảnh nằm trong bucket riêng tư, hiển thị bằng signed URL có hạn 1 giờ.
