// VietQR (NAPAS 247) dynamic payload, EMVCo format. Built locally so it also works offline.

function tlv(id: string, value: string): string {
  return id + String(value.length).padStart(2, '0') + value;
}

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF), as required by EMVCo tag 63. */
export function crc16(input: string): string {
  let crc = 0xffff;
  const bytes = new TextEncoder().encode(input);
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** Bank transfer note: ASCII letters/digits/spaces only, max 25 chars (safest across banks). */
export function cleanPurpose(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .replace(/[^A-Za-z0-9 ]/g, '')
    .slice(0, 25)
    .trim();
}

export interface VietQrInput {
  bankBin: string;   // 6-digit NAPAS BIN, e.g. 970436 (Vietcombank)
  account: string;   // account number
  amount: number;    // VND
  purpose: string;   // e.g. "DUI A012"
}

export function vietQrPayload(q: VietQrInput): string {
  const merchant = tlv('00', 'A000000727') + tlv('01', tlv('00', q.bankBin) + tlv('01', q.account)) + tlv('02', 'QRIBFTTA');
  let s = '';
  s += tlv('00', '01');
  s += tlv('01', '12'); // dynamic QR (has an amount)
  s += tlv('38', merchant);
  s += tlv('53', '704');
  s += tlv('54', String(Math.round(q.amount)));
  s += tlv('58', 'VN');
  const purpose = cleanPurpose(q.purpose);
  if (purpose) s += tlv('62', tlv('08', purpose));
  s += '6304';
  return s + crc16(s);
}
