# 远程发布 — rsync/ssh-tar 同步

> 源文件：`bridge/src/publish.ts`

```typescript
/**
 * 发布模块：审批通过 → 复制版本到数据空间 → 推送到远程服务器。
 *
 * 传输层（RemoteTransporter）独立抽取，两种内置实现：
 *   - rsync：rsync over ssh（增量同步，密码认证依赖 sshpass；推荐 Linux 生产环境）
 *   - ssh-tar：tar 打包经 ssh 管道传输（仅依赖 ssh+tar，无需 rsync/sshpass，
 *              Windows/Mac/Linux 通用；密码认证用 SSH_ASKPASS 注入）
 * 后期可继续扩展（scp/http/s3 等），只需实现 RemoteTransporter 接口。
 */
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { getPublishRemoteConfig, type PublishRemoteConfig } from './config.js'
import { dataSpaceCwd } from './paths.js'
import { resolveVersionCwd } from './projects.js'
import { copyDirSync } from './fs-safe.js'

/** 发布记录：写在数据空间对应版本目录下 */
export interface PublishRecord {
  /** 来源项目 key（proj-XXX） */
  projectKey: string
  /** 来源项目名（用于远程目录命名） */
  projectName: string
  /** 版本号，如 v1.0.0 */
  version: string
  /** 本地数据空间源目录（rsync 的源） */
  localSource: string
  /** 远程目标目录（rsync 的目标） */
  remoteTarget: string
  /** 复制到数据空间的时间 */
  copiedAt: string
  /** 远程同步状态（最近一次） */
  remoteSync: {
    status: 'pending' | 'success' | 'failed' | 'never'
    lastSyncAt?: string
    lastExitCode?: number
    message?: string
    /** 最近一次的命令输出（裁剪） */
    log?: string
    /** 最近一次同步操作人 */
    syncedBy?: string
  }
  /** 历次同步记录（最新在前），每次 syncVersionToRemote 追加 */
  syncHistory?: Array<{
    status: 'success' | 'failed'
    syncAt: string
    exitCode: number
    message: string
    /** 同步操作人 */
    syncedBy?: string
  }>
}

/** 单次同步结果 */
export interface SyncResult {
  ok: boolean
  exitCode: number
  target: string
  stdout: string
  stderr: string
  message: string
}

// ===== 远程传输层（可替换） =====

/** 远程传输抽象：后期换方案时实现此接口即可 */
export interface RemoteTransporter {
  /** 把本地 src 目录内容推送到远程 dst 目录（src 须以 / 结尾） */
  push(src: string, dst: string): SyncResult
}

/**
 * 把 spawnSync 的启动错误（多半是命令找不到）翻译成可读提示。
 * spawnSync 找不到可执行文件时不抛异常，而是返回 r.error（ENOENT）+ r.status=null，
 * 必须显式检查 r.error，否则只能看到「退出码 -1 / 未知错误」这种无信息报错。
 */
function diagnoseSpawnError(
  err: Error,
  cmd: string,
  useKey: boolean,
  dst: string,
): SyncResult {
  const msg = err.message || String(err)
  const isENOENT = /ENOENT|spawn|not found|no such file|is not defined/i.test(msg)
  // 按 cmd 给出针对性安装提示
  let which = cmd
  let hint = ''
  if (isENOENT) {
    if (cmd === 'sshpass') {
      which = 'sshpass'
      hint = '（未找到 sshpass：请在 bridge 运行机执行 apt-get install -y sshpass；或改用密钥免密配置 sshKeyPath）'
    } else if (cmd === 'rsync') {
      which = 'rsync'
      hint = '（未找到 rsync：请在 bridge 运行机执行 apt-get install -y rsync）'
    } else {
      // ssh / tar / sh 等：列出依赖，提示切换传输方式
      which = cmd
      hint = '（依赖 ssh + tar + sh：Windows 需 Git Bash 环境；或改用 transport=rsync 走 rsync+sshpass）'
    }
  }
  return {
    ok: false,
    exitCode: -1,
    target: dst,
    stdout: '',
    stderr: msg,
    message: `启动 ${which} 失败：${msg}${hint}`,
  }
}

/**
 * rsync over ssh 传输实现。
 * 认证优先级：sshKeyPath（密钥免密）> password（sshpass）。
 */
export function createRsyncTransporter(cfg: PublishRemoteConfig): RemoteTransporter {
  const useKey = !!cfg.sshKeyPath
  if (!useKey && !cfg.password) {
    throw new Error('发布传输未配置认证：请配置 publish.remote.sshKeyPath 或 password')
  }

  return {
    push(src, dst) {
      // 组装 ssh 包装器：-e 后面的整段作为 rsync 的远程 shell 命令
      const sshParts = [cfg.sshPath, '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=15', '-p', String(cfg.port)]
      if (useKey) sshParts.push('-i', cfg.sshKeyPath!)
      const rsh = sshParts.join(' ')

      // 远程目标路径含中文/特殊字符，整体加引号交给远端 shell 解析
      const remote = `${cfg.user}@${cfg.host}:${dst}`

      // 排除运行时元数据 / 同步记录，避免污染生产环境
      const rsyncArgs = [
        '-az', '--delete', '--stats',
        '--exclude', 'publish.json',
        '--exclude', 'version.json',
        '--exclude', 'session-prefs.json',
        '-e', rsh, src, remote,
      ]

      // 密码认证 → 用 sshpass 包一层
      const finalCmd = useKey ? cfg.rsyncPath : 'sshpass'
      const finalArgs = useKey ? rsyncArgs : ['-p', cfg.password, cfg.rsyncPath, ...rsyncArgs]

      try {
        const r = spawnSync(finalCmd, finalArgs, {
          encoding: 'utf8',
          timeout: 10 * 60 * 1000,
          maxBuffer: 8 * 1024 * 1024,
        })
        const stdout = (r.stdout || '').trim()
        const stderr = (r.stderr || '').trim()

        // spawnSync 找不到命令时：r.error 有值、r.status 为 null（不抛异常）
        if (r.error) {
          return diagnoseSpawnError(r.error, finalCmd, useKey, dst)
        }

        const exitCode = r.status ?? -1
        const ok = exitCode === 0
        return {
          ok,
          exitCode,
          target: dst,
          stdout,
          stderr,
          message: ok ? '同步成功' : `rsync 退出码 ${exitCode}：${stderr || stdout || '未知错误'}`,
        }
      } catch (e) {
        // 个别 Node 版本会对 ENOENT 抛异常
        return diagnoseSpawnError(e instanceof Error ? e : new Error(String(e)), finalCmd, useKey, dst)
      }
    },
  }
}

/**
 * ssh + tar 传输实现：本地 tar 打包，经 ssh 管道在远端解包。
 * 仅依赖 ssh + tar（系统自带），无需 rsync / sshpass，Windows / Mac / Linux 通用。
 *
 * 密码认证：通过 SSH_ASKPASS 机制注入——写一个临时脚本（打印密码），
 * 设环境变量 SSH_ASKPASS / SSH_ASKPASS_REQUIRE=force / DISPLAY，
 * ssh 会在非交互终端自动调用该脚本取密码（需 OpenSSH ≥ 8.4）。
 * 密钥认证：直接 ssh -i <key>，无需 askpass。
 *
 * 注意：非增量同步（整目录覆盖），远端目标目录会被先清空再解包。
 */
export function createSshTarTransporter(cfg: PublishRemoteConfig): RemoteTransporter {
  const useKey = !!cfg.sshKeyPath
  if (!useKey && !cfg.password) {
    throw new Error('发布传输未配置认证：请配置 publish.remote.sshKeyPath 或 password')
  }

  return {
    push(src, dst) {
      // src 形如 /path/to/v1.0.0/（末尾 / 表示「目录内容」）。
      // 策略：打包 src 目录本身的内容（tar -C src .），解包时直接落到 dst，
      // 避免出现 dst/<版本号>/ 的多余嵌套。
      const srcNorm = src.replace(/\/+$/, '')

      // 左侧：在 src 目录内打包 . （其内容），保证解包后文件直接出现在目标目录
      const leftCmd = `tar -czf - -C ${shellQuote(srcNorm)} .`
      // 远端：建目录并清空旧内容，再在目标目录内解包
      const remoteCmd = `mkdir -p ${shellQuote(dst)} && rm -rf ${shellQuote(dst)}/* && tar -xzf - -C ${shellQuote(dst)}`
      // 右侧：ssh 连过去执行远端命令
      const sshParts = [
        cfg.sshPath, '-o', 'StrictHostKeyChecking=accept-new',
        '-o', 'ConnectTimeout=15', '-p', String(cfg.port),
      ]
      if (useKey) sshParts.push('-i', cfg.sshKeyPath!)
      // 远端命令整段作为 ssh 的最后一个参数（远端 shell 解析）
      const rightCmd = `${sshParts.join(' ')} ${cfg.user}@${cfg.host} ${shellQuote(remoteCmd)}`

      // 密码认证：写临时 askpass 脚本，走 SSH_ASKPASS 注入
      const env: NodeJS.ProcessEnv = { ...process.env }
      let askpassPath = ''
      if (!useKey) {
        askpassPath = writeAskpassScript(cfg.password)
        env.SSH_ASKPASS = askpassPath
        env.SSH_ASKPASS_REQUIRE = 'force'
        env.DISPLAY = env.DISPLAY || ':0'
      }

      try {
        const result = runPipeSync(leftCmd, rightCmd, env, srcNorm)
        const ok = result.exitCode === 0
        return {
          ok,
          exitCode: result.exitCode,
          target: dst,
          stdout: result.stdout,
          stderr: result.stderr,
          message: ok ? '同步成功' : `ssh-tar 退出码 ${result.exitCode}：${result.stderr || result.stdout || '未知错误'}`,
        }
      } catch (e) {
        return diagnoseSpawnError(
          e instanceof Error ? e : new Error(String(e)),
          'ssh',
          useKey,
          dst,
        )
      } finally {
        if (askpassPath) try { unlinkSync(askpassPath) } catch { /* ignore */ }
      }
    },
  }
}

