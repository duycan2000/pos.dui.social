// Types shared by the Android app (browser) and the Worker.

export type Role = 'owner' | 'manager' | 'staff';

export interface Outlet {
  id: string;
  name: string;
  tz_offset_min: number;
  business_day_cutoff: string; // "HH:MM"
  business_type: string;
  vietqr_bank_bin: string | null;
  vietqr_account: string | null;
  vietqr_account_name: string | null;
  receipt_header: string | null;
  receipt_footer: string | null;
  settings_json: string;
}

export interface OutletSettings {
  /** Yearly revenue threshold for the tax warning, VND. Verify with the accountant. */
  tax_threshold_year?: number;
  /** Cost % above which an item is flagged in costing. */
  cost_alert_pct?: number;
  /** Seconds before S15 returns to a new order. */
  done_return_seconds?: number;
  /** Free-text tax method note. Rates are never hard-coded. */
  tax_note?: string;
  /** Extra pay for hours worked 22:00–06:00, % of the hourly rate (0 = none). */
  night_premium_pct?: number;
  /** Minutes after the scheduled start before a clock-in counts as late. */
  late_grace_min?: number;
  /** Guest bill labels: English (default) or Vietnamese. */
  bill_lang?: 'en' | 'vi';
  /** Lines printed in bold above the thank-you line (one per line). */
  bill_note?: string;
  wifi_pass?: string;
  /** Also print the bank QR on the pre-bill (tạm tính), not only when the guest picks transfer. */
  prebill_qr?: boolean;
  /** Business details printed on tax books (Mẫu S1a-HKD). */
  tax_info?: TaxInfo;
}

export interface TaxInfo {
  /** Tên hộ / cá nhân kinh doanh (or company name). */
  business_name?: string;
  /** Người đại diện ký sổ. */
  representative?: string;
  address?: string;
  /** Địa điểm kinh doanh (defaults to the address). */
  location?: string;
  tax_code?: string;
  /** Diễn giải on each line, e.g. "Bán hàng tại cửa hàng Dui Social". */
  description?: string;
  /** One line per order (like the sample) or one line per day. */
  mode?: 'order' | 'day';
  unit?: string;
}

export interface StaffPublic {
  id: string;
  name: string;
  role: Role;
  active: number;
  pin_salt: string;
  pin_hash: string;
  max_discount_pct: number;
  cash_out_limit: number;
}

export interface Category { id: string; name_en: string; name_vi: string; sort: number; active: number }
export interface Item {
  id: string; category_id: string; name_en: string; name_vi: string;
  desc_en: string | null; desc_vi: string | null; price: number; image_key: string | null;
  active: number; sold_out: number; show_on_web: number; sort: number;
}
export interface ModifierGroup { id: string; name_en: string; name_vi: string; selection: 'single' | 'multi'; required: number; sort: number }
export interface ModifierOption {
  id: string; group_id: string; name_en: string; name_vi: string; price_delta: number;
  is_default: number; excludes_promo: number; sort: number; active: number;
}
export interface ItemModifierGroup { item_id: string; group_id: string; sort: number }
export interface Promotion {
  id: string; name: string; type: string; active: number; start_date: string | null; end_date: string | null;
  days_of_week: string | null; time_from: string | null; time_to: string | null; rule_json: string;
}
export interface PromotionItem { promotion_id: string; item_id: string }

export interface DiningTable {
  id: string; area: string; name: string; seats: number; x: number; y: number; w: number; h: number;
  shape: 'square' | 'round' | 'bar'; sort: number; active?: number;
}

/** Chấm công: one clock-in to clock-out. */
export interface TimeEntry {
  id: string; staff_id: string; business_day: string; clock_in: number; clock_out: number | null; break_min: number;
  device_id: string | null; source: 'pos' | 'admin'; note: string | null; edited_by?: string | null; edited_at?: number | null;
  created_at: number; updated_at: number;
}

/** Lịch làm: a planned shift on a business day. end < start = ends after midnight. */
export interface WorkShift { id: string; staff_id: string; day: string; start: string; end: string; note: string | null }

export interface DeviceInfo { id: string; name: string; order_prefix: string; outlet_id: string }

export interface PosConfig {
  outlet: Outlet;
  device: DeviceInfo;
  staff: StaffPublic[];
  categories: Category[];
  items: Item[];
  modifierGroups: ModifierGroup[];
  modifierOptions: ModifierOption[];
  itemModifierGroups: ItemModifierGroup[];
  promotions: Promotion[];
  promotionItems: PromotionItem[];
  tables?: DiningTable[];
  features?: { bankWebhook: boolean };
}

export type OrderStatus = 'open' | 'awaiting_payment' | 'paid' | 'void';
export type PayMethod = 'cash' | 'vietqr' | 'card';

export interface ChosenOption { id: string; group_id: string; name: string; price_delta: number; excludes_promo: number }

