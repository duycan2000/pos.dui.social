// Bluetooth receipt printing for Android Chrome.
//
//  • "ble"   — Web Bluetooth straight from Chrome. Works with printers that expose a BLE service
//              (most recent 58/80 mm "BLE" or "dual-mode" printers).
//  • "rawbt" — sends the bytes to the free RawBT app, which talks to classic-Bluetooth printers
//              (the older SPP-only printers that Web Bluetooth cannot reach).
//
// Receipts are rendered to an image and sent as ESC/POS raster (GS v 0), so Vietnamese diacritics
// print correctly on any printer — no code page needed.
import { useSyncExternalStore } from 'react';
import { kv } from './db';

export interface PrinterSettings {
  mode: 'none' | 'ble' | 'rawbt' | 'app';
  /** For mode 'app': paired printer name; empty = the SUNMI built-in printer (InnerPrinter). */
  appPrinter?: string;
  paper: 58 | 80;
  autoReceipt: boolean;   // print the bill after each payment
  autoQrBill?: boolean;   // print the bill with its VietQR code when the guest pays by transfer (default on)
  autoTicket: boolean;    // print a bar ticket when an order or a tab round is sent
  openDrawer: boolean;    // kick the cash drawer on cash payments (printer must have an RJ11 port)
  copies: number;
  deviceName?: string;
  /** Web Bluetooth device id of the paired printer (stable per site while the permission is kept). */
  deviceId?: string;
  /** Smaller chunks and pauses, for mini/portable printers with a small buffer (e.g. DM01). */
  slow?: boolean;
}

export const DEFAULT_PRINTER: PrinterSettings = { mode: 'none', paper: 58, autoReceipt: false, autoTicket: false, openDrawer: false, copies: 1, slow: true };

let settings: PrinterSettings = DEFAULT_PRINTER;
export async function loadPrinter(): Promise<PrinterSettings> {
  settings = { ...DEFAULT_PRINTER, ...((await kv.get<PrinterSettings>('printer')) ?? {}) };
  return settings;
}
export async function savePrinter(s: PrinterSettings) {
  settings = s;
  await kv.set('printer', s);
}
export function printerSettings() { return settings; }

// ---------- connection ----------

// Services used by common thermal printers over BLE (generic 18F0, ISSC/Microchip, Nordic-style FFxx, others).
const SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '0000fee7-0000-1000-8000-00805f9b34fb',
  '0000ae30-0000-1000-8000-00805f9b34fb',
];

/* eslint-disable @typescript-eslint/no-explicit-any */
let device: any = null;
let characteristic: any = null;

export function bleSupported(): boolean {
  return typeof navigator !== 'undefined' && !!(navigator as any).bluetooth;
}

async function findWritable(server: any): Promise<any> {
  let services: any[] = [];
  try { services = await server.getPrimaryServices(); } catch { /* fall back to known list */ }
  if (!services.length) {
    for (const uuid of SERVICES) { try { services.push(await server.getPrimaryService(uuid)); } catch { /* not present */ } }
  }
  for (const svc of services) {
    let chars: any[] = [];
    try { chars = await svc.getCharacteristics(); } catch { continue; }
    const w = chars.find((c) => c.properties.writeWithoutResponse) || chars.find((c) => c.properties.write);
    if (w) return w;
  }
  throw new Error('Không tìm thấy cổng in trên thiết bị này. Máy in có thể chỉ hỗ trợ Bluetooth thường — hãy chọn kiểu RawBT.');
}

// ---- connection status, shown on the selling screen ----
export type PrinterLink = 'off' | 'connected' | 'connecting' | 'disconnected';
let link: PrinterLink = 'off';
const linkListeners = new Set<() => void>();
function setLink(l: PrinterLink) { if (l !== link) { link = l; linkListeners.forEach((f) => f()); } }
export function printerLink(): PrinterLink { return settings.mode === 'ble' ? link : 'off'; }
export function onPrinterLink(f: () => void) { linkListeners.add(f); return () => { linkListeners.delete(f); }; }

