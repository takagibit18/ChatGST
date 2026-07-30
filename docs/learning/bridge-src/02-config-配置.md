# 配置 — 多来源配置读取

> 源文件：`bridge/src/config.ts`

```typescript
import { existsSync, readFileSync } from 'node:fs'

import { homedir } from 'node:os'

import { dirname, join } from 'node:path'

import { fileURLToPath } from 'node:url'



/** 配置文件路径：与 src/ 同级的 config.json（可被环境变量覆盖） */

const CONFIG_PATH = process.env.POLICY_BRIDGE_CONFIG ||

  join(dirname(fileURLToPath(import.meta.url)), '..', 'config.json')



export interface AuthConfig {

  username: string

  password: string

  displayName: string

  role: string

  email: string

}



export interface OntoPlatformConfig {

  url: string

  username: string

  password: string

}



export interface ServerConfig {

  port: number

  host: string

}



export interface CrawlerConfig {

  /** 爬虫 API 基地址 */

  baseUrl: string

  /** 爬虫本地导出目录（同机部署时直接读文件） */

  exportDir: string

}



/** 发布到远程服务器的传输配置（rsync over ssh） */

export interface PublishRemoteConfig {

  /** 目标主机 IP / 域名 */

  host: string

  /** SSH 端口，默认 22 */

  port: number

  /** SSH 登录用户名 */

  user: string

  /** SSH 登录密码（密码认证，依赖 sshpass）；为空则尝试 sshKeyPath */

  password: string

  /** SSH 私钥路径（密钥免密认证，优先级高于 password） */

  sshKeyPath: string

  /** 远程目标根目录，发布产物会落到 <targetBase>/<项目名>/<版本号>/ */

  targetBase: string

  /** rsync 可执行文件路径，默认 rsync */

  rsyncPath: string

  /** ssh 可执行文件路径，默认 ssh */

  sshPath: string

  /**

   * 传输方式：

   *   - 'rsync'：rsync over ssh（增量同步，密码认证依赖 sshpass；推荐 Linux 生产环境）

   *   - 'ssh-tar'：tar 打包经 ssh 管道传输（仅依赖 ssh+tar，无需 rsync/sshpass，

   *                Windows/Mac/Linux 通用；密码认证用 SSH_ASKPASS 注入）

   * 默认 'rsync'。

   */

  transport: 'rsync' | 'ssh-tar'

}



interface ConfigFile {

  auth?: Partial<AuthConfig>

  ontoPlatform?: Partial<OntoPlatformConfig>

  server?: Partial<ServerConfig>

  crawler?: Partial<CrawlerConfig>

  publish?: { remote?: Partial<PublishRemoteConfig> }

}



let rawCache: ConfigFile | null = null



function readRaw(): ConfigFile {

  if (rawCache) return rawCache

  if (!existsSync(CONFIG_PATH)) {

    throw new Error(`config.json not found at ${CONFIG_PATH}`)

  }

  rawCache = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as ConfigFile

  return rawCache

}



export function getAuthConfig(): AuthConfig {

  const a = readRaw().auth ?? {}

  if (!a.username || !a.password) {

    throw new Error('config.json: auth.username 和 auth.password 必填')

  }

  return {

    username: a.username,

    password: a.password,

    displayName: a.displayName ?? '系统管理员',

    role: a.role ?? '平台超管',

    email: a.email ?? '',

  }

}



export function getOntoPlatformConfig(): OntoPlatformConfig {

  const o = readRaw().ontoPlatform ?? {}

  if (!o.url || !o.username || !o.password) {

    throw new Error('config.json: ontoPlatform.{url,username,password} 必填')

  }

  if (o.username === 'REPLACE_ME' || o.password === 'REPLACE_ME') {

    throw new Error('config.json: ontoPlatform.username/password 仍为占位符，请在 config.json 中填入真实账号')

  }

  return {

    url: o.url.replace(/\/+$/, ''),

    username: o.username,

    password: o.password,

  }

}



export function getServerConfig(): ServerConfig {

  const s = readRaw().server ?? {}

  return {

    port: s.port ?? (Number(process.env.PORT) || 8787),

    host: s.host ?? '0.0.0.0',

  }

}



export function getCrawlerConfig(): CrawlerConfig {

  const c = readRaw().crawler ?? {}

  return {

    baseUrl: c.baseUrl || process.env.CRAWLER_BASE || 'http://localhost:8000',

    exportDir: c.exportDir || process.env.CRAWLER_EXPORT_DIR ||

      join(homedir(), '.gs_platform', 'crawler-export'),

  }

}



/**

 * 发布到远程服务器的传输配置（rsync over ssh）。

 * 优先级：环境变量 > config.json.publish.remote > 默认值。

 *

 * 各字段环境变量：

 *   PUBLISH_REMOTE_HOST / PUBLISH_REMOTE_PORT / PUBLISH_REMOTE_USER /

 *   PUBLISH_REMOTE_PASS / PUBLISH_REMOTE_SSH_KEY / PUBLISH_REMOTE_TARGET_BASE

 *

 * 认证方式（二选一）：

 *   - 密码：填 password（依赖 sshpass），当前默认方案

 *   - 密钥：填 sshKeyPath（免密），优先级高于 password，后期可平滑切换

 */

export function getPublishRemoteConfig(): PublishRemoteConfig {

  const r = readRaw().publish?.remote ?? {}

  return {

    host: r.host || process.env.PUBLISH_REMOTE_HOST || '',

    port: r.port ?? (Number(process.env.PUBLISH_REMOTE_PORT) || 22),

    user: r.user || process.env.PUBLISH_REMOTE_USER || 'root',

    password: r.password || process.env.PUBLISH_REMOTE_PASS || '',

    sshKeyPath: r.sshKeyPath || process.env.PUBLISH_REMOTE_SSH_KEY || '',

    targetBase: (r.targetBase || process.env.PUBLISH_REMOTE_TARGET_BASE || '/workspace').replace(/\/+$/, ''),

    rsyncPath: r.rsyncPath || 'rsync',

    sshPath: r.sshPath || 'ssh',

    transport: r.transport === 'ssh-tar' ? 'ssh-tar' : 'rsync',

  }

}


```