export interface OrderLine {
  id: string;
  item_id: string;
  item_name: string;
  unit_price: number; // base price + option deltas
  qty: number;
  modifiers: ChosenOption[];
  line_total: number;
  note: string | null;
  status: 'active' | 'removed';
  removed_by?: string | null;
  removed_reason?: string | null;
  sort: number;
  /** Ly mời: free for the guest, still deducted from stock and counted as cost. */
  comp?: number;
  comp_reason?: string | null;
  comp_by?: string | null;
  /** Set once the line has been saved to a tab or an order (then removal needs a reason). */
  sent_at?: number | null;
}

export interface OrderAdjustment {
  id: string;
  order_line_id: string | null;
  kind: 'promo' | 'discount';
  promotion_id: string | null;
  amount: number;
  reason: string | null;
  staff_id: string | null;
  approved_by: string | null;
}

export interface Payment {
  id: string;
  method: PayMethod;
  /** Applied to the bill (excludes tip). */
  amount: number;
  /** Tip on top of the bill, kept out of revenue. Cash tips stay in the drawer. */
  tip?: number;
  bank_txn_id?: string | null;
  tendered: number | null;
  change_given: number;
  reference: string | null;
  status: 'pending' | 'confirmed' | 'cancelled';
  confirmed_by: string | null;
  confirmed_at: number | null;
  drawer_session_id: string | null;
  created_at: number;
}

export interface Order {
  id: string;
  outlet_id: string;
  device_id: string;
  short_code: string;
  business_day: string;
  staff_id: string;
  staff_shift_id: string | null;
  drawer_session_id: string | null;
  order_type: 'takeaway' | 'dine_in' | 'message';
  customer_label: string | null;
  status: OrderStatus;
  subtotal: number;
  promo_total: number;
  discount_total: number;
  comp_total?: number;
  tip_total?: number;
  total: number;
  /** Dine-in table. Unpaid until checkout; the table shows as busy while the order is open. */
  table_id?: string | null;
  guests?: number | null;
  /** When the pre-bill (tạm tính) was printed. Cleared when a new round is sent. */
  prebill_at?: number | null;
  /** This tab was merged into another order (kept as void with zero totals). */
  merged_into?: string | null;
  sent_at: number | null;
  paid_at: number | null;
  void_reason: string | null;
  voided_by: string | null;
  approved_by: string | null;
  voided_at: number | null;
  created_at: number;
  updated_at: number;
  lines: OrderLine[];
  adjustments: OrderAdjustment[];
  payments: Payment[];
}

export interface DrawerSession {
  id: string;
  outlet_id: string;
  business_day: string;
  status: 'open' | 'closed';
  opened_by: string;
  opened_at: number;
  opening_float: number;
  opening_count_json: string | null;
  closed_by: string | null;
  closed_at: number | null;
  counted_json: string | null;
  counted_total: number | null;
  expected_total: number | null;
  difference: number | null;
  note: string | null;
  device_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface StaffShift {
  id: string; staff_id: string; outlet_id: string; device_id: string; drawer_session_id: string | null;
  business_day: string; started_at: number; ended_at: number | null; created_at: number; updated_at: number;
}

export interface CashMovement {
  id: string; drawer_session_id: string; business_day: string; direction: 'in' | 'out'; amount: number;
  reason: string; note: string | null; photo_key: string | null; purchase_id: string | null;
  staff_id: string; approved_by: string | null; device_id: string | null; created_at: number; updated_at: number;
}

export interface AuditEntry {
  id: string; outlet_id: string | null; device_id: string | null; at: number; actor_id: string | null;
  approver_id: string | null; action: string; entity: string | null; entity_id: string | null;
  before_json: string | null; after_json: string | null; reason: string | null;
}

export type SyncRecord =
  | { type: 'order'; data: Order }
  | { type: 'drawer_session'; data: DrawerSession }
  | { type: 'staff_shift'; data: StaffShift }
  | { type: 'cash_movement'; data: CashMovement }
  | { type: 'audit_log'; data: AuditEntry }
  | { type: 'time_entry'; data: TimeEntry };

export interface ZReport {
  drawer_session_id: string;
  business_day: string;
  opened_at: number;
  closed_at: number | null;
  gross_sales: number;
  promo_total: number;
  discount_total: number;
  net_sales: number;
  orders: number;
  by_method: Record<PayMethod, number>;
  voids: number;
  void_value: number;
  cash_in: number;
  cash_out: number;
  opening_float: number;
  cash_sales: number;
  change_given: number;
  expected_cash: number;
  counted_cash: number | null;
  difference: number | null;
  pending_vietqr: number;
  comp_value: number;
  tips: Record<PayMethod, number>;
  open_tabs: number;
}

export const DENOMINATIONS = [500000, 200000, 100000, 50000, 20000, 10000, 5000, 2000, 1000];
