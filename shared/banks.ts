// NAPAS BINs of common Vietnamese banks with the short names printed on bills ("TPB - HKD DA PHO - 0085…").
export const BANKS: { bin: string; name: string; short: string }[] = [
  { bin: '970436', name: 'Vietcombank', short: 'VCB' }, { bin: '970415', name: 'VietinBank', short: 'CTG' },
  { bin: '970418', name: 'BIDV', short: 'BIDV' }, { bin: '970405', name: 'Agribank', short: 'AGR' },
  { bin: '970407', name: 'Techcombank', short: 'TCB' }, { bin: '970422', name: 'MB Bank', short: 'MB' },
  { bin: '970416', name: 'ACB', short: 'ACB' }, { bin: '970432', name: 'VPBank', short: 'VPB' },
  { bin: '970423', name: 'TPBank', short: 'TPB' }, { bin: '970403', name: 'Sacombank', short: 'STB' },
  { bin: '970437', name: 'HDBank', short: 'HDB' }, { bin: '970441', name: 'VIB', short: 'VIB' },
  { bin: '970443', name: 'SHB', short: 'SHB' }, { bin: '970448', name: 'OCB', short: 'OCB' }, { bin: '970426', name: 'MSB', short: 'MSB' },
];
export const bankShort = (bin: string | null | undefined) => BANKS.find((b) => b.bin === bin)?.short ?? '';