// ===== ssh-tar 辅助函数 =====

/** 单引号转义：用于远端 shell 安全拼接路径（含中文/空格） */
function shellQuote(s: string): string {
  return "'" + String(s).replace(/'/g, "'\\''") + "'"
}

/**
 * 写一个临时 askpass 脚本，打印密码。ssh 通过 SSH_ASKPASS 调用它取密码。
 * Windows 上写 .cmd 批处理（@echo off + 密码），类 Unix 写 shell 脚本并加可执行权限。
 */
function writeAskpassScript(password: string): string {
  const isWin = process.platform === 'win32'
  const base = join(tmpdir(), `gs-askpass-${process.pid}-${Date.now()}`)
  const path = isWin ? `${base}.cmd` : base
  if (isWin) {
    // Windows: 用 @echo off 避免回显，% 特殊字符需转义
    const safe = password.replace(/%/g, '%%')
    writeFileSync(path, `@echo off\r\necho ${safe}\r\n`, { mode: 0o600 })
  } else {
    writeFileSync(path, `#!/bin/sh\necho ${shellQuote(password)}\n`, { mode: 0o755 })
  }
  return path
}

/**
 * 同步执行管道 `tar ... | ssh ...`：交给系统 shell 拼管道，用 spawnSync 同步等待。
 * env 中的 SSH_ASKPASS 等变量会传给整条管道（含 ssh 进程）。
 * Windows 用 cmd.exe，类 Unix 用 sh -c。
 */
function runPipeSync(
  leftCmd: string,   // 完整的左侧命令字符串（tar ...）
  rightCmd: string,  // 完整的右侧命令字符串（ssh ... "remote ..."）
  env: NodeJS.ProcessEnv,
  cwd: string,
): { exitCode: number; stdout: string; stderr: string } {
  const pipeline = `${leftCmd} | ${rightCmd}`
  // 统一用 sh -c：POSIX 管道与单引号语法在 Linux 原生、Windows Git Bash 都可用。
  // 仅当找不到 sh（极少见）才回退到平台默认 shell。
  const shell = 'sh'
  const shellArgs = ['-c', pipeline]
  const r = spawnSync(shell, shellArgs, {
    env,
    cwd,
    encoding: 'utf8',
    timeout: 10 * 60 * 1000,
    maxBuffer: 16 * 1024 * 1024,
  })
  if (r.error) {
    return { exitCode: -1, stdout: '', stderr: r.error.message }
  }
  return {
    exitCode: r.status ?? -1,
    stdout: (r.stdout || '').trim(),
    stderr: (r.stderr || '').trim(),
  }
}

/** 按当前配置构建传输器（外部路由调用） */
export function getTransporter(): RemoteTransporter {
  const cfg = getPublishRemoteConfig()
  return cfg.transport === 'ssh-tar'
    ? createSshTarTransporter(cfg)
    : createRsyncTransporter(cfg)
}

// ===== 发布记录读写 =====
// publish.json 与 dataspace.json 平齐，放在数据空间根目录，一个文件记录所有版本。

const PUBLISH_FILE = 'publish.json'

interface PublishFile {
  versions: Record<string, PublishRecord>
}

function publishFilePath(dataSpaceId: string): string {
  return join(dataSpaceCwd(dataSpaceId), PUBLISH_FILE)
}

/** 读取数据空间的 publish.json（供列表统计使用） */
export function readPublishFileForSpace(dataSpaceId: string): PublishFile {
  return readPublishFile(dataSpaceId)
}

function readPublishFile(dataSpaceId: string): PublishFile {
  const p = publishFilePath(dataSpaceId)
  if (!existsSync(p)) return { versions: {} }
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as PublishFile
  } catch {
    return { versions: {} }
  }
}

