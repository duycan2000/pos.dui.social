# Dui Social POS — Handover

Last updated: 18/11/2026 · app version **0.34.0** · repo `duycan2000/pos.dui.social` (branch `main`)

This file is the full context for whoever (a person or a new Claude account) takes over the app. Read it
together with `CLAUDE.md` (standing rules), `README.md` (setup, Vietnamese) and `CHANGELOG.md` (every version).

---

## 0. Chuyển giao — việc chủ quán cần làm (tiếng Việt)

**Không cần chuyển repo hay Cloudflare.** Code vẫn ở GitHub `duycan2000/pos.dui.social`, app vẫn chạy trên
Cloudflare của bạn. Chỉ cần cho tài khoản Claude mới quyền vào repo.

1. **Cấp quyền GitHub cho tài khoản Claude mới**
   - Đăng nhập claude.ai bằng tài khoản mới › Settings › Connectors (hoặc khi Claude hỏi) › kết nối GitHub
     bằng tài khoản GitHub `duycan2000` › cho phép repo `pos.dui.social` (quyền đọc + ghi để Claude push được).
   - Nếu tổ chức Claude có quản trị viên: họ phải cho phép repo này trong cài đặt GitHub của tổ chức.
2. **Giữ lại các bí mật (không nằm trong repo, đừng làm mất)**
   - `ANDROID_KEYSTORE_PASSWORD` — mật khẩu khoá ký app Android, đang ở GitHub › Settings › Secrets and
     variables › Actions. Mất mật khẩu = phải tạo khoá mới và mọi máy phải gỡ app cài lại.
   - `BANK_WEBHOOK_KEY` — khoá webhook SePay/Casso (nếu đã cài), ở Cloudflare › Worker `dui-social-pos` ›
     Settings › Variables and Secrets. Cùng khoá đó nhập trong SePay.
   - Tài khoản Cloudflare (Workers, D1 `dui-pos`, R2 `dui-pos-media`, tên miền `pos.dui.social`) — Claude
     không vào được Cloudflare; các lệnh `wrangler` do bạn chạy.
3. **Việc còn treo cần bạn làm (nếu chưa làm)**
   - Chạy migration lên database thật (một lần, trên máy có Node + đã `npx wrangler login`):
     `npx wrangler d1 migrations apply dui-pos --remote` — cần cho phân quyền (0007), lương (0008), menu QR (0009).
   - Vào Kho › "Gợi ý mức tối thiểu" một lần để bật cảnh báo sắp hết hàng.
   - In thử trên máy SUNMI V2 Pro (chế độ "Máy in Sunmi") và gửi thử một đơn qua menu QR.
4. **Câu mở đầu gợi ý cho tài khoản Claude mới**
   > "Đây là app POS của quán bar Dui Social. Repo duycan2000/pos.dui.social. Đọc HANDOVER.md, CLAUDE.md và
   > CHANGELOG.md trước. Trả lời tôi bằng tiếng Việt. Mỗi lần cập nhật: tăng version, ghi CHANGELOG, chạy npm test,
   > rồi push lên main."

---

## 1. What the app is

POS for **Dui Social**, a cocktail bar at An Thượng 2, Đà Nẵng (many foreign guests). Owner: Duy.

- Sells at the counter on **2 Android devices** (one is a **SUNMI V2 Pro** with a built-in 58 mm printer;
  the other uses a Bluetooth thermal printer, e.g. DM01). Back office on phone or laptop.
- Runs as a web app (PWA) at **https://pos.dui.social**, plus a thin Android wrapper app (TWA).
- Works **offline**: orders are stored on the device and synced when the network returns.
- UI in Vietnamese. Printed guest bills in English by default (Vietnamese selectable). Bar tickets in Vietnamese.
- Status: still **0.x** (not declared production), but used at the bar.

## 2. Stack & infrastructure

