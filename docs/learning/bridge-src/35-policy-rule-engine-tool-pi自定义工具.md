# pi 自定义工具 — defineTool 注册

> 源文件：`bridge/src/example/policy-template/tools/policy-rule-engine-tool.ts`

```typescript
/**

 * 政策规则引擎工具定义

 *

 * 供 育儿补贴 skill 在"判断是否满足政策要求"步骤调用。

 * 调用真实规则引擎 POST /api/query，返回判定结果。

 *

 * 配置自包含：policyId 和规则引擎 URL/凭证都从 skill 级 config.json 读取

 * （与本文件同级的 ../config.json，即 skills/<skill-id>/config.json）。

 * 随 skill 目录一起分发/同步，不依赖 bridge 根 config.json 或 project.json。

 *

 * 约定：export default defineTool(...)，bridge 用 jiti 动态加载。

 */

import { defineTool } from '@earendil-works/pi-coding-agent'

import { Type } from 'typebox'

import { fileURLToPath } from 'node:url'

import { dirname, join } from 'node:path'

import {

  queryPolicy,

  getRuleEngineSummary,

  getPolicyId,

  getPolicyDocsDir,

  type MissingField,

} from './policy-rule-engine.ts'



// 工具文件位于 skills/<skill-id>/tools/ 下，config.json 在 skills/<skill-id>/ 下

const __filename = fileURLToPath(import.meta.url)

const __skillDir = join(dirname(__filename), '..')

const CONFIG_PATH = join(__skillDir, 'config.json')



type Decision = 'allow' | 'deny' | 'missing'



interface RuleEngineResult {

  decision: Decision

  details: string

  missing_fields: MissingField[]

  message: string

}



function mapVerdict(verdict: string): Decision {

  switch (verdict) {

    case 'eligible':

      return 'allow'

    case 'missing_info':

      return 'missing'

    case 'ineligible':

      return 'deny'

    default:

      return 'deny'

  }

}



function formatMissingFields(fields: MissingField[]): string {

  return fields

    .map((f) => {

      const name = f.zh || f.op

      const hint = f.hint ? `（${f.hint}）` : ''

      return hint ? `${name}${hint}` : name

    })

    .join('； ')

}



export default defineTool({

  name: 'policy_rule_engine',

  label: '政策规则引擎',

  description:

    '调用政策规则引擎，判断用户是否满足政策要求。传入地域、政策类型、用户条件（自然语言描述），返回判定结果（allow 满足 / missing 缺少信息 / deny 不满足）及缺失字段。地域直接原样传入，由规则引擎判断是否支持；若返回错误（地域不支持、引擎不可用等），改用 config.json 的 policyDocsDir 指定目录下的本地文档检索作答。',

  parameters: Type.Object({

    region: Type.String({ description: '地域，如"北京市"、"上海市"（必填）' }),

    policyType: Type.String({ description: '政策类型/名称，如"育儿补贴"、"人才引进"、"住房补贴"' }),

    userConditions: Type.String({ description: '从用户问题中提取的自然语言条件描述，用于规则匹配' }),

    question: Type.Optional(Type.String({ description: '用户原始问题（可选），用于按问题语义过滤结论' })),

  }),

  promptSnippet: 'policy_rule_engine: 判断用户是否满足政策要求，返回 allow/missing/deny',

  promptGuidelines: [

    '当需要判断用户是否满足政策申请条件时，使用 policy_rule_engine 工具',

    '必填 region（地域原样传入，不做前置校验）和 userConditions（用户条件），policyType 传政策名称',

    '根据返回的 decision 字段决定后续：allow 继续处理其他意图，missing 一次性列出缺失字段，deny 直接告知不满足',

    '如果工具返回错误（isError），说明规则引擎不可用或地域/政策不支持，**不要重试工具**，改为：先 read config.json 获取 policyDocsDir 路径，再用 find/grep 在该目录下按地域关键词检索本地政策文件并用 read 读取；若本地也未命中，直接告知用户当前地区暂未覆盖并建议拨打 12345',

  ],



  async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {

    const { region, policyType, userConditions, question } = params

    console.log(`[policy_rule_engine] region=${region}, policyType=${policyType}, question=${question ?? '(无)'}, conditions=${userConditions.slice(0, 100)}`)

    console.log(`[policy_rule_engine] engine: ${getRuleEngineSummary(CONFIG_PATH)}`)



    try {

      const policyId = getPolicyId(CONFIG_PATH)

      const resp = await queryPolicy(CONFIG_PATH, {

        region,

        text: userConditions,

        question,

        policy_id: policyId,

      })

      const decision = mapVerdict(resp.verdict)

      const missingFields = resp.missing ?? []

      const missingText = formatMissingFields(missingFields)



      let message: string

      switch (decision) {

        case 'allow':

          message = '根据您提供的条件，您符合该政策的申请要求。'

          break

        case 'missing':

          message = `您提供的条件信息不完整，请补充以下信息以便判断：${missingText}。`

          break

        case 'deny':

          message = '很抱歉，根据您提供的条件，您不符合该政策的申请要求。'

          break

      }



      const result: RuleEngineResult = {

        decision,

        details: resp.verdict === 'missing_info'

          ? `缺少必要信息：${missingText}`

          : `规则引擎判定：${resp.verdict}（eligible=${resp.eligible}）`,

        missing_fields: missingFields,

        message,

      }



      return {

        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],

        details: {

          policyType,

          region,

          userConditions,

          question,

          decision: result.decision,

          verdict: resp.verdict,

          conclusions: resp.conclusions ?? [],

          missing_fields: result.missing_fields,

          source: 'real-engine',

          error: false,

        },

      }

    } catch (error) {

      const message = error instanceof Error ? error.message : String(error)

      console.error('[policy_rule_engine] 调用失败:', message)

      const docsDir = getPolicyDocsDir(CONFIG_PATH)

      return {

        content: [{ type: 'text' as const, text: `规则引擎调用失败: ${message}。请改用本地文档检索：先用 find/grep 在 ${docsDir} 目录下按地域关键词搜索政策文件，再用 read 读取相关条款后作答；若 ${docsDir} 下无该地域文件，直接告知用户当前地区暂未覆盖并建议拨打 12345。不要重试本工具。` }],

        details: {

          policyType,

          region,

          userConditions,

          question,

          errorMessage: message,

          decision: 'deny' as Decision,

          missing_fields: [],

          source: 'error',

          error: true,

        },

        isError: true,

      }

    }

  },

})


```
