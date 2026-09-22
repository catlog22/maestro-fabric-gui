export function boundedText(value: unknown, max = 2048): string {
  const text = typeof value === "string" ? value : String(value ?? "");
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