function writePublishFile(dataSpaceId: string, file: PublishFile): void {
  const p = publishFilePath(dataSpaceId)
  writeFileSync(p, `${JSON.stringify(file, null, 2)}\n`, 'utf8')
}

function readPublishRecord(dataSpaceId: string, version: string): PublishRecord | null {
  return readPublishFile(dataSpaceId).versions[version] ?? null
}

function writePublishRecord(dataSpaceId: string, version: string, rec: PublishRecord): void {
  const file = readPublishFile(dataSpaceId)
  file.versions[version] = rec
  writePublishFile(dataSpaceId, file)
}

// ===== 工具 =====

/** 目录名安全化：保留中文/字母/数字/._-，其余替换为 _ */
function sanitizePathSeg(name: string): string {
  return name.replace(/[^\w\u4e00-\u9fa5.-]/g, '_').replace(/^_+|_+$/g, '') || 'item'
}

// ===== 数据空间定位 =====

/**
 * 取得（或创建）与项目绑定的数据空间物理目录。
 * 同一个项目复用同一个 ds-<UUID>，多个已发布版本作为其下的子目录。
 * 注意：只确保目录本身存在，不预建 data/skills（项目型数据空间内容按版本放在子目录下），
 * 避免根目录留下多余的空目录（与独立数据空间 ensureDataSpaceWorkspace 区分）。
 */
