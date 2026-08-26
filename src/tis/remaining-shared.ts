export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function asRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value
      .filter((entry) => entry !== null && typeof entry === "object" && !Array.isArray(entry))
      .map((entry) => entry as Record<string, unknown>)
    : [];
}

export function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
      .map((entry) => stringValue(entry))
      .filter((entry) => entry.length > 0)
    : [];
}

export function stringValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

export function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function booleanValue(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const lower = value.trim().toLowerCase();
    return lower === "1" || lower === "true" || lower === "yes";
  }
  return false;
}

export function uniqueNumbers(values: readonly number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

export function compactSemester(value: string): string {
  const trimmed = value.trim();
  const match = /^(\d{4})-(\d{4})-([123])$/.exec(trimmed);
  if (!match) return trimmed;
  return `${match[1]}-${match[2]}${match[3]}`;
}

export function toIsoDate(value: Date): string {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

export function parseIsoDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) throw new Error(`Invalid ISO date: ${value}`);
  const result = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (
    Number.isNaN(result.getTime())
    || result.getUTCFullYear() !== Number(match[1])
    || result.getUTCMonth() + 1 !== Number(match[2])
    || result.getUTCDate() !== Number(match[3])
  ) {
    throw new Error(`Invalid ISO date: ${value}`);
  }
  return result;
}

export function addUtcDays(value: Date, days: number): Date {
  const next = new Date(value.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function sortBy<T>(items: readonly T[], key: (item: T) => string | number): T[] {
  return [...items].sort((left, right) => {
    const leftKey = key(left);
    const rightKey = key(right);
    if (leftKey < rightKey) return -1;
    if (leftKey > rightKey) return 1;
    return 0;
  });
}
