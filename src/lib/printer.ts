// Bluetooth receipt printing for Android Chrome.
//
//  • "ble"   — Web Bluetooth straight from Chrome. Works with printers that expose a BLE service
//              (most recent 58/80 mm "BLE" or "dual-mode" printers).
//  • "rawbt" — sends the bytes to the free RawBT app, which talks to classic-Bluetooth printers
//              (the older SPP-only printers that Web Bluetooth cannot reach).
//
// Receipts are rendered to an image and sent as ESC/POS raster (GS v 0), so Vietnamese diacritics
// print correctly on any printer — no code page needed.
import { kv } from './db';

export interface PrinterSettings {
  mode: 'none' | 'ble' | 'rawbt';
  paper: 58 | 80;
  autoReceipt: boolean;   // print the bill after each payment
  autoTicket: boolean;    // print a bar ticket when an order or a tab round is sent
  openDrawer: boolean;    // kick the cash drawer on cash payments (printer must have an RJ11 port)
  copies: number;
  deviceName?: string;
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

/** Pair with a printer (must be called from a tap). */
export async function pairBle(): Promise<string> {
  if (!bleSupported()) throw new Error('Trình duyệt này không hỗ trợ Bluetooth. Dùng Chrome trên Android, hoặc chọn kiểu RawBT.');
  device = await (navigator as any).bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: SERVICES });
  device.addEventListener('gattserverdisconnected', () => { characteristic = null; });
  const server = await device.gatt.connect();
  characteristic = await findWritable(server);
  return device.name || 'Máy in';
}

async function ensureBle() {
  if (characteristic && device?.gatt?.connected) return;
  if (!device) {
    // Chrome can return previously-allowed devices without a new picker (where supported).
    const known: any[] = (await (navigator as any).bluetooth?.getDevices?.().catch(() => [])) || [];
    device = known.find((d) => !settings.deviceName || d.name === settings.deviceName) || null;
  }
  if (!device) throw new Error('Chưa kết nối máy in. Vào Máy in › Kết nối.');
  const server = await device.gatt.connect();
  characteristic = await findWritable(server);
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
  throw new Error('Chưa chọn máy in');
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------- documents ----------

export type PLine =
  | { t: 'text'; text: string; align?: 'left' | 'center' | 'right'; size?: 'sm' | 'md' | 'lg' | 'xl'; bold?: boolean }
  | { t: 'row'; left: string; right: string; size?: 'sm' | 'md' | 'lg'; bold?: boolean }
  | { t: 'hr'; dashed?: boolean }
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
      ops.push({ y: yy, draw: (ctx) => { ctx.setLineDash(l.dashed === false ? [] : [6, 5]); ctx.beginPath(); ctx.moveTo(pad, yy); ctx.lineTo(width - pad, yy); ctx.stroke(); ctx.setLineDash([]); } });
      y += 18;
      continue;
    }
    const size = SIZES[l.size ?? 'md'];
    const font = `${l.bold ? 700 : 400} ${size}px ${FONT}`;
    measure.font = font;
    const lh = Math.round(size * 1.3);
    if (l.t === 'text') {
      for (const line of wrap(measure, l.text, width - pad * 2)) {
        const yy = y + size;
        const align = l.align ?? 'left';
        ops.push({ y: yy, draw: (ctx) => { ctx.font = font; ctx.textAlign = align; ctx.fillText(line, align === 'center' ? width / 2 : align === 'right' ? width - pad : pad, yy); } });
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
  for (let i = 0; i < copies; i++) await sendBytes(i === 0 ? bytes : canvasToEscPos(canvas));
}

/** Just open the cash drawer. */
export async function kickDrawer() {
  await sendBytes(new Uint8Array([0x1b, 0x40, 0x1b, 0x70, 0x00, 0x19, 0xfa]));
}
