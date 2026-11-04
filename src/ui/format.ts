const formatter = (digits: number) =>
  new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
const cents = formatter(2);
const live = formatter(4);
export const money = (amount: number, digits: 2 | 4 = 2) =>
  "¥" + (digits === 4 ? live : cents).format(amount);

export function clockDuration(milliseconds: number, elapsed = false) {
  const total = Math.max(
    0,
    (elapsed ? Math.floor : Math.ceil)(milliseconds / 1000),
  );
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const seconds = total % 60;
  return [
    hours ? `${hours} 小时` : "",
    hours || minutes ? `${minutes} 分` : "",
    `${seconds} 秒`,
  ]
    .filter(Boolean)
    .join(" ");
}

export const msg = (e: unknown) =>
  e instanceof Error
    ? e.message
    : typeof e === "string"
      ? e
      : "操作失败，请重试。";
