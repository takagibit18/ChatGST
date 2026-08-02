export type AdministrativeRegionLevel = "national" | "province" | "prefecture" | "county";

export type AdministrativeRegion = {
  code: string;
  name: string;
  level: AdministrativeRegionLevel;
  parent_code: string | null;
  aliases: string[];
};

const provinces: Array<[string, string, string[]]> = [
  ["110000", "北京市", ["北京"]], ["120000", "天津市", ["天津"]],
  ["130000", "河北省", ["河北"]], ["140000", "山西省", ["山西"]],
  ["150000", "内蒙古自治区", ["内蒙古"]], ["210000", "辽宁省", ["辽宁"]],
  ["220000", "吉林省", ["吉林"]], ["230000", "黑龙江省", ["黑龙江"]],
  ["310000", "上海市", ["上海"]], ["320000", "江苏省", ["江苏"]],
  ["330000", "浙江省", ["浙江"]], ["340000", "安徽省", ["安徽"]],
  ["350000", "福建省", ["福建"]], ["360000", "江西省", ["江西"]],
  ["370000", "山东省", ["山东"]], ["410000", "河南省", ["河南"]],
  ["420000", "湖北省", ["湖北"]], ["430000", "湖南省", ["湖南"]],
  ["440000", "广东省", ["广东"]], ["450000", "广西壮族自治区", ["广西"]],
  ["460000", "海南省", ["海南"]], ["500000", "重庆市", ["重庆"]],
  ["510000", "四川省", ["四川"]], ["520000", "贵州省", ["贵州"]],
  ["530000", "云南省", ["云南"]], ["540000", "西藏自治区", ["西藏"]],
  ["610000", "陕西省", ["陕西"]], ["620000", "甘肃省", ["甘肃"]],
  ["630000", "青海省", ["青海"]], ["640000", "宁夏回族自治区", ["宁夏"]],
  ["650000", "新疆维吾尔自治区", ["新疆"]],
];

const children: AdministrativeRegion[] = [
  { code: "150100", name: "呼和浩特市", level: "prefecture", parent_code: "150000", aliases: ["呼和浩特", "内蒙古自治区_呼和浩特市"] },
  { code: "150600", name: "鄂尔多斯市", level: "prefecture", parent_code: "150000", aliases: ["鄂尔多斯", "内蒙古自治区_鄂尔多斯市"] },
  { code: "230100", name: "哈尔滨市", level: "prefecture", parent_code: "230000", aliases: ["哈尔滨", "黑龙江省_哈尔滨市"] },
  { code: "230600", name: "大庆市", level: "prefecture", parent_code: "230000", aliases: ["大庆", "黑龙江省_大庆市"] },
  { code: "310107", name: "普陀区", level: "county", parent_code: "310000", aliases: ["上海市普陀区", "上海市_普陀区", "附普陀区"] },
  { code: "330100", name: "杭州市", level: "prefecture", parent_code: "330000", aliases: ["杭州", "浙江省_杭州市"] },
  { code: "330300", name: "温州市", level: "prefecture", parent_code: "330000", aliases: ["温州", "浙江省_温州市"] },
  { code: "330800", name: "衢州市", level: "prefecture", parent_code: "330000", aliases: ["衢州", "浙江省_衢州市"] },
  { code: "370100", name: "济南市", level: "prefecture", parent_code: "370000", aliases: ["济南", "山东省_济南市"] },
  { code: "420800", name: "荆门市", level: "prefecture", parent_code: "420000", aliases: ["荆门", "湖北省荆门市", "湖北省_荆门市"] },
  { code: "429005", name: "潜江市", level: "county", parent_code: "420000", aliases: ["潜江", "湖北省_潜江市"] },
  { code: "510400", name: "攀枝花市", level: "prefecture", parent_code: "510000", aliases: ["攀枝花", "四川省_攀枝花市"] },
];

export const administrativeRegions: readonly AdministrativeRegion[] = [
  { code: "100000", name: "全国", level: "national", parent_code: null, aliases: ["国家", "中国", "全国范围"] },
  ...provinces.map(([code, name, aliases]) => ({ code, name, level: "province" as const, parent_code: "100000", aliases })),
  ...children,
];

const byCode = new Map(administrativeRegions.map((region) => [region.code, region]));
const byAlias = new Map<string, AdministrativeRegion[]>();

function normalizeAlias(value: string): string {
  return value.normalize("NFKC").trim().replace(/[\s/＞>]+/gu, "").replace(/-/gu, "_");
}

for (const region of administrativeRegions) {
  for (const alias of new Set([region.code, region.name, ...region.aliases])) {
    const key = normalizeAlias(alias);
    byAlias.set(key, [...(byAlias.get(key) ?? []), region]);
  }
}

export type RegionResolution =
  | { status: "resolved"; region: AdministrativeRegion }
  | { status: "ambiguous"; candidates: AdministrativeRegion[] }
  | { status: "unknown"; input: string };

export function resolveAdministrativeRegion(value: unknown): RegionResolution {
  if (typeof value !== "string" || value.trim().length === 0) return { status: "unknown", input: "" };
  const input = normalizeAlias(value);
  const matches = byAlias.get(input) ?? [];
  if (matches.length === 1) return { status: "resolved", region: matches[0]! };
  if (matches.length > 1) return { status: "ambiguous", candidates: matches };
  return { status: "unknown", input: value };
}

export function getAdministrativeRegion(code: string): AdministrativeRegion | null {
  return byCode.get(code) ?? null;
}

export function getRegionPath(code: string): AdministrativeRegion[] {
  const path: AdministrativeRegion[] = [];
  const seen = new Set<string>();
  let current = byCode.get(code);
  while (current && !seen.has(current.code)) {
    path.unshift(current);
    seen.add(current.code);
    current = current.parent_code ? byCode.get(current.parent_code) : undefined;
  }
  return path;
}

export function isRegionAncestor(ancestorCode: string, descendantCode: string): boolean {
  return getRegionPath(descendantCode).some((region) => region.code === ancestorCode);
}
