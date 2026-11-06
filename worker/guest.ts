// QR menu at the table. Each table's QR code opens /m/<token>: a small self-contained page (no app bundle,
// fast on any phone) with the menu in English or Vietnamese. Guests can order, call staff or ask for the bill;
// nothing goes to the bar until a staff member accepts it on the till. Prices are always taken from the database.
import type { GuestMode, GuestOrder } from '../shared/types';
import { parseSettings, ulid } from '../shared/util';
import { all, body, type Ctx, type Env, first, HttpError, json, need, now, requireRole, stmt, batch } from './http';

const TOKEN = /^[A-Za-z0-9]{8,24}$/;

function newToken() {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  return Array.from(a, (x) => abc[x % abc.length]).join('');
}

async function guestMode(env: Env): Promise<{ mode: GuestMode; name: string; settings: Record<string, unknown> }> {
  const o = await first<{ name: string; settings_json: string | null }>(env, 'SELECT name, settings_json FROM outlet LIMIT 1');
  const st = parseSettings<{ guest_order?: GuestMode }>(o?.settings_json);
  return { mode: st.guest_order ?? 'off', name: o?.name ?? 'Menu', settings: st as Record<string, unknown> };
}

async function tableByToken(env: Env, token: string) {
  if (!TOKEN.test(token)) return null;
  return first<{ id: string; name: string; area: string }>(env, 'SELECT id, name, area FROM dining_table WHERE qr_token=? AND active=1', token);
}

