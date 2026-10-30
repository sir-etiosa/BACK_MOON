// String/BigInt-based conversion — never floating point, this is money.

export function toSmallestUnits(humanAmount: string, decimals: number): string {
  const trimmed = humanAmount.trim();
  if (!trimmed) return "0";
  const [whole, frac = ""] = trimmed.split(".");
  const paddedFrac = (frac + "0".repeat(decimals)).slice(0, decimals);
  const combined = (whole || "0") + paddedFrac;
  return BigInt(combined).toString();
}

export function fromSmallestUnits(amount: string, decimals: number): string {
  const neg = amount.startsWith("-");
  const digits = (neg ? amount.slice(1) : amount).padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals) || "0";
  const frac = digits.slice(digits.length - decimals).replace(/0+$/, "");
  return (neg ? "-" : "") + whole + (frac ? "." + frac : "");
}
