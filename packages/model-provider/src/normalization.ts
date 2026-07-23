export function extractJsonText(input: unknown): string {
  const text = typeof input === "string" ? input.trim() : JSON.stringify(input);
  const unfenced = text.replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "").trim();
  const first = unfenced.indexOf("{");
  const last = unfenced.lastIndexOf("}");
  return first >= 0 && last > first ? unfenced.slice(first, last + 1) : unfenced;
}

export function parseJsonWithSingleRepair(input: unknown): { value: unknown; repaired: boolean } {
  const text = extractJsonText(input);
  try {
    return { value: JSON.parse(text) as unknown, repaired: false };
  } catch {
    const repaired = text
      .replace(/[“”]/gu, '"')
      .replace(/[‘’]/gu, "'")
      .replace(/,\s*([}\]])/gu, "$1")
      .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)/gu, '$1"$2"$3');
    return { value: JSON.parse(repaired) as unknown, repaired: true };
  }
}

export function normalizeToolArguments(input: unknown): unknown {
  if (typeof input === "string") {
    try {
      return parseJsonWithSingleRepair(input).value;
    } catch {
      return input;
    }
  }
  if (!input || typeof input !== "object") return input;
  const record = input as Record<string, unknown>;
  if ("arguments" in record) return { ...record, arguments: normalizeToolArguments(record.arguments) };
  return input;
}