export function ensureProjectDataSpace(dataSpaceId: string): string {
  const cwd = dataSpaceCwd(dataSpaceId)
  if (!existsSync(cwd)) mkdirSync(cwd, { recursive: true })
  return cwd
}

// ===== 核心流程 =====

export interface PublishContext {
  projectKey: string
  projectName: string
  version: string
  /** 与项目绑定的数据空间 ID（ds-XXX），由 projects.ts 解析/创建 */
  dataSpaceId: string
}

/**
 * 把项目版本目录复制到数据空间（本地中转）。
 * 源：<workspace>/proj-XXX/versions/<verId>/   （由 resolveVersionCwd 解析）
 * 目的：<dataspaces>/ds-XXX/<version>/
 *
 * 只复制业务内容子目录（data/、skills/），排除运行时元数据文件
 * （version.json、session-prefs.json、publish.json 等），避免污染归档与生产环境。
 *
 * 幂等：重复调用会先清空目的目录再复制，保证与源一致。
 */
export function copyVersionToDataSpace(ctx: PublishContext): { localSource: string } {
  const src = resolveVersionCwd(ctx.projectKey, ctx.version)
  if (!existsSync(src)) {
    throw new Error(`版本目录不存在：${src}`)
  }
  const dsRoot = ensureProjectDataSpace(ctx.dataSpaceId)
  const dst = join(dsRoot, sanitizePathSeg(ctx.version))

  // 清空旧的目的版本目录（保留目录本身），保证归档与源一致、不留陈旧元数据
  if (existsSync(dst)) {
    for (const ent of readdirSync(dst, { withFileTypes: true })) {
      // publish.json 由本模块在同步后写入，清空时一并删除，稍后重新生成
      rmSync(join(dst, ent.name), { recursive: true, force: true })
    }
  } else {
    mkdirSync(dst, { recursive: true })
  }

  // 仅复制业务内容子目录；其余文件（version.json 等元数据）不归档
  const BUSINESS_DIRS = ['data', 'skills']
  for (const sub of BUSINESS_DIRS) {
    const srcSub = join(src, sub)
    if (existsSync(srcSub)) {
      copyDirSync(srcSub, join(dst, sub))
    }
  }
  return { localSource: dst }
}