| Piece | Detail |
| --- | --- |
| Hosting | One **Cloudflare Worker** `dui-social-pos` (`worker/index.ts`) serves `/api/*`, `/media/*`, `/m/<token>` and the built app from `dist/` (`assets.run_worker_first`). Custom domain `pos.dui.social`. |
| Plan | **Workers Free** (owner's decision): 10 ms CPU/request, D1 ≤ 50 queries/request, ≤ 100 bound params/query. Code is written around these limits. |
| Database | **D1** `dui-pos`, id `382004c4-b098-4f30-89fe-370dad4c6b89`, binding `DB`, migrations in `migrations/`. |
| Files | **R2** bucket `dui-pos-media`, binding `MEDIA`: menu photos, receipt photos, nightly backups (`backups/`). |
| Cron | `*/5 23 * * *` UTC = 06:00–06:55 Vietnam → nightly backup (`worker/backup.ts`). |
| Secrets | `BANK_WEBHOOK_KEY` (optional, Cloudflare). `ANDROID_KEYSTORE_PASSWORD` (GitHub Actions secret). Optional Actions variable `APP_URL`. |
| Deploy | **Cloudflare Workers Builds** watches `main`: every push builds and deploys. Check result: `gh api repos/duycan2000/pos.dui.social/commits/<sha>/check-runs` → "Workers Builds: dui-social-pos". Whether the build command also runs D1 migrations is **not confirmed** — assume the owner must run `npx wrangler d1 migrations apply dui-pos --remote` after any new migration. |
| Android | `.github/workflows/android.yml` builds a signed APK when `android/**` changes and publishes release `android-vN`. Latest APK: https://github.com/duycan2000/pos.dui.social/releases/latest/download/dui-pos.apk |
| Client | React 18 + Vite, no UI framework; one stylesheet `src/styles.css` (CSS variables, dark "Quầy đêm" theme + light theme). `qrcode` is the only runtime dependency besides React. |

## 3. Repository map

```
worker/            Cloudflare Worker (API)
  index.ts         router table (every route + auth level), /m/<token>, assetlinks, robots, cron handler
  http.ts          Env, Ctx, json/need/HttpError, D1 helpers (all/first/batch/stmt), requireRole/requirePerm/requireAdmin, audit
  auth.ts          first-time setup, device registration (login+password), staff PIN sessions, config snapshot
  sync.ts          offline sync: push (orders, cash, shifts, time, audit) / pull (config, open orders, low stock, guest orders)
  admin.ts         generic CRUD (/api/admin/t/:table), staff, outlet settings, devices, tables, audit, item groups
  inventory.ts     ingredients, recipes, purchases, stocktake, batches, costing, low-stock snapshot, suggested minimums
  finance.ts       dashboard (cash flow vs P&L), ledger, revenue report, YTD
  analytics.ts     charts, insights (fraud/loss heuristics), S1a tax book data
  bank.ts          SePay/Casso webhook, auto-match VietQR transfers, manual match
  time.ts          time clock entries, schedule, timesheet
  payroll.ts       monthly payroll, adjustments, payslips
  guest.ts         QR menu: public guest page (self-contained HTML), guest API, till endpoints, QR tokens
  backup.ts        nightly/manual backup to R2, download, prune
  demo.ts          demo data seed/clear (ids prefixed DEMO)
  throttle.ts      login attempt throttling
shared/            code used by both app and Worker
  types.ts         all data types (Order, OrderLine, PosConfig, OutletSettings, GuestOrder, LowStock, …)
  pricing.ts       computeTotals (BOGO etc.), order codes
  timesheet.ts     worked minutes, night minutes, lateness
  payroll.ts       computePayroll, monthRange
  perms.ts         permission keys, presets, hasPerm/canAdmin
  crypto.ts        PIN/password hashing (PBKDF2 2000 rounds, "2000$hex"), login/password rules
  vietqr.ts        VietQR (EMVCo) payload; banks.ts bank list
  util.ts          ulid, businessDay (cut-off), dates, money formatting, parseSettings
src/
  main.tsx, App.tsx  boot + screen router (hash routes)
  ui.tsx           shared components (Icon set, Sheet via portal, PinPad, TopBar, Confirm, banners…)
  pug.tsx          the animated pug mascot (toggle in settings)
  lib/store.ts     app state (useSyncExternalStore) + all till actions (cart, tabs, tables, split, pay, clock, guest orders)
  lib/sync.ts      outbox push (chunks of 5), pull every 15 s, guest-order poll every 6 s
  lib/db.ts        IndexedDB stores: kv, orders, cash, outbox
  lib/api.ts       fetch wrapper (Bearer device token + x-staff-session), downloadFile, uploads
  lib/printer.ts   receipt rendering to canvas → ESC/POS raster; BLE / RawBT / Android-app (SUNMI) transports
  lib/receipts.ts  bill, pre-bill, QR bill, receipt, bar ticket documents
  lib/platform.ts, theme.ts
  pos/*.tsx        till screens (Login, Setup, OrderScreen, Ticket, Cart, Checkout, Split, Tables, Tabs, Orders,
                   OrderDetail, CashMove, OpenShift, CloseShift, Done, TimeClock, PrinterSettings, SyncStatus, GuestRequests)
  admin/*.tsx      back office (AdminApp nav, Menu, ItemEdit, Modifiers, Promotions, FloorEditor, QrMenu, Staff,
                   TimeSheet, Payroll, Inventory, Recipe, Costing, Analytics, Finance, BankTxns, S1aBook, Reports,
                   Settings, Audit, charts, common)
migrations/        0001…0009 (see §4)
android/           TWA wrapper (package social.dui.pos) + PrintActivity.java for the SUNMI/Bluetooth printer
scripts/restore-backup.mjs   backup NDJSON → SQL
test/run.ts, fakes.ts        end-to-end tests (node:sqlite stands in for D1, fake R2)
```

## 4. Data model (D1)

Money is integer VND. IDs are ULIDs generated on the device (no collisions offline). Paid orders are never
edited or hard-deleted — only voided with reason + audit.

| Migration | Tables / columns |
| --- | --- |
| 0001_init | outlet, device, staff, staff_session, category, item, item_price_history, modifier_group, modifier_option, item_modifier_group, promotion, promotion_item, drawer_session, staff_shift, sale_order, order_line, order_adjustment, payment, cash_movement, audit_log, supplier, ingredient, recipe_line, purchase, purchase_line, stock_movement, stocktake, stocktake_line, ledger_entry |
| 0002 | auth_throttle |
| 0003 | tabs, comp lines, tips, bank_txn |
| 0004 | dining_table (6 seeded TBL01–06); sale_order.table_id/guests/prebill_at/merged_into; staff.hourly_rate; time_entry; work_schedule |
| 0005 | staff.deleted_at |
| 0006 | staff.login / pw_salt / pw_hash |
| 0007 | staff.perms (JSON array; NULL = role default) |
| 0008 | payroll_adjustment, payslip, cash_movement.for_staff_id |
| 0009 | dining_table.qr_token, guest_order |

Outlet settings live in `outlet.settings_json` (`OutletSettings` in shared/types.ts plus: `guest_order`
off/menu/order, `payroll_tips` by_staff/pool_hours/none, VietQR account, bill options, tax info, night premium…).
Business day uses a cut-off (default 05:00) and tz offset (+420 min).

## 5. Auth & security model

- **First run** (`/api/setup`): creates outlet, owner (login + password + 6-digit PIN) and device A.
- **Devices**: a new device must sign in with a staff **login + password** (`/api/devices/register`) → gets a
  device token (Bearer). Unregistered browsers see only the sign-in page. The owner can revoke devices
  (Quản trị › Thiết bị). Order codes are per device (A-001, B-001…).
- **People on a device**: pick name + **PIN** (staff 4–6 digits, managers/owner 6). Back-office actions use a
  staff session (`x-staff-session`, 12 h) obtained with the PIN; the app resumes a session for 8 h.
- **Roles**: owner / manager / staff. **Permissions** (v0.24, `shared/perms.ts`): revenue, orders_all, approve,
  ledger, menu, inventory, costing, time, audit; presets Chỉ bán hàng / Trưởng ca / Thu ngân / Pha chế trưởng /
  Kế toán / Quản lý đầy đủ. Owner-only forever: staff & accounts, devices, settings, price changes, promotions,
  floor plan, payroll, QR menu, backups. Server checks every permission (`requirePerm`).
- PIN/password hash: PBKDF2-SHA256, 2,000 rounds (Free-plan CPU), stored as `"2000$hex"` so it can be raised.
- Login throttling (`auth_throttle`). Site is `noindex` + robots disallow. Guest page is public by design but
  only reachable with a table's secret token.

## 6. Offline & sync

- Everything a till does is written to IndexedDB first, then to an **outbox**; `lib/sync.ts` pushes in chunks of
  5 records and pulls every 15 s (`/api/sync/pull`: config, drawers, shifts, today's + all open orders, cash,
  time entries/schedule, low-stock snapshot, guest requests).
- Server merges order lines by id (`INSERT OR REPLACE`, never deletes lines). Moving lines between orders
  (merge tables, split bill) works by re-pushing lines with the new `order_id`. Known small risk: a stale second
  device could push an old copy of a moved line back; it self-corrects on the next pull in normal use.
- A merged order is closed as `void` with `merged_into` and is not counted as a void in reports.
- Pull never fails because of optional extras (low stock / guest orders fall back to empty, v0.31).

## 7. Features (where they live)

**Selling** — item grid by category, tap to add, long-press for modifiers, −1 pill on tiles, search, BOGO badge
(`OrderScreen.tsx`, `Ticket.tsx`, `Cart.tsx`). BOGO: any mix of the 5 signatures, cheaper free; 3 → 1 free,
4 → 2 free; mocktail version excluded (`shared/pricing.ts`).
**Tables** — floor map, open table with guest count, send rounds, pre-bill, move, merge, pay, owner-only add
table (`Tables.tsx`, admin `FloorEditor.tsx`). Tabs by name (`Tabs.tsx`).
**Split bill** (v0.28) — by items incl. partial quantities → new order on the same table (`Split.tsx`,
`splitOrder` in store); evenly in Checkout (`EvenPay`).
**Payment** — cash (quick notes, change, drawer kick), VietQR generated on device (works offline; QR on bill),
card (reference only), mixed, even split; "chờ chuyển khoản" pending state; tips (`Checkout.tsx`).
**Bank auto-confirm** — SePay/Casso webhook `/api/webhooks/bank` (header `Authorization: Apikey <key>`, or
`secure-token`, or `?key=`), matches order code + amount; unmatched list in Quản trị › Giao dịch ngân hàng.
Owner's bank: TPBank via SePay.
**Shifts & cash** — shared drawer, per-person shifts, cash in/out with reasons (incl. "Ứng lương" for a person,
needs approval), close drawer with denomination count, Z-report incl. low-stock handover (`CloseShift.tsx`).
**Voids/approvals** — reason + PIN of someone with the `approve` permission; everything in `audit_log`.
**Time clock** — clock in/out from login screen with PIN, schedule, lateness, night minutes, timesheet edits
logged (`TimeClock.tsx`, admin `TimeSheet.tsx`).
**Payroll** (v0.29) — hours × rate + night premium + tips (by staff / pooled by hours / none) + allowance/bonus −
advances (manual + till) − deductions; "Trả lương" freezes a payslip and books a `salary` ledger entry; print
payslip; CSV export (`admin/Payroll.tsx`, `worker/payroll.ts`, `shared/payroll.ts`).
**Staff & accounts** — add/delete staff, PIN, optional login account for anyone (random password generator,
"copy to send"), permissions UI (`admin/Staff.tsx`).
**Menu** — categories, items (EN/VI names, photo to R2, sold out, "Hiện trên website"), modifier groups with
price deltas and stock effects, promotions; public menu JSON `/api/public/menu` for the website.
**Inventory** — purchase vs usage units, yield, weighted average cost, purchases with photo and payment source,
stocktake variance, batches (syrups, infusions), recipes incl. sub-recipes and modifier recipes, auto-deduct on
payment, low-stock alerts on tiles/banners/Z-report, suggested minimum levels (v0.27).
**Finance & reports** — dashboard (cash flow vs P&L), ledger with receipts, analytics charts and weekly/monthly
insights (loss/fraud hints), revenue reports + CSV, YTD vs tax threshold, **S1a-HKD tax book** in the exact
government format (print-ready, 19 rows/page).
**QR menu at the table** (v0.30) — owner sets Tắt / Chỉ xem menu / Cho gọi món; per-table secret token
(`/m/<token>`), print A4 cards or thermal; guest page is plain HTML/JS in `worker/guest.ts` (EN/VI, modifiers,
call staff, request bill, live status). Till: bell + vibration + banner + blue ring on the table; "Nhận & gửi
quầy" adds to the table order and prints the bar ticket. Prices always from the DB; anti-spam limits.
**Backups** (v0.26) — nightly to R2 in small steps (≤ 2000 rows/page, 8 steps per cron firing), keep 30, owner can
back up now / download NDJSON / delete (Cài đặt › Sao lưu dữ liệu). Restore: `scripts/restore-backup.mjs` →
`wrangler d1 execute`. D1 Time Travel also keeps 7 days.
**Look & feel** — dark/light theme toggle, small animations, pug mascot (toggle), version on login screen
(`__APP_VERSION__`), Chrome/WebView version shown there too (diagnostics), APK link on login.

## 8. Printing

- Every document is drawn on a canvas and sent as ESC/POS raster (`GS v 0`). 58 mm = 384 dots, 80 mm = 576.
- 58 mm uses a compact bill (two lines per item); 80 mm uses the 6-column CukCuk-style table. QR codes are scaled
  by whole numbers so modules stay crisp. Long total rows shrink to fit.
- Transports (Máy in screen, `lib/printer.ts`):
  - **ble** — Web Bluetooth (Chrome). Remembers the printer and reconnects silently / with one tap; keep-alive.
  - **app** — "Máy in Sunmi": intent `social.dui.pos.PRINT` to our Android app's `PrintActivity`, which writes to
    the bonded classic-Bluetooth device "InnerPrinter" (00:11:22:33:44:55, SPP). Optional printer name = any
    other paired classic printer. Works from the app and from Chrome on that device. Needs the newer APK.
  - **rawbt** — hand-off to the RawBT app.
- Options: auto-print bar ticket on send, QR bill when paying by transfer, slow mode for DM01, cash drawer kick.

## 9. Android app

- Trusted Web Activity (androidbrowserhelper 2.5.0, AGP 8.5.2, Gradle 8.9, JDK 17), package `social.dui.pos`,
  opens `APP_URL` full screen in Chrome. Pull-to-refresh is disabled in the web app.
- Signing key `android/release.jks` is in the repo; its password is the GitHub secret. Worker serves
  `/.well-known/assetlinks.json` with SHA-256
  `B9:42:89:A5:BA:CF:8A:F5:8F:60:D3:B7:C1:F5:CC:B0:7E:D0:FD:C9:9E:8D:6E:FC:53:38:2A:2C:5A:1A:71:00` (change it in
  `worker/index.ts` if the key changes).
- Web updates need no reinstall; only changes under `android/` produce a new APK.
- iOS: no app; use Safari › Share › Add to Home Screen (Web Bluetooth does not work on iOS → print via another device).

## 10. Working conventions (for Claude / developers)

- **Language**: talk to the owner in Vietnamese; UI Vietnamese; code comments and docs English.
- **Every update**: bump `package.json` version (0.x, minor +1), add a `CHANGELOG.md` entry (Vietnamese, user
  facing), run `npm test`, commit with a clear message, **push to `main`** (owner wants every update pushed),
  then confirm the Workers Builds check-run succeeded. New migration → tell the owner to run the migrate command.
- Keep within D1 Free limits (≤ 100 params/query, ≤ 50 queries/request) and the 10 ms CPU budget (no heavy
  crypto/compression per request; split long jobs into steps like `backup.ts`).
- Never edit/delete paid orders; corrections are voids/adjustments with audit.
- Ask before expensive or irreversible changes; small fixes just do.
- Owner preferences on record: guest pre-bill without transfer QR by default (option exists); English bill;
  only owner adds tables; staff share one drawer; app hidden from search engines; staying on the Free plan.

### Testing & verification

- `npm install`, then `npm test` → `tsx test/run.ts`: 47 end-to-end checks against the real Worker code with
  `node:sqlite` as D1 (needs **Node 22.5+**) and a fake R2. Add a test for every server change.
- `npm run typecheck` / `npm run build` for types. (The previous environment typechecked with local shims; real
  `node_modules` types are authoritative.)
- UI checks were done with Playwright against a local server bundling the app with esbuild (qrcode stubbed);
  useful viewports: 412×915 phone, 360×600 SUNMI-like, 1280×800 laptop.

### Gotchas learned the hard way

- An animated ancestor with `transform` turns `position: fixed` children into positioned-in-ancestor → sheets
  went off-screen. All sheets render through a **portal** (`Sheet` in `ui.tsx`); page entrance animation uses
  `animation-fill-mode: backwards`.
- `useStore(selector)` must return stable references (select the array, filter outside) or React loops.
- Old Chrome/WebView on POS terminals mis-sized 100%-high grid items → the till shell is a fixed flex column with
  sticky header/bar on phones (v0.25).
- Web Bluetooth loses the device on app restart; reconnect uses `navigator.bluetooth.getDevices()` +
  `watchAdvertisements`.
- Chrome intents to our app need the BROWSABLE category; `S.browser_fallback_url` points at the APK.
- Cloudflare/GitHub APIs other than `gh` check-runs were not reachable from the Claude sandbox; the owner sets
  secrets and runs `wrangler` himself. The live site itself may also be unreachable from the sandbox.

## 11. Version history (short)

0.1–0.8 P1 till, back office, printing, UI redesign · 0.9 login accounts + hidden site · tables & time clock ·
Android TWA · bilingual CukCuk bill · SePay auto-confirm · S1a tax book, analytics, insights · light theme,
animations, pug · BLE auto-reconnect · 0.19 QR on bill · 0.20 SUNMI built-in printer · 0.21 58 mm layout ·
0.22 off-screen sheet fix · 0.23 login accounts for anyone · 0.24 permissions · 0.25 small-screen till ·
0.26 backups · 0.27 low stock · 0.28 split bill · 0.29 payroll · 0.30 QR menu · 0.31 resilient pull ·
0.32/0.33 one-off print button added then removed. Full detail in `CHANGELOG.md`.

## 12. Open items & ideas

**To verify on real devices** — SUNMI built-in printer via the app; 58 mm layout on paper; till layout on the
SUNMI's Chrome (version shows on login); guest-order bell on the SUNMI; bank webhook live with TPBank/SePay.

**Not built yet (discussed)**
- Telegram (or Zalo) alerts to the owner: end-of-shift summary, voids/comps, cash difference.
- GrabFood: official API needs Grab partner approval; options proposed — notification-listener alert from the
  GrabMerchant app on the SUNMI, and a "Grab" order type with Grab prices + commission in reports.
- Happy hour (time-based pricing), bill total in USD/EUR, iOS install guide on the login screen,
  e-invoice integration (only after the accountant confirms), bar display screen (P3), menu engineering.

**Declined on purpose** — look-alike carrier/marketplace shipping labels (with logos or fake barcodes).