function attach(d: any) {
  device = d;
  d.addEventListener?.('gattserverdisconnected', () => {
    characteristic = null;
    setLink('disconnected');
    // Printer switched off or out of range: try again quietly a few times.
    scheduleReconnect();
  });
}

async function connectGatt(d: any, ms = 8000): Promise<void> {
  const server = await Promise.race([
    d.gatt.connect(),
    new Promise((_, rej) => setTimeout(() => rej(new Error('Máy in không phản hồi. Kiểm tra máy in đã bật và ở gần.')), ms)),
  ]);
  characteristic = await findWritable(server);
  setLink('connected');
}

/** Pair with a printer (must be called from a tap). */
export async function pairBle(): Promise<string> {
  if (!bleSupported()) throw new Error('Trình duyệt này không hỗ trợ Bluetooth. Dùng Chrome trên Android, hoặc chọn kiểu RawBT.');
  const d = await (navigator as any).bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: SERVICES });
  attach(d);
  setLink('connecting');
  try { await connectGatt(d); } catch (e) { setLink('disconnected'); throw e; }
  await savePrinter({ ...settings, mode: 'ble', deviceName: d.name || 'Máy in', deviceId: d.id });
  return d.name || 'Máy in';
}

/**
 * Find the printer used before without asking: Chrome remembers allowed devices (getDevices). If the
 * printer is not advertising yet we wait for its advertisement, then connect. No tap needed.
 */
export async function reconnectSilently(): Promise<boolean> {
  if (settings.mode !== 'ble' || !bleSupported()) return false;
  if (characteristic && device?.gatt?.connected) { setLink('connected'); return true; }
  setLink('connecting');
  try {
    if (!device) {
      const known: any[] = (await (navigator as any).bluetooth.getDevices?.().catch(() => [])) || [];
      const d = known.find((x) => settings.deviceId && x.id === settings.deviceId) || known.find((x) => settings.deviceName && x.name === settings.deviceName);
      if (!d) { setLink('disconnected'); return false; }
      attach(d);
    }
    try {
      await connectGatt(device, 6000);
    } catch {
      // Some printers only accept a connection right after they advertise.
      if (!device.watchAdvertisements) throw new Error('no-ads');
      await new Promise<void>((resolve, reject) => {
        const ac = new AbortController();
        const timer = setTimeout(() => { ac.abort(); reject(new Error('timeout')); }, 12000);
        device.addEventListener('advertisementreceived', async () => {
          clearTimeout(timer); ac.abort();
          try { await connectGatt(device, 6000); resolve(); } catch (e) { reject(e); }
        }, { once: true });
        device.watchAdvertisements({ signal: ac.signal }).catch(reject);
      });
    }
    return true;
  } catch {
    setLink('disconnected');
    return false;
  }
}

/**
 * One tap to get the printer back when the silent way is not available on this phone: the Bluetooth
 * picker opens already filtered to the saved printer's name, so it is a single choice.
 */
export async function reconnectWithTap(): Promise<string> {
  if (await reconnectSilently()) return settings.deviceName || 'Máy in';
  if (!bleSupported()) throw new Error('Trình duyệt này không hỗ trợ Bluetooth');
  const name = settings.deviceName;
  const d = await (navigator as any).bluetooth.requestDevice(name && name !== 'Máy in'
    ? { filters: [{ name }, { namePrefix: name.slice(0, 4) }], optionalServices: SERVICES }
    : { acceptAllDevices: true, optionalServices: SERVICES });
  attach(d);
  setLink('connecting');
  try { await connectGatt(d); } catch (e) { setLink('disconnected'); throw e; }
  await savePrinter({ ...settings, deviceName: d.name || name, deviceId: d.id });
  return d.name || 'Máy in';
}

let retryTimer: ReturnType<typeof setTimeout> | undefined;
let retries = 0;
function scheduleReconnect() {
  clearTimeout(retryTimer);
  if (retries >= 4 || settings.mode !== 'ble') return;
  retryTimer = setTimeout(async () => {
    retries++;
    if (await reconnectSilently()) retries = 0; else scheduleReconnect();
  }, 3000 * (retries + 1));
}

