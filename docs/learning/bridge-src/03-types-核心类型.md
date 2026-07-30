# 核心类型 — Step2/Ontology 类型定义

> 源文件：`bridge/src/types.ts`

```typescript
export interface Step2Config {

  default_data_root: string

  /**

   * merge-all 冲突自动决策策略（默认 use_candidate）。

   * - use_candidate：以新推导定义覆盖（不触发 blocked_rules 级联阻断，推荐）

   * - keep_existing：保留现有定义（依赖它的规则可能被阻断）

   * - skip：跳过冲突项（同样可能级联阻断）

   * rename_candidate / edit_candidate 需附加参数，暂不支持。

   */

  merge_conflict_action?: 'use_candidate' | 'keep_existing' | 'skip'

}



/**

 * 五级结构化地域（与 onto 平台 RegionLevels 一致）。

 * 未填写的后续层级为 null/缺省；national 缺省时平台自动补 "全国"。

 */

export interface RegionLevels {

  national?: string | null

  province_level?: string | null

  prefecture_level?: string | null

  county_level?: string | null

  township_level?: string | null

}



/** 平台返回的结构化地域及统计（PolicyRegionStat） */

export interface PolicyRegionStat extends RegionLevels {

  id: string

  region_id: string

  display_name: string

  aliases?: string[]

  rule_count: number

  document_count?: number

}



/** 统一地域选择器（extract/derive/infer 入参，与 region/region_id 三选一） */

export interface RegionSelector {

  region_id?: string

  levels?: RegionLevels

  national?: string | null

  province_level?: string | null

  prefecture_level?: string | null

  county_level?: string | null

  township_level?: string | null

}



export interface Step2Progress {

  phase: 'idle' | 'extract' | 'derive' | 'merge' | 'review' | 'done' | 'failed'

  total_files: number

  processed: number

  current_file?: string

  current_region?: string

  started_at?: string

  finished_at?: string

  errors: Step2Error[]

  data_source_root?: string

  review?: ReviewProgress

  /** merge 阶段子状态（merge2 两阶段合并） */

  merge_stage?: 'preview' | 'resolving' | 'committing'

  /** 预览发现的冲突项数量 */

  conflict_count?: number

  /** 合并完成后的摘要（进入 review 时写入） */

  merge_summary?: MergeSummary

}



/** merge-all 两阶段合并的结果摘要 */

export interface MergeSummary {

  /** 成功合并的地域批次数 */

  merged: number

  /** 失败的地域批次数 */

  failed: number

  /** 预览发现的冲突项数量 */

  conflict_count: number

  /** 实际采用的冲突策略 */

  conflict_action: 'use_candidate' | 'keep_existing' | 'skip'

  /** 按策略被覆盖/处理的冲突项 key 列表 */

  overwritten_keys: string[]

  /** 因跳过依赖或保留旧定义而未合入的规则数 */

  blocked_count: number

  /** 平台返回的警告 */

  warnings: string[]

  /** 合并失败的地域及原因 */

  failed_regions: { region: string; reason: string }[]

  finished_at: string

}



export interface Step2Error {

  file: string

  stage: 'extract' | 'derive' | 'merge' | 'merge-all'

  message: string

  at: string

  /** 地域歧义时的候选列表（region_ambiguous，不自动选择，需人工修正数据后重跑） */

  candidates?: { region_id: string; display_name: string; rule_count?: number }[]

}



export interface ReviewProgress {

  golden_selected: number

  golden_total: number

  run_id?: string

  run_status?: 'idle' | 'running' | 'passed' | 'failed'

  run_started_at?: string

  run_finished_at?: string

  run_pass_rate?: number

  run_failed_rules?: string[]

}



export interface OntologyMeta {

  policy_id: string

  canonical_name: string

  onto_version?: string

  onto_hash?: string

  regions: string[]

  started_at: string

  finished_at: string

  step_durations: {

    extract_ms: number

    derive_ms: number

    merge_ms: number

    review_ms: number

    golden_run_ms: number

  }

  file_count: number

  rule_count: number

  golden_pass_rate?: number

}



/** 地域摘要（versions.onto_regions / clone-sources 列表展示用） */

export interface OntoRegionSummary {

  region_id: string

  display_name: string

  rule_count: number

}



/**

 * 克隆来源记录（DB versions.onto_clone + version.json 镜像双写）。

 * status: pending=已登记意图待执行；done=克隆成功；failed=克隆失败（fallback 可重放）。

 */

export interface OntoCloneRecord {

  source_policy_id: string

  source_canonical: string

  /** 源版本的工作区引用（便于 UI 回链与 fallback 重放） */

  source_project_key?: string

  source_version_id?: string

  /** 源 release 版本；null/缺省 = working（v1 固定 working） */

  source_version?: string | null

  status: 'pending' | 'done' | 'failed'

  error?: string

  cloned_at?: string

  /** 克隆成功后平台返回的初始化数量 */

  seeded?: {

    concepts?: number

    operators?: number

    rules?: number

    regions?: number

  }

}


```
