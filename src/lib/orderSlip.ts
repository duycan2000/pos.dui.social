// TEMPORARY (18/11/2026): one-off buyer reprint of a marketplace order's details. Delete with its button.
import type { PLine } from './printer';

export const ORDER_SLIP: PLine[] = [
        { t: 'text', text: 'LAZADA', align: 'center', size: 'xl', bold: true, spacing: 4 },
        { t: 'text', text: 'Thông tin đơn · bản in lại bởi người mua', align: 'center', size: 'sm', italic: true },
        { t: 'table', cols: [{ label: 'Mã vận đơn', w: 0.36 }, { label: 'JNTXB1015104035', w: 0.64 }], rows: [
          ['Mã đơn hàng', '530459438762670'],
          ['Vận chuyển', 'Giao hàng Tiêu chuẩn'],
        ] },
        { t: 'space', h: 6 },
        { t: 'table', cols: [{ label: 'Người nhận', w: 0.36 }, { label: 'Hoang Duy', w: 0.64 }], rows: [
          ['Địa chỉ', '42 An Thượng 2, Đà Nẵng'],
        ] },
        { t: 'space', h: 6 },
        { t: 'table', cols: [{ label: 'Sản phẩm', w: 0.36 }, { label: 'SL: 1', w: 0.64 }], rows: [
          ['Tên', 'MLB Seattle mariners Dễ Thương Mũ bóng chày Mũ Lưỡi Trai Ngoài trời thương hiệu Mũ nam số lượng lớn Mũ hip hop'],
          ['Phân loại', 'TYNP2'],
        ] },
        { t: 'space', h: 6 },
        { t: 'table', cols: [{ label: 'Mốc thời gian', w: 0.36 }, { label: '', w: 0.64 }], rows: [
          ['Đặt hàng', '08/11/2026 19:40:29'],
          ['Thanh toán', '08/11/2026 19:41:10 (VietQR)'],
          ['Gửi hàng', '15/11/2026 17:07:36'],
          ['Nhận hàng', '17/11/2026 11:49:39'],
        ] },
        { t: 'space', h: 8 },
        { t: 'text', text: 'Người mua tự in lại thông tin đơn, không phải nhãn gốc của Lazada hay đơn vị vận chuyển.', align: 'center', size: 'sm', italic: true },
        { t: 'space', h: 50 },
      ];
