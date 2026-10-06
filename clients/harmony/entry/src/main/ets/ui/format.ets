// Shared display formatting (H2). Mirrors Android `ui/format.kt`:
// cents stay cents until display; epoch ms stay epoch ms until display.
// TZ follows the device (server TZ=Asia/Shanghai is display-only context).

export function formatYuan(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  const yuan = Math.floor(abs / 100);
  const rest = abs % 100;
  const yuanStr = yuan.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${yuanStr}.${rest < 10 ? '0' + rest : '' + rest}`;
}

export function formatDay(epochMs: number): string {
  if (!epochMs) {
    return '';
  }
  const d = new Date(epochMs);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export function formatMonth(monthStart: number): string {
  if (!monthStart) {
    return '';
  }
  const d = new Date(monthStart);
  return `${d.getFullYear()}年${d.getMonth() + 1}月`;
}

export function periodLabel(periodStart: number): string {
  const d = new Date(periodStart);
  return `${d.getFullYear()}年${d.getMonth() + 1}月`;
}
