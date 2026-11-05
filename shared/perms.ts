// Permissions ("phân quyền"). The owner can do everything. Everyone else gets a set of permission keys:
// by default from their role (manager: all of these, staff: none = selling only), or a custom set the
// owner picks in Quản trị › Nhân viên & tài khoản. Owner-only things (staff, devices, settings, prices,
// promotions, floor plan) are never delegated.
import type { Role } from './types';

export type Perm = 'revenue' | 'orders_all' | 'ledger' | 'menu' | 'inventory' | 'costing' | 'time' | 'audit' | 'approve';

export const PERMS: { key: Perm; label: string; sub: string; admin: boolean }[] = [
  { key: 'revenue', label: 'Xem doanh thu & báo cáo', sub: 'Tổng quan, phân tích & cảnh báo, báo cáo tháng/quý, sổ S1a', admin: true },
  { key: 'orders_all', label: 'Xem đơn của mọi người', sub: 'Đơn hôm nay của tất cả nhân viên và mọi máy', admin: false },
  { key: 'approve', label: 'Duyệt thay quản lý', sub: 'Bỏ món đã gửi, mời, chi két vượt hạn mức, đóng két', admin: false },
  { key: 'ledger', label: 'Sổ thu chi & ngân hàng', sub: 'Ghi chi phí, xem/khớp giao dịch chuyển khoản', admin: true },
  { key: 'menu', label: 'Sửa menu & tuỳ chọn', sub: 'Thêm món, ảnh, hết hàng (đổi giá vẫn chỉ chủ quán)', admin: true },
  { key: 'inventory', label: 'Kho', sub: 'Tồn kho, nhập hàng, kiểm kê, nhà cung cấp', admin: true },
  { key: 'costing', label: 'Giá vốn', sub: 'Cost %, lãi theo món, công thức', admin: true },
  { key: 'time', label: 'Giờ làm', sub: 'Bảng công, sửa giờ, xếp lịch (lương giờ chỉ chủ quán thấy)', admin: true },
  { key: 'audit', label: 'Nhật ký', sub: 'Lịch sử huỷ, mời, đổi giá, thu chi', admin: true },
];
export const ALL_PERMS: Perm[] = PERMS.map((p) => p.key);

/** Ready-made sets ("loại phân quyền") the owner can apply with one tap, then fine-tune. */
export const PRESETS: { key: string; label: string; sub: string; perms: Perm[] }[] = [
  { key: 'sell', label: 'Chỉ bán hàng', sub: 'Lên đơn, thu tiền, chấm công', perms: [] },
  { key: 'lead', label: 'Trưởng ca', sub: 'Duyệt huỷ/mời, xem mọi đơn, giờ làm', perms: ['approve', 'orders_all', 'time'] },
  { key: 'cashier', label: 'Thu ngân', sub: 'Xem mọi đơn, doanh thu, sổ thu chi', perms: ['orders_all', 'revenue', 'ledger'] },
  { key: 'bar', label: 'Pha chế trưởng', sub: 'Menu, kho, giá vốn', perms: ['menu', 'inventory', 'costing'] },
  { key: 'accountant', label: 'Kế toán', sub: 'Doanh thu, sổ thu chi, giá vốn, nhật ký', perms: ['revenue', 'orders_all', 'ledger', 'costing', 'audit'] },
  { key: 'manager', label: 'Quản lý đầy đủ', sub: 'Tất cả, trừ việc chỉ chủ quán làm', perms: ALL_PERMS },
];

export function roleDefault(role: Role): Perm[] {
  return role === 'staff' ? [] : ALL_PERMS;
}

/** The effective permissions of one person. `perms` is the stored JSON (null = role default). */
export function permsOf(s: { role: Role; perms?: string | null } | null | undefined): Perm[] {
  if (!s) return [];
  if (s.role === 'owner') return ALL_PERMS;
  if (s.perms) {
    try {
      const v = JSON.parse(s.perms);
      if (Array.isArray(v)) return v.filter((k): k is Perm => ALL_PERMS.includes(k));
    } catch { /* fall back to the role */ }
  }
  return roleDefault(s.role);
}

export function hasPerm(s: { role: Role; perms?: string | null } | null | undefined, ...anyOf: Perm[]): boolean {
  if (!s) return false;
  if (s.role === 'owner') return true;
  const mine = permsOf(s);
  return anyOf.some((p) => mine.includes(p));
}

/** Can open Quản trị at all (owner, or any back-office permission). */
export function canAdmin(s: { role: Role; perms?: string | null } | null | undefined): boolean {
  return !!s && (s.role === 'owner' || permsOf(s).some((p) => PERMS.find((x) => x.key === p)?.admin));
}

/** Name of the preset matching a set exactly, else "Tuỳ chỉnh". */
export function presetName(role: Role, perms: Perm[]): string {
  if (role === 'owner') return 'Toàn quyền';
  const key = [...perms].sort().join(',');
  return PRESETS.find((p) => [...p.perms].sort().join(',') === key)?.label ?? `Tuỳ chỉnh (${perms.length} quyền)`;
}
