// "Dui" the pug: the bar's mascot. Peeks up from the bottom corner now and then with a short greeting,
// always shows up for the moments worth celebrating (signing in, a paid order, clocking in).
// One inline SVG (~3 KB) animated with CSS; tap it to send it away; can be switched off per device.
import { useEffect, useRef, useState } from 'react';
import { getState, useStore } from './lib/store';

type Mood = 'wave' | 'happy' | 'party' | 'sleepy';
interface Say { text: string; mood: Mood }

const KEY = 'pug';
const COOLDOWN_MS = 4 * 60 * 1000; // at most one casual visit every 4 minutes
const CHANCE = 0.35; // and only on about a third of page changes after that
const SHOW_MS = 4800;

export function pugEnabled() {
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
}
export function setPugEnabled(on: boolean) {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* ignore */ }
  window.dispatchEvent(new Event('pug-pref'));
}

let push: ((s: Say) => void) | null = null;
/** Make the pug say something now (ignores the cooldown). */
export function pugSay(text: string, mood: Mood = 'happy') { push?.({ text, mood }); }

const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

function greeting(name: string) {
  const h = new Date().getHours();
  const first = name.split(' ').pop();
  if (h < 5) return pick([`Khuya rồi ${first} ơi, cố lên! 🌙`, `Ca đêm vất vả quá ${first}!`]);
  if (h < 11) return pick([`Chào buổi sáng ${first}! ☀️`, `Hello ${first}, hôm nay đẹp trời ghê!`]);
  if (h < 17) return pick([`Chào ${first}! Chiều nay đông khách nhé!`, `Hi ${first}! Uống nước chưa? 💧`]);
  return pick([`Chào ${first}! Tối nay quẩy thôi! 🍸`, `Gâu! ${first} tới rồi, mở nhạc lên nào!`, `Hello ${first}! Chúc ca tối thật đông 🎶`]);
}

/** Casual lines per screen. */
const LINES: Record<string, string[]> = {
  order: ['Gâu! Món nào đang hot hôm nay?', 'Nhớ mời khách thử signature nhé 🍹', 'Chạm giữ món để chọn ít đá, ít đường nha', 'Bấm nhầm? Nút “− n” ở góc món nè'],
  tables: ['Bàn nào cũng đông thì vui ghê!', 'Bàn xanh là đã in tạm tính đó', 'Khách gọi thêm thì chạm bàn → Gọi thêm', 'Kiểm tra bàn nào ngồi lâu chưa gọi thêm nha'],
  tabs: ['Tab nào sắp về thì nhắc thanh toán nha', 'Gâu! Đừng để tab treo qua đêm nhé'],
  orders: ['Đơn chờ chuyển khoản sẽ tự xác nhận khi tiền vào', 'Hôm nay bán được nhiều chưa nè?'],
  cashmove: ['Chi két nhớ chụp hoá đơn nha 📸'],
  clock: ['Chấm công đúng giờ là ngoan nhất! ⏰'],
  printer: ['Máy in kêu rè rè là đang chạy đó'],
  close: ['Đếm tiền kỹ nha, mình chờ được 🐾', 'Sắp xong ca rồi, cố lên!'],
  admin: ['Sếp tới rồi! Gâu gâu 🫡', 'Xem Phân tích để biết tháng này lãi chưa nha'],
  'admin/analytics': ['Số đẹp quá trời! 📈', 'Có cảnh báo đỏ thì xem kỹ nha sếp'],
  'admin/menu': ['Thêm món mới hả? Cho mình nếm thử với!'],
  'admin/s1a': ['Sổ sách gọn gàng, thuế không lo 📒'],
  'admin/time': ['Ai đi trễ hôm nay vậy ta? 🧐'],
  'admin/tables': ['Kéo thả bàn cho giống quán thật nha'],
};

function lineFor(route: string) {
  const key = Object.keys(LINES).sort((a, b) => b.length - a.length).find((k) => route === k || route.startsWith(k + '/'));
  return key ? pick(LINES[key]) : null;
}