async function ipHash(req: Request) {
  const ip = req.headers.get('cf-connecting-ip') || 'unknown';
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('dui-guest:' + ip));
  return [...new Uint8Array(d)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- public (guest) ----------

export async function menu(c: Ctx) {
  const t = await tableByToken(c.env, c.params.token);
  need(t, 404, 'QR code not valid');
  const g = await guestMode(c.env);
  need(g.mode !== 'off', 403, 'Menu is not available right now');
  const [cats, items, groups, options, links] = await Promise.all([
    all(c.env, 'SELECT id,name_en,name_vi,sort FROM category WHERE active=1 ORDER BY sort'),
    all<any>(c.env, 'SELECT id,category_id,name_en,name_vi,desc_en,desc_vi,price,image_key,sold_out,sort FROM item WHERE active=1 AND show_on_web=1 ORDER BY sort, name_vi'),
    all(c.env, 'SELECT id,name_en,name_vi,selection,required,sort FROM modifier_group ORDER BY sort'),
    all(c.env, 'SELECT id,group_id,name_en,name_vi,price_delta,is_default,sort FROM modifier_option WHERE active=1 ORDER BY sort'),
    all(c.env, 'SELECT item_id,group_id,sort FROM item_modifier_group ORDER BY sort'),
  ]);
  return json({
    outlet: g.name, table: t!.name, mode: g.mode,
    categories: cats, items: items.map((i) => ({ ...i, image_url: i.image_key ? `/media/${i.image_key}` : null })),
    groups, options, links,
  });
}

interface InLine { item_id: string; qty: number; option_ids?: string[]; note?: string }

export async function submit(c: Ctx) {
  const t = await tableByToken(c.env, c.params.token);
  need(t, 404, 'QR code not valid');
  const g = await guestMode(c.env);
  const b = await body<{ kind?: 'order' | 'call' | 'bill'; lines?: InLine[]; note?: string; name?: string; lang?: string }>(c);
  const kind = b.kind ?? 'order';
  need(['order', 'call', 'bill'].includes(kind), 400, 'Bad request');
  need(g.mode === 'order' || (g.mode === 'menu' && kind !== 'order'), 403, 'Ordering from the table is not available — please ask our staff');
  const ip = await ipHash(c.req);
  const tNow = now();
  // Anti-spam: per table and per phone.
  const recent = await first<{ tbl: number; ipn: number; open: number }>(c.env,
    `SELECT SUM(CASE WHEN table_id=? AND created_at > ? THEN 1 ELSE 0 END) tbl, SUM(CASE WHEN ip_hash=? AND created_at > ? THEN 1 ELSE 0 END) ipn,
      SUM(CASE WHEN table_id=? AND status='new' THEN 1 ELSE 0 END) open FROM guest_order WHERE created_at > ?`,
    t!.id, tNow - 120000, ip, tNow - 600000, t!.id, tNow - 6 * 3600000);
  if ((recent?.tbl ?? 0) >= 6 || (recent?.ipn ?? 0) >= 12 || (recent?.open ?? 0) >= 4) throw new HttpError(429, 'Too many requests — our staff will be with you shortly');
  if (kind !== 'order') {
    const dup = await first(c.env, "SELECT id FROM guest_order WHERE table_id=? AND kind=? AND status='new'", t!.id, kind);
    if (dup) return json({ id: (dup as { id: string }).id, already: true });
  }
  let lines: GuestOrder['lines'] = [];
  let total = 0;
  if (kind === 'order') {
    need(Array.isArray(b.lines) && b.lines.length > 0 && b.lines.length <= 30, 400, 'Your order is empty');
    const [items, options, links] = await Promise.all([
      all<{ id: string; name_vi: string; name_en: string; price: number; sold_out: number }>(c.env, 'SELECT id,name_vi,name_en,price,sold_out FROM item WHERE active=1 AND show_on_web=1'),
      all<{ id: string; group_id: string; name_vi: string; price_delta: number }>(c.env, 'SELECT id,group_id,name_vi,price_delta FROM modifier_option WHERE active=1'),
      all<{ item_id: string; group_id: string }>(c.env, 'SELECT item_id,group_id FROM item_modifier_group'),
    ]);
    for (const l of b.lines!) {
      const it = items.find((i) => i.id === l.item_id);
      need(it, 400, 'An item is no longer on the menu — please refresh');
      need(!it!.sold_out, 400, `${it!.name_en || it!.name_vi} is sold out`);
      const qty = Math.round(Number(l.qty) || 0);
      need(qty >= 1 && qty <= 20, 400, 'Quantity 1–20');
      const allowed = new Set(links.filter((x) => x.item_id === it!.id).map((x) => x.group_id));
      const opts = (l.option_ids ?? []).slice(0, 12).map((id) => options.find((o) => o.id === id)).filter((o): o is NonNullable<typeof o> => !!o && allowed.has(o.group_id));
      const unit = it!.price + opts.reduce((s, o) => s + o.price_delta, 0);
      total += unit * qty;
      lines.push({ item_id: it!.id, name: it!.name_vi, qty, option_ids: opts.map((o) => o.id), options: opts.map((o) => o.name_vi), unit_price: unit, note: (l.note || '').trim().slice(0, 120) || null });
    }
  }
  const id = ulid();
  await batch(c.env, [stmt(c.env, 'INSERT INTO guest_order (id,table_id,kind,status,lines_json,total,guest_name,note,lang,ip_hash,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    id, t!.id, kind, 'new', JSON.stringify(lines), total, (b.name || '').trim().slice(0, 40) || null, (b.note || '').trim().slice(0, 200) || null, b.lang === 'vi' ? 'vi' : 'en', ip, tNow)]);
  return json({ id, total }, 201);
}

export async function status(c: Ctx) {
  const t = await tableByToken(c.env, c.params.token);
  need(t, 404, 'QR code not valid');
  const r = await first<{ status: string; kind: string; reason: string | null; total: number }>(c.env, 'SELECT status, kind, reason, total FROM guest_order WHERE id=? AND table_id=?', c.params.id, t!.id);
  need(r, 404, 'Not found');
  return json(r);
}

// ---------- till (device) ----------

export async function pendingFor(env: Env): Promise<GuestOrder[]> {
  const rows = await all<any>(env, "SELECT id,table_id,kind,status,lines_json,total,guest_name,note,lang,created_at FROM guest_order WHERE status='new' AND created_at > ? ORDER BY created_at LIMIT 50", now() - 6 * 3600000);
  return rows.map(({ lines_json, ...r }) => ({ ...r, lines: JSON.parse(lines_json || '[]') }));
}

export async function pending(c: Ctx) {
  return json(await pendingFor(c.env));
}

export async function handle(c: Ctx) {
  const b = await body<{ status: 'accepted' | 'rejected'; order_id?: string; reason?: string; staff_id?: string }>(c);
  need(b.status === 'accepted' || b.status === 'rejected', 400, 'Trạng thái không hợp lệ');
  const r = await c.env.DB.prepare("UPDATE guest_order SET status=?, order_id=?, reason=?, handled_by=?, handled_at=? WHERE id=? AND status='new'")
    .bind(b.status, b.order_id ?? null, (b.reason || '').slice(0, 120) || null, b.staff_id ?? null, now(), c.params.id).run();
  return json({ ok: true, changed: (r as { meta?: { changes?: number } }).meta?.changes ?? 0 });
}

// ---------- owner ----------

/** Every active table with its QR token (made on first use). */
export async function tableCodes(c: Ctx) {
  requireRole(c, 'owner');
  const rows = await all<{ id: string; name: string; area: string; qr_token: string | null }>(c.env, 'SELECT id,name,area,qr_token FROM dining_table WHERE active=1 ORDER BY area, sort, name');
  const missing = rows.filter((r) => !r.qr_token);
  if (missing.length) {
    for (const r of missing) r.qr_token = newToken();
    await batch(c.env, missing.map((r) => stmt(c.env, 'UPDATE dining_table SET qr_token=? WHERE id=?', r.qr_token, r.id)));
  }
  const g = await guestMode(c.env);
  return json({ mode: g.mode, tables: rows });
}

export async function resetCode(c: Ctx) {
  requireRole(c, 'owner');
  const token = newToken();
  await c.env.DB.prepare('UPDATE dining_table SET qr_token=? WHERE id=?').bind(token, c.params.id).run();
  return json({ qr_token: token });
}

// ---------- the guest page ----------

export function page(token: string) {
  const safe = TOKEN.test(token) ? token : '';
  return new Response(GUEST_HTML.replace('__TOKEN__', safe), {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', 'referrer-policy': 'no-referrer' },
  });
}

const GUEST_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0f1115">
<title>Menu</title>
<style>
:root{--bg:#0f1115;--panel:#171a21;--card:#1d212a;--line:#2a2f3a;--text:#f3f4f6;--muted:#9aa3b2;--accent:#f5a524;--ink:#1b1300;--ok:#22c55e;--danger:#ef4444;--r:16px}
@media (prefers-color-scheme: light){:root{--bg:#f6f5f2;--panel:#fff;--card:#fff;--line:#e6e3dc;--text:#1a1a1a;--muted:#6b6b6b;--accent:#e08e0b;--ink:#fff}}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;background:var(--bg);color:var(--text);font:15px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
button{font:inherit;color:inherit;cursor:pointer}
header{position:sticky;top:0;z-index:5;background:var(--panel);border-bottom:1px solid var(--line);padding:12px 16px 0}
.top{display:flex;align-items:center;gap:10px}
.brand{font-weight:800;letter-spacing:.06em;color:var(--accent);font-size:15px}
.tbl{font-size:13px;color:var(--muted)}
.grow{flex:1;min-width:0}
.lang{border:1px solid var(--line);background:var(--card);border-radius:999px;padding:6px 12px;font-size:13px;font-weight:700}
.chips{display:flex;gap:8px;overflow-x:auto;padding:12px 0;scrollbar-width:none}
.chips::-webkit-scrollbar{display:none}
.chip{flex:0 0 auto;border:1px solid var(--line);background:var(--card);border-radius:999px;padding:8px 14px;font-weight:600;font-size:14px}
.chip.on{background:var(--text);color:var(--bg);border-color:var(--text)}
main{padding:12px 16px 120px;max-width:720px;margin:0 auto}
h2{font-size:18px;margin:18px 0 10px}
.item{display:flex;gap:12px;background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:12px;margin-bottom:10px;width:100%;text-align:left}
.item img{width:84px;height:84px;object-fit:cover;border-radius:12px;flex:0 0 auto;background:var(--line)}
.item .n{font-weight:700;font-size:16px}
.item .d{color:var(--muted);font-size:13px;margin-top:2px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.item .p{font-weight:800;margin-top:6px}
.item.out{opacity:.45}
.qty{background:var(--accent);color:var(--ink);border-radius:999px;font-weight:800;font-size:13px;padding:2px 9px;align-self:flex-start}
.bar{position:fixed;left:0;right:0;bottom:0;padding:12px 16px calc(12px + env(safe-area-inset-bottom));background:var(--panel);border-top:1px solid var(--line);display:flex;gap:10px;z-index:6}
.btn{border:1px solid var(--line);background:var(--card);border-radius:14px;padding:14px 16px;font-weight:700;font-size:15px}
.btn.primary{background:var(--accent);color:var(--ink);border-color:var(--accent);flex:1;display:flex;justify-content:space-between;align-items:center}
.btn.block{width:100%}
.btn:disabled{opacity:.5}
.sheet-bg{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:20;display:flex;align-items:flex-end;justify-content:center}
.sheet{background:var(--panel);width:100%;max-width:720px;max-height:90vh;overflow:auto;border-radius:22px 22px 0 0;padding:18px 18px calc(18px + env(safe-area-inset-bottom))}
.sheet h3{margin:0 0 4px;font-size:20px}
.sheet img.hero{width:100%;max-height:220px;object-fit:cover;border-radius:14px;margin-bottom:12px}
.grp{margin-top:14px}.grp b{display:block;margin-bottom:6px}
.opt{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--line);border-radius:12px;margin-bottom:6px;width:100%;background:var(--card);text-align:left}
.opt.on{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 14%,var(--card))}
.opt .x{margin-left:auto;color:var(--muted);font-size:13px}
.step{display:flex;align-items:center;gap:14px;justify-content:center;margin:16px 0}
.step button{width:44px;height:44px;border-radius:50%;border:1px solid var(--line);background:var(--card);font-size:22px;font-weight:700}
.step span{font-size:22px;font-weight:800;min-width:28px;text-align:center}
input,textarea{width:100%;font:inherit;color:var(--text);background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px}
.row{display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid var(--line)}
.muted{color:var(--muted)}.small{font-size:13px}
.center{text-align:center}
.big{font-size:22px;font-weight:800}
.notice{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px;margin:10px 0;color:var(--muted);font-size:14px}
.spin{width:28px;height:28px;border:3px solid var(--line);border-top-color:var(--accent);border-radius:50%;animation:s 1s linear infinite;margin:10px auto}
@keyframes s{to{transform:rotate(360deg)}}
.err{color:var(--danger);font-size:14px;margin-top:8px}
</style></head>
<body><div id="app"><main><div class="spin"></div></main></div>
<script>
(function(){
var TOKEN='__TOKEN__';
var T={en:{order:'View order',empty:'Your order is empty',add:'Add to order',send:'Send order',note:'Note for the bar (optional)',name:'Your name (optional)',sent:'Order sent!',wait:'Waiting for our staff to confirm…',ok:'Confirmed — your drinks are being made.',no:'Sorry, our staff could not accept this order.',call:'Call staff',bill:'Request bill',called:'Our staff is on the way.',billed:'Your bill is coming.',again:'Order more',sold:'Sold out',total:'Total',menuOnly:'Please order with our staff.',bad:'This QR code is not valid. Please ask our staff.',off:'The menu is not available right now.',req:'Required',close:'Close',items:'items',payNote:'You pay at the end. Promotions (e.g. 1+1) are applied on your bill.'},
vi:{order:'Xem món đã chọn',empty:'Chưa chọn món nào',add:'Thêm vào đơn',send:'Gửi gọi món',note:'Ghi chú cho quầy (không bắt buộc)',name:'Tên của bạn (không bắt buộc)',sent:'Đã gửi!',wait:'Đang chờ nhân viên xác nhận…',ok:'Đã xác nhận — quầy đang pha chế.',no:'Xin lỗi, nhân viên chưa nhận được đơn này.',call:'Gọi nhân viên',bill:'Xin thanh toán',called:'Nhân viên sẽ đến ngay.',billed:'Nhân viên sẽ mang hoá đơn đến.',again:'Gọi thêm',sold:'Hết hàng',total:'Tổng',menuOnly:'Vui lòng gọi món với nhân viên.',bad:'Mã QR không hợp lệ. Vui lòng hỏi nhân viên.',off:'Menu tạm thời không khả dụng.',req:'Bắt buộc',close:'Đóng',items:'món',payNote:'Thanh toán khi ra về. Khuyến mãi (VD 1+1) được trừ trên hoá đơn.'}};
var lang=(localStorage.getItem('dui-lang')||(navigator.language||'en').slice(0,2))==='vi'?'vi':'en';
var M=null,cart=[],cat=null,app=document.getElementById('app');
function t(k){return T[lang][k]}
function money(v){return new Intl.NumberFormat('vi-VN').format(v)+'đ'}
function nm(o){return (lang==='en'?(o.name_en||o.name_vi):(o.name_vi||o.name_en))||''}
function ds(o){return (lang==='en'?(o.desc_en||o.desc_vi):(o.desc_vi||o.desc_en))||''}
function h(tag,attrs){var e=document.createElement(tag);attrs=attrs||{};for(var k in attrs){var v=attrs[k];if(v==null||v===false)continue;if(k==='class')e.className=v;else if(k.slice(0,2)==='on')e.addEventListener(k.slice(2),v);else if(k==='text')e.textContent=v;else e.setAttribute(k,v===true?'':v)}for(var i=2;i<arguments.length;i++){var c=arguments[i];if(c==null||c===false)continue;if(Array.isArray(c))c.forEach(function(x){if(x)e.appendChild(typeof x==='string'?document.createTextNode(x):x)});else e.appendChild(typeof c==='string'?document.createTextNode(c):c)}return e}
function api(method,path,body){return fetch('/api/guest/'+TOKEN+path,{method:method,headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined}).then(function(r){return r.json().then(function(d){if(!r.ok)throw new Error(d.error||('Error '+r.status));return d})})}
function count(){return cart.reduce(function(s,l){return s+l.qty},0)}
function sum(){return cart.reduce(function(s,l){return s+l.unit*l.qty},0)}
function groupsOf(it){return M.links.filter(function(l){return l.item_id===it.id}).map(function(l){return M.groups.find(function(g){return g.id===l.group_id})}).filter(Boolean)}
function optsOf(g){return M.options.filter(function(o){return o.group_id===g.id})}
function sheet(content){var bg=h('div',{class:'sheet-bg',onclick:function(e){if(e.target===bg)bg.remove()}},h('div',{class:'sheet'},content));document.body.appendChild(bg);return bg}
function render(){
  app.innerHTML='';
  var cats=M.categories.filter(function(c){return M.items.some(function(i){return i.category_id===c.id})});
  if(!cat&&cats[0])cat=cats[0].id;
  var head=h('header',{},h('div',{class:'top'},h('div',{class:'grow'},h('div',{class:'brand',text:M.outlet.toUpperCase()}),h('div',{class:'tbl',text:M.table})),
    h('button',{class:'lang',onclick:function(){lang=lang==='en'?'vi':'en';try{localStorage.setItem('dui-lang',lang)}catch(e){}render()}},lang==='en'?'Tiếng Việt':'English')),
    h('nav',{class:'chips'},cats.map(function(c){return h('button',{class:'chip'+(c.id===cat?' on':''),onclick:function(){cat=c.id;var el=document.getElementById('c-'+c.id);if(el)window.scrollTo({top:el.offsetTop-110,behavior:'smooth'});render()}},nm(c))})));
  var main=h('main',{});
  if(M.mode==='menu')main.appendChild(h('div',{class:'notice',text:t('menuOnly')}));
  cats.forEach(function(c){
    main.appendChild(h('h2',{id:'c-'+c.id,text:nm(c)}));
    M.items.filter(function(i){return i.category_id===c.id}).forEach(function(it){
      var q=cart.filter(function(l){return l.item_id===it.id}).reduce(function(s,l){return s+l.qty},0);
      main.appendChild(h('button',{class:'item'+(it.sold_out?' out':''),disabled:it.sold_out||M.mode!=='order'?true:null,onclick:function(){openItem(it)}},
        it.image_url?h('img',{src:it.image_url,alt:'',loading:'lazy'}):null,
        h('div',{class:'grow'},h('div',{class:'n',text:nm(it)}),ds(it)?h('div',{class:'d',text:ds(it)}):null,h('div',{class:'p',text:it.sold_out?t('sold'):money(it.price)})),
        q?h('span',{class:'qty',text:String(q)}):null));
    });
  });
  main.appendChild(h('p',{class:'small muted center',text:t('payNote')}));
  var bar=h('div',{class:'bar'},
    h('button',{class:'btn',onclick:function(){ask('call')}},t('call')),
    M.mode==='order'&&count()?h('button',{class:'btn primary',onclick:openCart},h('span',{text:t('order')+' · '+count()}),h('span',{text:money(sum())})):h('button',{class:'btn',style:'flex:1',onclick:function(){ask('bill')}},t('bill')));
  app.appendChild(head);app.appendChild(main);app.appendChild(bar);
}
function openItem(it){
  var gs=groupsOf(it),sel={},qty=1,note='';
  gs.forEach(function(g){var os=optsOf(g);var d=os.filter(function(o){return o.is_default});sel[g.id]=(d.length?(g.selection==='single'?[d[0]]:d):(g.required&&g.selection==='single'&&os[0]?[os[0]]:[])).map(function(o){return o.id})});
  var bg;
  function unit(){var u=it.price;gs.forEach(function(g){sel[g.id].forEach(function(id){var o=M.options.find(function(x){return x.id===id});if(o)u+=o.price_delta})});return u}
  function draw(){
    var box=h('div',{},
      it.image_url?h('img',{class:'hero',src:it.image_url,alt:''}):null,
      h('h3',{text:nm(it)}),ds(it)?h('div',{class:'muted small',text:ds(it)}):null,
      gs.map(function(g){return h('div',{class:'grp'},h('b',{},nm(g)+(g.required?' · '+t('req'):'')),optsOf(g).map(function(o){var on=sel[g.id].indexOf(o.id)>=0;return h('button',{class:'opt'+(on?' on':''),onclick:function(){if(g.selection==='single')sel[g.id]=[o.id];else sel[g.id]=on?sel[g.id].filter(function(x){return x!==o.id}):sel[g.id].concat(o.id);redraw()}},h('span',{},(on?'● ':'○ ')+nm(o)),o.price_delta?h('span',{class:'x',text:(o.price_delta>0?'+':'−')+money(Math.abs(o.price_delta))}):null)}))}),
      h('div',{class:'step'},h('button',{onclick:function(){if(qty>1){qty--;redraw()}}},'−'),h('span',{text:String(qty)}),h('button',{onclick:function(){if(qty<20){qty++;redraw()}}},'+')),
      h('input',{placeholder:t('note'),value:note,maxlength:'120',oninput:function(e){note=e.target.value}}),
      h('div',{style:'height:12px'}),
      h('button',{class:'btn primary block',onclick:function(){
        var miss=gs.some(function(g){return g.required&&!sel[g.id].length});if(miss)return;
        var ids=[];gs.forEach(function(g){ids=ids.concat(sel[g.id])});
        var names=ids.map(function(id){var o=M.options.find(function(x){return x.id===id});return o&&!o.is_default?nm(o):null}).filter(Boolean);
        cart.push({item_id:it.id,name:nm(it),qty:qty,option_ids:ids,optnames:names,unit:unit(),note:note.trim()});bg.remove();render()}},h('span',{text:t('add')}),h('span',{text:money(unit()*qty)})));
    return box}
  function redraw(){var s=bg.querySelector('.sheet');s.innerHTML='';s.appendChild(draw())}
  bg=sheet(draw());
}
function openCart(){
  var bg,name='',note='',err='',busy=false;
  function draw(){return h('div',{},h('h3',{text:t('order')}),
    cart.map(function(l,i){return h('div',{class:'row'},h('div',{class:'grow'},h('div',{},h('b',{text:l.qty+'× '}),l.name),(l.optnames.length||l.note)?h('div',{class:'small muted',text:l.optnames.concat(l.note?[l.note]:[]).join(' · ')}):null),
      h('div',{style:'text-align:right'},h('div',{text:money(l.unit*l.qty)}),h('button',{class:'small muted',style:'border:0;background:none;padding:4px 0',onclick:function(){l.qty--;if(!l.qty)cart.splice(i,1);if(!cart.length){bg.remove();render();return}redraw();render()}},'−1')))}),
    h('div',{class:'row',style:'border:0'},h('b',{text:t('total')}),h('b',{class:'big',text:money(sum())})),
    h('input',{placeholder:t('name'),value:name,maxlength:'40',oninput:function(e){name=e.target.value}}),h('div',{style:'height:8px'}),
    h('input',{placeholder:t('note'),value:note,maxlength:'200',oninput:function(e){note=e.target.value}}),
    err?h('div',{class:'err',text:err}):null,h('div',{style:'height:12px'}),
    h('button',{class:'btn primary block',disabled:busy?true:null,onclick:function(){busy=true;redraw();
      api('POST','/order',{kind:'order',lang:lang,name:name,note:note,lines:cart.map(function(l){return{item_id:l.item_id,qty:l.qty,option_ids:l.option_ids,note:l.note}})})
      .then(function(r){cart=[];bg.remove();render();track(r.id,'order')}).catch(function(e){err=e.message;busy=false;redraw()})}},h('span',{text:t('send')}),h('span',{text:money(sum())})))}
  function redraw(){var s=bg.querySelector('.sheet');s.innerHTML='';s.appendChild(draw())}
  bg=sheet(draw());
}
function ask(kind){api('POST','/order',{kind:kind,lang:lang}).then(function(r){track(r.id,kind)}).catch(function(e){alertBox(e.message)})}
function alertBox(msg){var bg=sheet(h('div',{class:'center'},h('p',{text:msg}),h('button',{class:'btn block',onclick:function(){bg.remove()}},t('close'))))}
function track(id,kind){
  var msg=h('p',{class:'center',text:kind==='order'?t('wait'):kind==='call'?t('called'):t('billed')});
  var spin=h('div',{class:'spin'});
  var bg=sheet(h('div',{class:'center'},h('h3',{text:kind==='order'?t('sent'):(kind==='call'?t('call'):t('bill'))}),kind==='order'?spin:null,msg,h('button',{class:'btn block',onclick:function(){stop=true;bg.remove()}},kind==='order'?t('again'):t('close'))));
  if(kind!=='order')return;
  var stop=false,n=0;
  (function poll(){if(stop||n++>120)return;setTimeout(function(){api('GET','/order/'+id).then(function(r){if(r.status==='accepted'){msg.textContent=t('ok');spin.remove();stop=true}else if(r.status==='rejected'){msg.textContent=t('no')+(r.reason?' ('+r.reason+')':'');spin.remove();stop=true}poll()}).catch(poll)},4000)})();
}
if(!TOKEN){app.innerHTML='';app.appendChild(h('main',{},h('div',{class:'notice',text:T[lang].bad})));return}
api('GET','/menu').then(function(d){M=d;document.title=d.outlet+' · '+d.table;render()}).catch(function(e){app.innerHTML='';app.appendChild(h('main',{},h('div',{class:'notice',text:e.message})))});
})();
</script></body></html>`;