/**
 * 推送数据空间某版本到远程服务器（手动触发）。
 * 直接用数据空间本地副本作为同步源，不再回项目空间。
 * 返回同步结果并更新 publish.json。
 */
export function syncVersionToRemote(
  dataSpaceId: string,
  version: string,
  spaceName: string,
  syncedBy?: string,
): SyncResult {
  const cfg = getPublishRemoteConfig()
  if (!cfg.host) {
    throw new Error('发布传输未配置目标主机：请在 config.json 配置 publish.remote.host')
  }

  // 直接用数据空间本地副本，不回项目空间
  const localSource = join(dataSpaceCwd(dataSpaceId), sanitizePathSeg(version))
  if (!existsSync(localSource)) {
    throw new Error(`数据空间中不存在版本 ${version} 的本地副本，请确认审批已通过`)
  }

  const remoteTarget = `${cfg.targetBase}/${sanitizePathSeg(spaceName)}/${sanitizePathSeg(version)}`

  const transporter = getTransporter()
  // rsync 源路径必须以 / 结尾，表示「拷贝目录内容」而非目录本身
  const result = transporter.push(localSource.replace(/\/+$/, '') + '/', remoteTarget)

  // 更新发布记录
  const existing = readPublishRecord(dataSpaceId, version)
  const rec: PublishRecord = existing ?? {
    projectKey: '',
    projectName: spaceName,
    version,
    localSource,
    remoteTarget,
    copiedAt: new Date().toISOString(),
    remoteSync: { status: 'never' },
    syncHistory: [],
  }
  rec.localSource = localSource
  rec.remoteTarget = remoteTarget
  const syncStatus = result.ok ? 'success' as const : 'failed' as const
  rec.remoteSync = {
    status: syncStatus,
    lastSyncAt: new Date().toISOString(),
    lastExitCode: result.exitCode,
    message: result.message,
    log: [result.stdout, result.stderr].filter(Boolean).join('\n').slice(-4000),
    syncedBy,
  }
  // 追加同步历史（最新在前）
  if (!rec.syncHistory) rec.syncHistory = []
  rec.syncHistory.unshift({
    status: syncStatus,
    syncAt: rec.remoteSync.lastSyncAt!,
    exitCode: result.exitCode,
    message: result.message,
    syncedBy,
  })
  // 保留最近 20 条，防止文件无限增长
  if (rec.syncHistory.length > 20) rec.syncHistory = rec.syncHistory.slice(0, 20)
  writePublishRecord(dataSpaceId, version, rec)

  return result
}

/** 查询某项目某版本的发布状态（数据空间复制 + 远程同步） */
export function getPublishStatus(ctx: Pick<PublishContext, 'dataSpaceId' | 'version'>): {
  hasLocalCopy: boolean
  remoteSync: PublishRecord['remoteSync'] | null
  syncHistory: PublishRecord['syncHistory']
} {
  const localSource = join(dataSpaceCwd(ctx.dataSpaceId), sanitizePathSeg(ctx.version))
  const hasLocalCopy = existsSync(localSource)
  const rec = readPublishRecord(ctx.dataSpaceId, ctx.version)
  return {
    hasLocalCopy,
    remoteSync: rec?.remoteSync ?? null,
    syncHistory: rec?.syncHistory ?? [],
  }
}

```