/** Call once at app start: reconnect now, and again whenever the app comes back to the foreground. */
export function startPrinterKeepAlive() {
  const go = () => { if (settings.mode === 'ble' && !(characteristic && device?.gatt?.connected)) { retries = 0; reconnectSilently(); } };
  go();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) go(); });
}

async function ensureBle() {
  if (characteristic && device?.gatt?.connected) return;
  if (await reconnectSilently()) return;
  throw new Error('Máy in chưa kết nối. Bật máy in rồi chạm "Kết nối lại máy in" trên màn bán hàng.');
}

async function writeBle(bytes: Uint8Array) {
  await ensureBle();
  const chunk = settings.slow ? 100 : 180;
  const pause = settings.slow ? 25 : 12;
  for (let i = 0; i < bytes.length; i += chunk) {
    const part = bytes.slice(i, i + chunk);
    if (characteristic.properties.writeWithoutResponse && characteristic.writeValueWithoutResponse) {
      await characteristic.writeValueWithoutResponse(part);
      await new Promise((r) => setTimeout(r, pause));
    } else {
      await characteristic.writeValue(part);
    }
  }
}

/**
 * Through our own Android app (android/…/PrintActivity): prints on the SUNMI built-in printer, or on any
 * Bluetooth printer already paired in Android settings — no RawBT needed. Works from the app and from Chrome
 * on the same device; if the app is missing, Chrome offers the APK.
 */
function writeApp(bytes: Uint8Array) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const fallback = encodeURIComponent('https://github.com/duycan2000/pos.dui.social/releases/latest/download/dui-pos.apk');
  const printer = (settings.appPrinter || 'InnerPrinter').replace(/[;#]/g, '');
  window.location.href = `intent:#Intent;action=social.dui.pos.PRINT;package=social.dui.pos;S.printer=${encodeURIComponent(printer)};S.data=${b64};S.browser_fallback_url=${fallback};end`;
}

/** SUNMI POS terminals (V2 Pro, V2s, P2, T2…) — offer the built-in printer. */
export function isSunmi() {
  return /SUNMI|V2_PRO|V2s|V2 Pro|P2_PRO|T2s?\b/i.test(navigator.userAgent);
}

function writeRawBt(bytes: Uint8Array) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = btoa(bin);
  // Opens the RawBT app (Play Store: "RawBT print service"), which prints and returns.
  window.location.href = `intent:base64,${b64}#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;`;
}

export async function sendBytes(bytes: Uint8Array) {
  if (settings.mode === 'ble') return writeBle(bytes);
  if (settings.mode === 'rawbt') return writeRawBt(bytes);
  if (settings.mode === 'app') return writeApp(bytes);
  throw new Error('Chưa chọn máy in');
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------- documents ----------

export type PLine =
  | { t: 'text'; text: string; align?: 'left' | 'center' | 'right'; size?: 'sm' | 'md' | 'lg' | 'xl'; bold?: boolean; italic?: boolean; spacing?: number }
  | { t: 'row'; left: string; right: string; size?: 'sm' | 'md' | 'lg'; bold?: boolean; italic?: boolean }
  /** "Label:  value" with the label bold, as on Vietnamese POS bills. */
  | { t: 'field'; label: string; value: string }
  /** Bordered table: header row, wrapped cells, dashed inner column lines. Widths are fractions summing to 1. */
  | { t: 'table'; cols: { label: string; w: number; align?: 'left' | 'center' | 'right' }[]; rows: string[][] }
  /** Item line: qty column, wrapped name, amount on the right; optional detail line underneath. */
  | { t: 'item'; qty: string; name: string; right: string; detail?: string }
  /** White text on a black band (e.g. PAID / NOT PAID). */
  | { t: 'band'; text: string }
  | { t: 'hr'; dashed?: boolean; heavy?: boolean }
  | { t: 'space'; h?: number }
  | { t: 'image'; canvas: HTMLCanvasElement; width?: number };

const FONT = "'Be Vietnam Pro', 'Roboto', Arial, sans-serif";
const SIZES = { sm: 20, md: 24, lg: 30, xl: 44 };

function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const words = text.split(/\s+/);
  const out: string[] = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (ctx.measureText(test).width > max && cur) { out.push(cur); cur = w; } else cur = test;
  }
  if (cur) out.push(cur);
  return out.length ? out : [''];
}

