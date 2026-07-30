# Agent 运行时 — pi SDK 封装

> 源文件：`bridge/src/agent-runtime.ts`

```typescript
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'

import { join } from 'node:path'

import {

  createAgentSession,

  DefaultResourceLoader,

  getAgentDir,

  SessionManager,

  type AgentSession,

  type AgentSessionEvent,

} from '@earendil-works/pi-coding-agent'



// 本地 stripFrontmatter 替代：SDK 版本可能不提供此导出

function stripFrontmatter(text: string): string {

  return text.replace(/^---\n[\s\S]*?\n---\n?/, '')

}

import { loadPiSkills } from './skills.js'

import { loadSkillTools } from './skill-tools.js'

import { ensureProjectWorkspace } from './workspace.js'



export interface ChatMessage {

  id: string

  role: 'user' | 'assistant' | 'system' | 'tool'

  content: string

  time?: string

}



export interface SessionSummary {

  id: string

  path: string

  title: string

  modified: string

  messageCount: number

  status: 'idle' | 'running'

  pinned: boolean

}



interface SessionPrefs {

  pinnedIds: string[]

}



const PREFS_FILE = 'session-prefs.json'



type WsSender = (data: unknown) => void



interface ActiveHandle {

  session: AgentSession

  unsubscribe: () => void

  skillIds: string[]

  running: boolean

}



const actives = new Map<string, ActiveHandle>() // key: projectId::versionId::sessionId



function key(projectId: string, versionId: string, sessionId: string) {

  return `${projectId}::${versionId}::${sessionId}`

}



function textFromContent(content: unknown): string {

  if (typeof content === 'string') return content

  if (!Array.isArray(content)) return content == null ? '' : String(content)

  return content

    .map((part) => {

      if (typeof part === 'string') return part

      if (part && typeof part === 'object' && 'type' in part) {

        const p = part as { type: string; text?: string }

        if (p.type === 'text' && typeof p.text === 'string') return p.text

      }

      return ''

    })

    .join('')

}



/**

 * UI 只展示 user + 每轮 user 之后「最后一条有正文的 assistant」。

 * Agent 多轮（工具调用中间的 assistant 文本）会被折叠掉。

 */

function serializeMessagesForUi(

  messages: unknown[],

  sessionId: string,

): ChatMessage[] {

  const out: ChatMessage[] = []

  let pendingAssistant: ChatMessage | null = null



  const flushAssistant = () => {

    if (pendingAssistant) {

      out.push(pendingAssistant)

      pendingAssistant = null

    }

  }



  messages.forEach((raw, i) => {

    const m = raw as { role?: string; content?: unknown; timestamp?: number }

    const role = m.role || 'assistant'

    const ts = m.timestamp

    const time = ts

      ? new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })

      : undefined



    if (role === 'user') {

      flushAssistant()

      const content = textFromContent(m.content).trim()

      if (!content) return

      out.push({

        id: `${sessionId}-${i}`,

        role: 'user',

        content,

        time,

      })

      return

    }



    if (role === 'assistant') {

      const content = textFromContent(m.content).trim()

      if (!content) return

      // 同一轮内后出现的 assistant 覆盖前者 → 只保留最终回答

      pendingAssistant = {

        id: `${sessionId}-${i}`,

        role: 'assistant',

        content,

        time,

      }

    }

    // toolResult / system / custom 等不进聊天气泡

  })



  flushAssistant()

  return out

}



function serializeMessages(session: AgentSession): ChatMessage[] {

  return serializeMessagesForUi(session.messages as unknown[], session.sessionId)

}



function prefsPath(projectId: string, versionId: string): string {

  return join(ensureProjectWorkspace(projectId, versionId), PREFS_FILE)

}



function loadPrefs(projectId: string, versionId: string): SessionPrefs {

  const p = prefsPath(projectId, versionId)

  if (!existsSync(p)) return { pinnedIds: [] }

  try {

    const raw = JSON.parse(readFileSync(p, 'utf-8')) as SessionPrefs

    return { pinnedIds: Array.isArray(raw.pinnedIds) ? raw.pinnedIds.map(String) : [] }

  } catch {

    return { pinnedIds: [] }

  }

}



function savePrefs(projectId: string, versionId: string, prefs: SessionPrefs) {

  writeFileSync(prefsPath(projectId, versionId), JSON.stringify(prefs, null, 2), 'utf-8')

}



async function findSessionInfo(projectId: string, versionId: string, sessionId: string) {

  const cwd = ensureProjectWorkspace(projectId, versionId)

  const sessions = await SessionManager.list(cwd)

  const info = sessions.find((s) => s.id === sessionId)

  if (!info) throw new Error('Session not found')

  return info

}



function disposeActive(projectId: string, versionId: string, sessionId: string) {

  const k = key(projectId, versionId, sessionId)

  const handle = actives.get(k)

  if (!handle) return

  try {

    handle.unsubscribe()

    handle.session.dispose()

  } catch {

    /* ignore */

  }

  actives.delete(k)

}



export async function listSessions(projectId: string, versionId: string): Promise<SessionSummary[]> {

  const cwd = ensureProjectWorkspace(projectId, versionId)

  const sessions = await SessionManager.list(cwd)

  const { pinnedIds } = loadPrefs(projectId, versionId)

  const pinRank = new Map(pinnedIds.map((id, i) => [id, i]))



  const mapped: SessionSummary[] = sessions.map((s) => ({

    id: s.id,

    path: s.path,

    title: s.name || s.firstMessage?.slice(0, 40) || '新会话',

    modified: s.modified.toISOString(),

    messageCount: s.messageCount,

    status: actives.get(key(projectId, versionId, s.id))?.running ? 'running' : 'idle',

    pinned: pinRank.has(s.id),

  }))



  mapped.sort((a, b) => {

    const ap = pinRank.has(a.id)

    const bp = pinRank.has(b.id)

    if (ap && bp) return (pinRank.get(a.id) ?? 0) - (pinRank.get(b.id) ?? 0)

    if (ap) return -1

    if (bp) return 1

    return b.modified.localeCompare(a.modified)

  })

  return mapped

}



export async function createSession(projectId: string, versionId: string): Promise<SessionSummary> {

  const cwd = ensureProjectWorkspace(projectId, versionId)

  const sm = SessionManager.create(cwd)

  const id = sm.getSessionId()

  const path = sm.getSessionFile()

  if (!path) throw new Error('Failed to allocate session file')

  // pi defers disk write until first assistant reply; persist header (+ title) for listing

  const ts = new Date().toISOString()

  const header = { type: 'session', version: 3, id, timestamp: ts, cwd }

  const info = {

    type: 'session_info',

    id: crypto.randomUUID(),

    parentId: null,

    timestamp: ts,

    name: '新会话',

  }

  writeFileSync(path, `${JSON.stringify(header)}\n${JSON.stringify(info)}\n`, 'utf-8')

  return {

    id,

    path,

    title: '新会话',

    modified: ts,

    messageCount: 0,

    status: 'idle',

    pinned: false,

  }

}



export async function renameSession(

  projectId: string,

  versionId: string,

  sessionId: string,

  title: string,

): Promise<SessionSummary> {

  const name = title.trim()

  if (!name) throw new Error('标题不能为空')

  const info = await findSessionInfo(projectId, versionId, sessionId)

  const active = actives.get(key(projectId, versionId, sessionId))

  if (active) active.session.setSessionName(name)

  else SessionManager.open(info.path).appendSessionInfo(name)

  const list = await listSessions(projectId, versionId)

  const item = list.find((s) => s.id === sessionId)

  if (!item) throw new Error('Session not found')

  return item

}



export async function deleteSession(projectId: string, versionId: string, sessionId: string): Promise<{ id: string }> {

  const info = await findSessionInfo(projectId, versionId, sessionId)

  disposeActive(projectId, versionId, sessionId)

  if (existsSync(info.path)) unlinkSync(info.path)

  const prefs = loadPrefs(projectId, versionId)

  prefs.pinnedIds = prefs.pinnedIds.filter((id) => id !== sessionId)

  savePrefs(projectId, versionId, prefs)

  return { id: sessionId }

}



export async function setSessionPinned(

  projectId: string,

  versionId: string,

  sessionId: string,

  pinned: boolean,

): Promise<SessionSummary> {

  await findSessionInfo(projectId, versionId, sessionId)

  const prefs = loadPrefs(projectId, versionId)

  const without = prefs.pinnedIds.filter((id) => id !== sessionId)

  prefs.pinnedIds = pinned ? [sessionId, ...without] : without

  savePrefs(projectId, versionId, prefs)

  const list = await listSessions(projectId, versionId)

  const item = list.find((s) => s.id === sessionId)

  if (!item) throw new Error('Session not found')

  return item

}



async function buildLoader(projectId: string, versionId: string, skillIds: string[]) {

  const cwd = ensureProjectWorkspace(projectId, versionId)

  const selected = loadPiSkills(projectId, versionId, skillIds)

  // pi skill 采用渐进式披露：SKILL.md 正文默认不进 system prompt，只有当 LLM

  // 判断任务匹配 description 后用 read 工具才会读取。这导致非政策问题（闲聊）

  // 永远不会触发 skill 正文加载，工作流指令（如"拒绝闲聊"）形同虚设。

  // 这里把选中 skill 的正文拼成 appendSystemPrompt 始终注入，确保工作流约束生效。

  const skillBlocks = selected

    .map((s) => {

      try {

        const raw = readFileSync(s.filePath, 'utf-8')

        const body = stripFrontmatter(raw).trim()

        if (!body) return ''

        return `<skill name="${s.name}" location="${s.filePath}">\n${body}\n</skill>`

      } catch {

        return ''

      }

    })

    .filter(Boolean)

  const loader = new DefaultResourceLoader({

    cwd,

    agentDir: getAgentDir(),

    skillsOverride: () => ({

      skills: selected,

      diagnostics: [],

    }),

    appendSystemPromptOverride: (base) => [...base, ...skillBlocks],

  })

  await loader.reload()

  return loader

}



async function ensureActive(

  projectId: string,

  versionId: string,

  sessionId: string,

  skillIds: string[],

  send: WsSender,

): Promise<ActiveHandle> {

  const k = key(projectId, versionId, sessionId)

  const existing = actives.get(k)

  if (existing) {

    // recreate if skill set changed

    const same =

      existing.skillIds.length === skillIds.length && existing.skillIds.every((id, i) => id === skillIds[i])

    if (same) return existing

    existing.unsubscribe()

    existing.session.dispose()

    actives.delete(k)

  }



  const cwd = ensureProjectWorkspace(projectId, versionId)

  const sessions = await SessionManager.list(cwd)

  const info = sessions.find((s) => s.id === sessionId)

  if (!info) throw new Error('Session not found')



  const sm = SessionManager.open(info.path)

  const dynamicTools = await loadSkillTools(cwd, skillIds)

  const toolNames = dynamicTools.map((t) => t.name)

  const { session } = await createAgentSession({

    cwd,

    sessionManager: sm,

    tools: ['read', 'edit', 'write', 'grep', 'find', 'ls', ...toolNames],

    customTools: dynamicTools,

    resourceLoader: await buildLoader(projectId, versionId, skillIds),

  })



  const unsubscribe = session.subscribe((event: AgentSessionEvent) => {

    forwardEvent(event, send)

  })



  const handle: ActiveHandle = { session, unsubscribe, skillIds: [...skillIds], running: false }

  actives.set(k, handle)

  return handle

}



function forwardEvent(event: AgentSessionEvent, send: WsSender) {

  switch (event.type) {

    case 'message_start': {

      // 新的 assistant 轮次开始时清空流式缓冲，避免中间轮文本拼进最终气泡

      if ((event.message as { role?: string }).role === 'assistant') {

        send({ type: 'assistant_message_start' })

      }

      break

    }

    case 'message_update': {

      const ame = event.assistantMessageEvent

      if (ame?.type === 'text_delta' && 'delta' in ame && typeof ame.delta === 'string') {

        send({ type: 'text_delta', delta: ame.delta })

      }

      break

    }

    case 'tool_execution_start':

      send({ type: 'tool_start', toolName: event.toolName, toolCallId: event.toolCallId })

      break

    case 'tool_execution_end':

      send({

        type: 'tool_end',

        toolName: event.toolName,

        toolCallId: event.toolCallId,

        isError: event.isError,

      })

      break

    default:

      break

  }

}



export async function getSessionMessages(projectId: string, versionId: string, sessionId: string): Promise<ChatMessage[]> {

  const cwd = ensureProjectWorkspace(projectId, versionId)

  const sessions = await SessionManager.list(cwd)

  const info = sessions.find((s) => s.id === sessionId)

  if (!info) throw new Error('Session not found')



  const k = key(projectId, versionId, sessionId)

  const active = actives.get(k)

  if (active) return serializeMessages(active.session)



  const sm = SessionManager.open(info.path)

  const ctx = sm.buildSessionContext()

  return serializeMessagesForUi(ctx.messages as unknown[], sessionId)

}



function isDefaultSessionTitle(name: string | undefined): boolean {

  const n = (name || '').trim()

  return !n || n === '新会话'

}



function sanitizeTitle(raw: string): string {

  return raw

    .trim()

    .split('\n')[0]

    .replace(/^["'「『]+|["'」』]+$/g, '')

    .replace(/[.。!！?？:：]+$/g, '')

    .trim()

    .slice(0, 32)

}



/** 首轮对话结束后，若仍为默认名则调用模型生成会话标题 */

async function maybeAutoTitleSession(handle: ActiveHandle, userText: string): Promise<string | null> {

  if (!isDefaultSessionTitle(handle.session.sessionName)) return null



  const uiMessages = serializeMessages(handle.session)

  const lastAssistant = [...uiMessages].reverse().find((m) => m.role === 'assistant')

  const snippet = [

    `用户：${userText.trim().slice(0, 400)}`,

    lastAssistant?.content ? `助手：${lastAssistant.content.trim().slice(0, 400)}` : '',

  ]

    .filter(Boolean)

    .join('\n')



  let title = ''

  const model = handle.session.model

  if (model) {

    try {

      const result = await handle.session.modelRuntime?.completeSimple(

        model,

        {

          systemPrompt: '你是会话标题生成器。根据对话内容生成简短中文标题。',

          messages: [

            {

              role: 'user',

              content: `根据下面的首轮对话，生成一个不超过16个字的中文标题。只输出标题本身，不要引号、编号或解释。\n\n${snippet}`,

            },

          ],

        },

        { maxTokens: 64 },

      )

      if (result) {

        title = sanitizeTitle(textFromContent(result.content))

      }

    } catch {

      /* 模型失败时用用户首句兜底 */

    }

  }



  if (!title || isDefaultSessionTitle(title)) {

    title = sanitizeTitle(userText.replace(/\s+/g, ' ')) || '新会话'

  }



  if (!isDefaultSessionTitle(title)) {

    handle.session.setSessionName(title)

    return title

  }

  return null

}



export async function promptSession(opts: {

  projectId: string

  versionId: string

  sessionId: string

  text: string

  skillIds: string[]

  send: WsSender

}): Promise<void> {

  const handle = await ensureActive(opts.projectId, opts.versionId, opts.sessionId, opts.skillIds, opts.send)

  if (handle.running) throw new Error('Session is already running')

  handle.running = true

  opts.send({ type: 'assistant_start' })

  try {

    await handle.session.prompt(opts.text)

    const title = await maybeAutoTitleSession(handle, opts.text)

    if (title) {

      opts.send({ type: 'session_title', sessionId: opts.sessionId, title })

    }

    opts.send({ type: 'done', messages: serializeMessages(handle.session) })

  } catch (err) {

    const message = err instanceof Error ? err.message : String(err)

    opts.send({ type: 'error', message })

  } finally {

    handle.running = false

  }

}



export async function abortSession(projectId: string, versionId: string, sessionId: string): Promise<void> {

  const handle = actives.get(key(projectId, versionId, sessionId))

  if (handle) await handle.session.abort()

}



/**

 * One-shot LLM completion for skill generation etc.

 * Uses ModelRegistry from pi-coding-agent to resolve API key & model info,

 * then calls the OpenAI-compatible chat completions API directly.

 */

export async function llmComplete(systemPrompt: string, userPrompt: string): Promise<string> {

  const _mod: any = await import('@earendil-works/pi-coding-agent')

  const AuthStorage = _mod.AuthStorage

  const ModelRegistry = _mod.ModelRegistry

  const auth = AuthStorage.create()

  const registry = ModelRegistry.create(auth)



  // Use deepseek-v4-flash by default (or override via LLM_MODEL env)

  const modelId = process.env.LLM_MODEL || 'deepseek-v4-flash'

  const model = registry.find('deepseek', modelId) || registry.getAvailable()[0]

  if (!model) throw new Error('No available LLM model. Please configure credentials in ~/.pi/agent/auth.json')



  const authResult = await registry.getApiKeyAndHeaders(model)

  if (!authResult.ok) throw new Error(`LLM auth failed: ${authResult.error}`)



  const baseUrl = model.baseUrl || 'https://api.deepseek.com'

  const headers: Record<string, string> = {

    'Content-Type': 'application/json',

    ...(authResult.apiKey ? { Authorization: `Bearer ${authResult.apiKey}` } : {}),

    ...(authResult.headers || {}),

  }



  const resp = await fetch(`${baseUrl}/v1/chat/completions`, {

    method: 'POST',

    headers,

    body: JSON.stringify({

      model: model.id,

      messages: [

        { role: 'system', content: systemPrompt },

        { role: 'user', content: userPrompt },

      ],

      max_tokens: 4096,

      temperature: 0.3,

    }),

  })



  if (!resp.ok) {

    const text = await resp.text().catch(() => '')

    throw new Error(`LLM API error: HTTP ${resp.status} ${text.slice(0, 300)}`)

  }



  const json = await resp.json() as {

    choices?: Array<{ message?: { content?: string } }>

  }

  const content = json.choices?.[0]?.message?.content?.trim() ?? ''

  if (!content) throw new Error('LLM returned empty content')

  return content

}


```
