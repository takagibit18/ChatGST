const sensitivePatterns: Array<[RegExp, string]> = [
  [/\b1[3-9]\d{9}\b/g, "[手机号已隐藏]"],
  [/\b\d{17}[\dXx]\b/g, "[身份证号已隐藏]"],
  [/\b(?:\d[ -]?){16,19}\b/g, "[银行卡号已隐藏]"],
  [/[A-Za-z]:\\[^\s"']+|\/(?:Users|home|tmp)\/[^\s"']+/g, "[本地路径已隐藏]"],
];

export function redactText(input: string): string {
  return sensitivePatterns.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), input);
}

export function anonymizeId(value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `anon-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function estimateTokens(text: string): number {
  const han = (text.match(/[\p{Script=Han}]/gu) ?? []).length;
  const nonHan = text.replace(/[\p{Script=Han}]/gu, " ").trim();
  const other = nonHan ? nonHan.split(/\s+/u).length : 0;
  return han + Math.ceil(other * 1.3);
}

