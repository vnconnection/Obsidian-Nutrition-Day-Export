export function formatNumber(value: number, decimalPlaces: number): string {
  return value.toFixed(decimalPlaces);
}

export function formatAmount(value: number, decimalPlaces: number): string {
  const formattedValue = formatNumber(value, decimalPlaces);
  if (!formattedValue.includes(".")) {
    return formattedValue;
  }

  return formattedValue.replace(/0+$/, "").replace(/\.$/, "");
}