/** Letter-spaced text (canvas letterSpacing is not on every Android WebView/Chrome version). */
function spaced(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, gap: number) {
  const align = ctx.textAlign;
  const chars = [...text];
  const total = chars.reduce((s, ch) => s + ctx.measureText(ch).width, 0) + gap * (chars.length - 1);
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  ctx.textAlign = 'left';
  for (const ch of chars) { ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + gap; }
  ctx.textAlign = align;
}

/** Draw a document onto a canvas exactly as wide as the print head. */
export function renderDoc(doc: PLine[], paper: 58 | 80): HTMLCanvasElement {
  const width = paper === 80 ? 576 : 384;
  const pad = 4;
  const canvas = document.createElement('canvas');
  const measure = canvas.getContext('2d')!;
  // first pass: measure height
  const ops: { y: number; draw: (ctx: CanvasRenderingContext2D) => void }[] = [];
  let y = 8;
  for (const l of doc) {
    if (l.t === 'space') { y += l.h ?? 12; continue; }
    if (l.t === 'image') {
      const w = Math.min(width - pad * 2, l.width ?? Math.round(width * 0.62));
      const h = Math.round((l.canvas.height / l.canvas.width) * w);
      const yy = y + 4;
      ops.push({ y: yy, draw: (ctx) => { ctx.imageSmoothingEnabled = false; ctx.drawImage(l.canvas, Math.round((width - w) / 2), yy, w, h); } });
      y += h + 8;
      continue;
    }
    if (l.t === 'hr') {
      const yy = y + 8;
      ops.push({ y: yy, draw: (ctx) => {
        ctx.setLineDash(l.heavy || l.dashed === false ? [] : [6, 5]);
        ctx.lineWidth = l.heavy ? 4 : 2;
        ctx.beginPath(); ctx.moveTo(pad, yy); ctx.lineTo(width - pad, yy); ctx.stroke();
        ctx.setLineDash([]); ctx.lineWidth = 2;
      } });
      y += 18;
      continue;
    }
    if (l.t === 'band') {
      const size = SIZES.md;
      const font = `800 ${size}px ${FONT}`;
      const top = y + 4, h = Math.round(size * 1.7);
      ops.push({ y: top, draw: (ctx) => {
        ctx.fillRect(pad, top, width - pad * 2, h);
        ctx.fillStyle = '#fff'; ctx.font = font; ctx.textAlign = 'center';
        spaced(ctx, l.text, width / 2, top + Math.round(h / 2 + size * 0.36), 4);
        ctx.fillStyle = '#000';
      } });
      y += h + 10;
      continue;
    }
    if (l.t === 'item') {
      const size = SIZES.md;
      const font = `400 ${size}px ${FONT}`;
      const bold = `700 ${size}px ${FONT}`;
      const small = `400 ${SIZES.sm}px ${FONT}`;
      const qtyW = 40;
      measure.font = bold;
      const rightW = measure.measureText(l.right).width;
      measure.font = font;
      const lines = wrap(measure, l.name, width - pad * 2 - qtyW - rightW - 14);
      const lh = Math.round(size * 1.3);
      lines.forEach((line, i) => {
        const yy = y + size;
        ops.push({ y: yy, draw: (ctx) => {
          if (i === 0) { ctx.font = bold; ctx.textAlign = 'left'; ctx.fillText(l.qty, pad, yy); ctx.textAlign = 'right'; ctx.fillText(l.right, width - pad, yy); }
          ctx.font = font; ctx.textAlign = 'left'; ctx.fillText(line, pad + qtyW, yy);
        } });
        y += lh;
      });
      if (l.detail) {
        measure.font = small;
        for (const line of wrap(measure, l.detail, width - pad * 2 - qtyW)) {
          const yy = y + SIZES.sm;
          ops.push({ y: yy, draw: (ctx) => { ctx.font = small; ctx.textAlign = 'left'; ctx.fillText(line, pad + qtyW, yy); } });
          y += Math.round(SIZES.sm * 1.25);
        }
      }
      y += 4;
      continue;
    }
    if (l.t === 'field') {
      const size = SIZES.sm + 1;
      const bold = `700 ${size}px ${FONT}`;
      const reg = `400 ${size}px ${FONT}`;
      measure.font = bold;
      const lw = measure.measureText(l.label + ' ').width;
      measure.font = reg;
      const lines = wrap(measure, l.value, width - pad * 2 - lw);
      lines.forEach((line, i) => {
        const yy = y + size;
        ops.push({ y: yy, draw: (ctx) => {
          if (i === 0) { ctx.font = bold; ctx.textAlign = 'left'; ctx.fillText(l.label, pad, yy); }
          ctx.font = reg; ctx.textAlign = 'left'; ctx.fillText(line, pad + lw, yy);
        } });
        y += Math.round(size * 1.35);
      });
      continue;
    }
    if (l.t === 'table') {
      const size = 19;
      const font = (w: number, px: number) => `${w} ${px}px ${FONT}`;
      const inner = width - pad * 2;
      const xs: number[] = [pad];
      for (const c of l.cols) xs.push(xs[xs.length - 1] + Math.round(c.w * inner));
      xs[xs.length - 1] = width - pad;
      const cellPad = 4;
      const lh = Math.round(size * 1.25);
      // Text columns wrap; number columns stay on one line and shrink to fit (e.g. 1.250.000 in a narrow cell).
      const layoutRow = (cells: string[], head: boolean) => {
        const w = head ? 700 : 400;
        const cellsOut = cells.map((txt, k) => {
          const room = xs[k + 1] - xs[k] - cellPad * 2;
          const wraps = head || (l.cols[k].align ?? 'left') === 'left';
          measure.font = font(w, size);
          if (wraps) return { lines: wrap(measure, txt, room), px: size };
          const tw = measure.measureText(txt).width;
          return { lines: [txt], px: tw > room ? Math.max(12, Math.floor((size * room) / tw)) : size };
        });
        const lines = Math.max(1, ...cellsOut.map((c) => c.lines.length));
        return { cells: cellsOut, w, h: lines * lh + cellPad * 2 + 2 };
      };
      const top = y + 2;
      let yy = top;
      const rowsLayout = [{ ...layoutRow(l.cols.map((c) => c.label), true), head: true }, ...l.rows.map((r) => ({ ...layoutRow(r, false), head: false }))];
      const rowYs: number[] = [];
      for (const r of rowsLayout) {
        const ry = yy;
        rowYs.push(ry);
        ops.push({ y: ry, draw: (ctx) => {
          r.cells.forEach((c, k) => {
            const align = r.head ? 'center' : l.cols[k].align ?? 'left';
            const x = align === 'center' ? (xs[k] + xs[k + 1]) / 2 : align === 'right' ? xs[k + 1] - cellPad : xs[k] + cellPad;
            ctx.font = font(r.w, c.px);
            ctx.textAlign = align;
            c.lines.forEach((line, n) => ctx.fillText(line, x, ry + cellPad + size + n * lh));
          });
        } });
        yy += r.h;
      }
      const bottom = yy;
      ops.push({ y: top, draw: (ctx) => {
        ctx.lineWidth = 2;
        ctx.strokeRect(xs[0], top, xs[xs.length - 1] - xs[0], bottom - top);
        for (let k = 1; k < rowYs.length; k++) { ctx.beginPath(); ctx.moveTo(xs[0], rowYs[k]); ctx.lineTo(xs[xs.length - 1], rowYs[k]); ctx.stroke(); }
        // Column lines dashed, like the printed sample.
        ctx.setLineDash([4, 3]);
        for (let k = 1; k < xs.length - 1; k++) { ctx.beginPath(); ctx.moveTo(xs[k], top); ctx.lineTo(xs[k], bottom); ctx.stroke(); }
        ctx.setLineDash([]);
      } });
      y = bottom + 8;
      continue;
    }
    const size = SIZES[l.size ?? 'md'];
    const font = `${l.italic ? 'italic ' : ''}${l.bold ? 700 : 400} ${size}px ${FONT}`;
    measure.font = font;
    const lh = Math.round(size * 1.3);
    if (l.t === 'text') {
      for (const line of wrap(measure, l.text, width - pad * 2)) {
        const yy = y + size;
        const align = l.align ?? 'left';
        const x = align === 'center' ? width / 2 : align === 'right' ? width - pad : pad;
        ops.push({ y: yy, draw: (ctx) => { ctx.font = font; ctx.textAlign = align; if (l.spacing) spaced(ctx, line, x, yy, l.spacing); else ctx.fillText(line, x, yy); } });
        y += lh;
      }
    } else {
      const rightW = measure.measureText(l.right).width;
      const leftLines = wrap(measure, l.left, width - pad * 2 - rightW - 12);
      leftLines.forEach((line, i) => {
        const yy = y + size;
        ops.push({ y: yy, draw: (ctx) => {
          ctx.font = font; ctx.textAlign = 'left'; ctx.fillText(line, pad, yy);
          if (i === 0) { ctx.textAlign = 'right'; ctx.fillText(l.right, width - pad, yy); }
        } });
        y += lh;
      });
    }
  }
  canvas.width = width;
  canvas.height = Math.ceil(y + 16);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2;
  for (const op of ops) op.draw(ctx);
  return canvas;
}

