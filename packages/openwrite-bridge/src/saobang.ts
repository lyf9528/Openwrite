import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 扫榜：spawn 专用 venv 运行 presets 里的 saobang.py（字形反爬解码在 Python 侧）。 */

const SCRIPTS_DIR = fileURLToPath(new URL('../../../presets/openwrite/skills/saobang/scripts/', import.meta.url))
const PYTHON = join(homedir(), '.cache/saobang/venv/bin/python')
const JOB_TIMEOUT_MS = 15 * 60 * 1000
const JOB_LIMIT = 20
const PROGRESS_LIMIT = 60

export class SaobangError extends Error {
  constructor(message: string, readonly status = 400) { super(message) }
}

export function assertRankPath(value: unknown): string {
  const path = String(value ?? '')
  if (!/^[0-9]+_[0-9]+_[0-9]+$/.test(path)) throw new SaobangError('榜单路径无效，应为形如 1_1_1014 的分类 id')
  return path
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const num = Number(value)
  if (!Number.isFinite(num)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(num)))
}

interface RunResult { stdout: string; stderr: string }

function run(args: string[], timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON, ['saobang.py', ...args], { cwd: SCRIPTS_DIR })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new SaobangError('扫榜脚本执行超时', 504)) }, timeoutMs)
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', cause => { clearTimeout(timer); reject(new SaobangError(`无法启动扫榜脚本：${cause.message}（检查 ~/.cache/saobang/venv）`, 500)) })
    child.on('close', code => {
      clearTimeout(timer)
      const line = stdout.trim().split('\n')[0] ?? ''
      try {
        const data = JSON.parse(line)
        if (code === 0 && data.ok) { resolve({ stdout: line, stderr }); return }
        reject(new SaobangError(typeof data.error === 'string' ? data.error : `扫榜脚本退出码 ${code}`, 502))
      } catch {
        reject(new SaobangError(`扫榜脚本输出无法解析（退出码 ${code}）：${stderr.slice(-300)}`, 502))
      }
    })
  })
}

export async function saobangCategories(): Promise<unknown> {
  const { stdout } = await run(['categories'], 120_000)
  return JSON.parse(stdout)
}

export async function saobangRank(path: string, limit: number): Promise<unknown> {
  const { stdout } = await run(['rank', assertRankPath(path), '--limit', String(clampInt(limit, 20, 1, 30))], 120_000)
  return JSON.parse(stdout)
}

export interface SaobangJob {
  id: string
  status: 'running' | 'done' | 'error' | 'cancelled'
  progress: string[]
  meta?: Record<string, unknown>
  markdown?: string
  error?: string
}

const jobs = new Map<string, SaobangJob & { child?: ChildProcess }>()

function pruneJobs(): void {
  if (jobs.size <= JOB_LIMIT) return
  for (const [id, job] of jobs) {
    if (jobs.size <= JOB_LIMIT) break
    if (job.status !== 'running') { job.child?.kill('SIGKILL'); jobs.delete(id) }
  }
}

export function saobangReportStart(input: Record<string, unknown>): { job_id: string } {
  const path = assertRankPath(input.path)
  const limit = clampInt(input.limit, 10, 1, 30)
  const books = clampInt(input.books, 5, 0, 10)
  const golden = clampInt(input.golden, 3, 1, 5)
  const id = `sb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  const job: SaobangJob & { child?: ChildProcess } = { id, status: 'running', progress: [] }
  jobs.set(id, job)
  pruneJobs()
  void (async () => {
    let dir = ''
    try {
      dir = await mkdtemp(join(tmpdir(), 'saobang-'))
      const out = join(dir, 'report.md')
      const child = spawn(PYTHON, ['saobang.py', 'report', path,
        '--limit', String(limit), '--books', String(books), '--golden', String(golden), '--out', out], { cwd: SCRIPTS_DIR })
      job.child = child
      let stdout = ''
      let stderrTail = ''
      const timer = setTimeout(() => child.kill('SIGKILL'), JOB_TIMEOUT_MS)
      child.stdout.on('data', chunk => { stdout += chunk })
      child.stderr.on('data', chunk => {
        stderrTail = (stderrTail + chunk).slice(-2000)
        for (const line of String(chunk).split('\n')) {
          const trimmed = line.trim()
          if (trimmed) {
            job.progress.push(trimmed)
            if (job.progress.length > PROGRESS_LIMIT) job.progress.shift()
          }
        }
      })
      await new Promise<void>((resolve, reject) => {
        child.on('error', reject)
        child.on('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new SaobangError(`扫榜脚本退出码 ${code}：${stderrTail.slice(-200)}`, 502)) })
      })
      const meta = JSON.parse(stdout.trim().split('\n')[0] ?? '{}')
      if (!meta.ok) throw new SaobangError(typeof meta.error === 'string' ? meta.error : '扫榜失败', 502)
      job.meta = meta
      job.markdown = await readFile(out, 'utf8')
      job.status = 'done'
    } catch (cause) {
      if (job.status === 'cancelled') return
      job.status = 'error'
      job.error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      job.child = undefined
      if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  })()
  return { job_id: id }
}

export function saobangJobStatus(id: string): SaobangJob {
  const job = jobs.get(id)
  if (!job) throw new SaobangError('任务不存在或已过期', 404)
  const { child: _child, ...rest } = job
  return rest
}

export function saobangJobCancel(id: string): { ok: true } {
  const job = jobs.get(id)
  if (!job) throw new SaobangError('任务不存在或已过期', 404)
  if (job.status === 'running') {
    job.status = 'cancelled'
    job.child?.kill('SIGKILL')
  }
  return { ok: true }
}