export function PugHost() {
  const route = useStore((s) => s.route);
  const staffId = useStore((s) => s.staff?.id);
  const [say, setSay] = useState<Say | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [on, setOn] = useState(pugEnabled);
  const last = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const prevStaff = useRef<string | undefined>(undefined);

  const show = (s: Say) => {
    if (!pugEnabled()) return;
    clearTimeout(timer.current);
    setLeaving(false);
    setSay(s);
    last.current = Date.now();
    timer.current = setTimeout(() => { setLeaving(true); timer.current = setTimeout(() => setSay(null), 450); }, SHOW_MS);
  };
  useEffect(() => { push = show; return () => { push = null; }; });
  useEffect(() => { const f = () => setOn(pugEnabled()); window.addEventListener('pug-pref', f); return () => window.removeEventListener('pug-pref', f); }, []);

  // Always: greet whoever just signed in.
  useEffect(() => {
    if (staffId && staffId !== prevStaff.current) {
      const s = getState().staff;
      if (s) setTimeout(() => show({ text: greeting(s.name), mood: 'wave' }), 700);
    }
    prevStaff.current = staffId;
  }, [staffId]); // eslint-disable-line

  // Always: celebrate a paid order. Sometimes: say hello on other screens.
  useEffect(() => {
    if (route === 'done') {
      const o = getState().lastPaid?.order;
      const tip = o?.tip_total ? ' Có cả tip nữa! 💛' : '';
      show({ text: pick(['Ting ting! Tiền về rồi! 🎉', 'Gâu gâu! Thêm một đơn nữa nè!', 'Tuyệt vời! Khách vui, quán vui 🥳']) + tip, mood: 'party' });
      return;
    }
    if (route === 'checkout' || route === 'login' || !getState().staff) return; // don't distract while taking money
    if (Date.now() - last.current < COOLDOWN_MS || Math.random() > CHANCE) return;
    const text = lineFor(route);
    if (text) { const t = setTimeout(() => show({ text, mood: pick(['wave', 'happy', 'happy']) as Mood }), 900); return () => clearTimeout(t); }
  }, [route]); // eslint-disable-line

  if (!on || !say) return null;
  return (
    <div className={'pug-host' + (leaving ? ' leaving' : '')} role="status" aria-live="polite">
      <div className="pug-bubble">{say.text}</div>
      <button className="pug-btn" aria-label="Pug Dui — chạm để tạm biệt" onClick={() => { setLeaving(true); clearTimeout(timer.current); timer.current = setTimeout(() => setSay(null), 450); }}>
        <PugSvg mood={say.mood} />
      </button>
    </div>
  );
}

/** The pug itself: fawn coat, black mask, curly tail. Parts carry classes that styles.css animates. */
export function PugSvg({ mood = 'happy', size = 96 }: { mood?: Mood; size?: number }) {
  const fawn = '#e8c497';
  const fawnDark = '#d2a674';
  const mask = '#3a2a22';
  return (
    <svg className={'pug mood-' + mood} width={size} height={size} viewBox="0 0 120 120" aria-hidden="true">
      {/* tail */}
      <g className="pug-tail">
        <path d="M92 92 c10 -6 14 -18 6 -22 c-6 -3 -10 4 -5 7" fill="none" stroke={fawnDark} strokeWidth="7" strokeLinecap="round" />
      </g>
      {/* body */}
      <ellipse cx="60" cy="108" rx="34" ry="24" fill={fawn} />
      <ellipse cx="60" cy="112" rx="20" ry="12" fill="#f3d9b5" />
      {/* waving paw */}
      <g className="pug-paw">
        <ellipse cx="96" cy="86" rx="9" ry="11" fill={fawn} stroke={fawnDark} strokeWidth="1.5" />
        <path d="M91 80 v-3 M96 78 v-3 M101 80 v-3" stroke={mask} strokeWidth="1.6" strokeLinecap="round" />
      </g>
      {/* head */}
      <g className="pug-head">
        <g className="pug-ear l"><path d="M30 34 C16 30 14 52 26 54 C30 46 33 40 30 34 Z" fill={mask} /></g>
        <g className="pug-ear r"><path d="M90 34 C104 30 106 52 94 54 C90 46 87 40 90 34 Z" fill={mask} /></g>
        <ellipse cx="60" cy="56" rx="35" ry="31" fill={fawn} />
        {/* forehead wrinkles */}
        <path d="M50 36 q10 -5 20 0 M47 42 q13 -6 26 0" fill="none" stroke={fawnDark} strokeWidth="2" strokeLinecap="round" />
        {/* mask */}
        <ellipse cx="60" cy="70" rx="21" ry="15" fill={mask} />
        <ellipse cx="44" cy="56" rx="10" ry="10" fill={mask} opacity=".85" />
        <ellipse cx="76" cy="56" rx="10" ry="10" fill={mask} opacity=".85" />
        {/* eyes */}
        <g className="pug-eyes">
          <circle cx="44" cy="56" r="7.5" fill="#fff" />
          <circle cx="76" cy="56" r="7.5" fill="#fff" />
          <circle className="pupil" cx="45" cy="57" r="5" fill="#1a110c" />
          <circle className="pupil" cx="77" cy="57" r="5" fill="#1a110c" />
          <circle cx="46.8" cy="55" r="1.7" fill="#fff" />
          <circle cx="78.8" cy="55" r="1.7" fill="#fff" />
        </g>
        {/* nose + mouth */}
        <ellipse cx="60" cy="66" rx="6.5" ry="4.5" fill="#120b08" />
        <path d="M60 70 v4 M60 74 q-6 5 -11 1 M60 74 q6 5 11 1" fill="none" stroke="#120b08" strokeWidth="2" strokeLinecap="round" />
        <g className="pug-tongue"><path d="M55 77 q5 10 10 0 z" fill="#ff7d8e" /></g>
        {/* cheeks */}
        <ellipse cx="36" cy="72" rx="5" ry="3" fill="#ff9aa8" opacity=".55" />
        <ellipse cx="84" cy="72" rx="5" ry="3" fill="#ff9aa8" opacity=".55" />
        {/* party hat */}
        {mood === 'party' && (
          <g className="pug-hat">
            <path d="M60 6 L74 30 L46 30 Z" fill="var(--accent)" />
            <path d="M50 24 l6 -4 M58 26 l8 -6 M54 16 l6 -4" stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity=".8" />
            <circle cx="60" cy="6" r="4" fill="#ff7d8e" />
          </g>
        )}
      </g>
    </svg>
  );
}