/** Canvas → ESC/POS: init, raster bands (GS v 0), feed, optional drawer kick, partial cut. */
export function canvasToEscPos(canvas: HTMLCanvasElement, opts: { kick?: boolean } = {}): Uint8Array {
  const ctx = canvas.getContext('2d')!;
  const { width, height } = canvas;
  const img = ctx.getImageData(0, 0, width, height).data;
  const bytesPerRow = Math.ceil(width / 8);
  const out: number[] = [0x1b, 0x40]; // ESC @
  const band = 128;
  for (let top = 0; top < height; top += band) {
    const h = Math.min(band, height - top);
    out.push(0x1d, 0x76, 0x30, 0x00, bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff, h & 0xff, (h >> 8) & 0xff);
    for (let y = top; y < top + h; y++) {
      for (let bx = 0; bx < bytesPerRow; bx++) {
        let byte = 0;
        for (let bit = 0; bit < 8; bit++) {
          const x = bx * 8 + bit;
          if (x >= width) continue;
          const i = (y * width + x) * 4;
          const lum = 0.299 * img[i] + 0.587 * img[i + 1] + 0.114 * img[i + 2];
          if (lum < 150) byte |= 0x80 >> bit;
        }
        out.push(byte);
      }
    }
  }
  out.push(0x1b, 0x64, 0x04); // feed 4 lines
  if (opts.kick) out.push(0x1b, 0x70, 0x00, 0x19, 0xfa); // ESC p 0 25 250
  out.push(0x1d, 0x56, 0x42, 0x00); // partial cut (ignored by printers without a cutter)
  return new Uint8Array(out);
}

export async function printDoc(doc: PLine[], opts: { kick?: boolean; copies?: number } = {}) {
  const canvas = renderDoc(doc, settings.paper);
  const bytes = canvasToEscPos(canvas, opts);
  const copies = Math.max(1, opts.copies ?? 1);
  if (settings.mode === 'rawbt' || settings.mode === 'app') {
    // One hand-off to the other app: all copies in a single job.
    const all = new Uint8Array(bytes.length * copies);
    for (let i = 0; i < copies; i++) all.set(bytes, i * bytes.length);
    return sendBytes(all);
  }
  for (let i = 0; i < copies; i++) await sendBytes(i === 0 ? bytes : canvasToEscPos(canvas));
}

/** Just open the cash drawer. */
export async function kickDrawer() {
  await sendBytes(new Uint8Array([0x1b, 0x40, 0x1b, 0x70, 0x00, 0x19, 0xfa]));
}

/** React hook: current printer link (for the reconnect banner). */
export function usePrinterLink(): PrinterLink {
  return useSyncExternalStore(onPrinterLink, printerLink);
}
