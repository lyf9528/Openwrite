import { lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync, zipSync } from 'fflate'
import { parse, stringify } from 'yaml'

export const SKILL_LIMIT = 8 * 1024 * 1024
const FILE_LIMIT = 128
const bundledRoot = fileURLToPath(new URL('../../../presets/openwrite/skills/', import.meta.url))
const validName = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export class SkillError extends Error {
  constructor(message: string, public status = 400) { super(message) }
}

function checkName(name: string): void {
  if (!validName.test(name) || name.length > 64) throw new SkillError('技能名称须为最多 64 字符的小写英文、数字和单连字符')
}

function metadata(content: string) {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)
  if (!match) throw new SkillError('SKILL.md 缺少 YAML 头部（name、description）')
  let data: Record<string, unknown>
  try { data = parse(match[1]!, { maxAliasCount: 0 }) as Record<string, unknown> } catch { throw new SkillError('技能 YAML 头部无效') }
  if (!data || typeof data !== 'object' || typeof data.name !== 'string' || typeof data.description !== 'string' || !data.description.trim()) {
    throw new SkillError('技能头部必须包含 name 和非空 description')
  }
  checkName(data.name)
  for (const key of ['disableModelInvocation', 'modelInvocable', 'userInvocable']) {
    if (key in data) throw new SkillError(`不支持 ${key}，请使用 disable-model-invocation / user-invocable`)
  }
  for (const key of ['disable-model-invocation', 'user-invocable']) {
    if (key in data && !/^(true|false|yes|no|on|off|1|0)$/i.test(String(data[key]))) throw new SkillError(`${key} 必须是布尔值`)
  }
  return { name: data.name, description: data.description }
}

function safeFile(path: string): void {
  if (!path || path.length > 240 || path.includes('\\') || path.includes(':') || /[\x00-\x1f]/.test(path)
    || path.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part))) {
    throw new SkillError('技能包包含不安全的文件路径')
  }
}

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
}

/** Mirrors dsh discovery: nearest Git ancestor, otherwise the workspace itself. */
async function projectRoot(workspace: string): Promise<string> {
  const root = await realpath(workspace)
  let cursor = root
  while (true) {
    if (await exists(join(cursor, '.git'))) return cursor
    const parent = dirname(cursor)
    if (parent === cursor) return root
    cursor = parent
  }
}

async function directory(path: string, create = false): Promise<boolean> {
  if (create) await mkdir(path).catch(error => { if (error.code !== 'EEXIST') throw error })
  if (!await exists(path)) return false
  const stat = await lstat(path)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new SkillError('技能目录不能是符号链接或普通文件')
  return true
}

async function localRoot(workspace: string, create = false): Promise<string> {
  const root = await projectRoot(workspace)
  const config = join(root, '.dsh')
  if (await directory(config, create)) await directory(join(config, 'skills'), create)
  return join(config, 'skills')
}

async function readRegular(path: string): Promise<Uint8Array> {
  const stat = await lstat(path)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > SKILL_LIMIT) throw new SkillError('技能文件类型或大小不受支持')
  return readFile(path)
}

async function bundle(root: string, id: string): Promise<Record<string, Uint8Array>> {
  safeFile(id)
  if (id.includes('/')) throw new SkillError('无效的技能标识')
  const path = join(root, id)
  if (!await exists(path)) throw new SkillError('技能不存在', 404)
  if (id.endsWith('.md')) return { 'SKILL.md': await readRegular(path) }
  await directory(path)
  const files: Record<string, Uint8Array> = Object.create(null)
  let total = 0
  async function walk(dir: string, prefix = ''): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const name = prefix + entry.name
      safeFile(name)
      if (entry.isSymbolicLink()) throw new SkillError('技能包不能包含符号链接')
      if (entry.isDirectory()) { await walk(join(dir, entry.name), name + '/'); continue }
      const bytes = await readRegular(join(dir, entry.name))
      total += bytes.length
      if (total > SKILL_LIMIT || Object.keys(files).length >= FILE_LIMIT) throw new SkillError('技能包超过 8 MB 或 128 个文件')
      files[name] = bytes
    }
  }
  await walk(path)
  return files
}

interface Upload { filename: string; base64: string; name?: string; description?: string }

export function prepareSkill(input: Upload) {
  if (!input || typeof input.filename !== 'string' || typeof input.base64 !== 'string'
    || input.base64.length > Math.ceil(SKILL_LIMIT / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64)) throw new SkillError('上传文件无效或超过 8 MB')
  const bytes = Buffer.from(input.base64, 'base64')
  let files: Record<string, Uint8Array> = Object.create(null)
  if (input.filename.toLowerCase().endsWith('.zip')) {
    let size = 0
    let count = 0
    try {
      files = unzipSync(bytes, { filter: entry => {
        if (++count > FILE_LIMIT + 64 || (size += entry.originalSize) > SKILL_LIMIT) throw new SkillError('解压后的技能包超过 8 MB 或文件数量上限')
        safeFile(entry.name.replace(/\/$/, ''))
        return !entry.name.endsWith('/')
      } })
    } catch (error) { if (error instanceof SkillError) throw error; throw new SkillError('无法读取 ZIP 技能包') }
    const paths = Object.keys(files)
    if (!paths.includes('SKILL.md')) {
      const tops = new Set(paths.map(path => path.split('/')[0]))
      if (tops.size !== 1 || !paths.includes(`${paths[0]?.split('/')[0]}/SKILL.md`)) throw new SkillError('ZIP 须包含根目录 SKILL.md，或一个包含 SKILL.md 的技能文件夹')
      files = Object.fromEntries(paths.map(path => [path.slice(path.indexOf('/') + 1), files[path]!]))
    }
  } else if (input.filename.toLowerCase().endsWith('.md')) {
    let content = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    if (!/^\uFEFF?---\r?\n/.test(content)) {
      if (typeof input.name !== 'string' || typeof input.description !== 'string' || !input.description.trim()) throw new SkillError('普通 Markdown 请填写技能名称和用途说明')
      checkName(input.name)
      content = `---\n${stringify({ name: input.name, description: input.description })}---\n\n${content}`
    }
    files['SKILL.md'] = Buffer.from(content)
  } else throw new SkillError('请选择 .md 或 .zip 文件')
  if (Object.keys(files).length > FILE_LIMIT || Object.values(files).reduce((sum, file) => sum + file.length, 0) > SKILL_LIMIT) throw new SkillError('技能包超过大小或文件数量上限')
  for (const path of Object.keys(files)) safeFile(path)
  const content = new TextDecoder('utf-8', { fatal: true }).decode(files['SKILL.md'])
  const meta = metadata(content)
  return { ...meta, content, paths: Object.keys(files).sort(), files }
}

export async function listSkills(workspace: string) {
  const root = await localRoot(workspace)
  const items: { id: string; source: string; name: string; description: string }[] = []
  const warnings: string[] = []
  for (const [source, dir] of [['project', root], ['bundled', bundledRoot]] as const) {
    if (!await directory(dir)) continue
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || !(entry.isDirectory() || entry.name.endsWith('.md'))) continue
      try {
        if (entry.isSymbolicLink()) throw new SkillError('符号链接不受支持')
        const path = join(dir, entry.name, ...(entry.isDirectory() ? ['SKILL.md'] : []))
        const meta = metadata(Buffer.from(await readRegular(path)).toString('utf8'))
        items.push({ id: entry.name, source, ...meta })
      } catch (error) { warnings.push(`${entry.name}: ${error instanceof Error ? error.message : String(error)}`) }
    }
  }
  return { items, warnings, directory: root }
}

export async function skillAction(workspace: string, action: string, input: Upload & { id?: string; source?: string }) {
  if (action === 'preview' || action === 'import') {
    const prepared = prepareSkill(input)
    if (action === 'import') {
      const root = await localRoot(workspace, true)
      const listing = await listSkills(workspace)
      if (listing.items.some(item => item.name === prepared.name) || await exists(join(root, prepared.name)) || await exists(join(root, prepared.name + '.md'))) {
        throw new SkillError('已有同名技能，请更改技能 name 后重新导入', 409)
      }
      const destination = join(root, prepared.name)
      try { await mkdir(destination) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new SkillError('已有同名技能', 409); throw error }
      try {
        // Publish SKILL.md last so discovery never observes a partial bundle.
        for (const path of prepared.paths.filter(path => path !== 'SKILL.md').concat('SKILL.md')) {
          await mkdir(dirname(join(destination, path)), { recursive: true })
          await writeFile(join(destination, path), prepared.files[path]!, { flag: 'wx' })
        }
      } catch (error) { await rm(destination, { recursive: true, force: true }); throw error }
    }
    const { files: _, ...preview } = prepared
    return preview
  }
  if (action === 'read' || action === 'export') {
    if (typeof input.id !== 'string' || !['project', 'bundled'].includes(input.source ?? '')) throw new SkillError('无效的技能来源')
    const root = input.source === 'bundled' ? bundledRoot : await localRoot(workspace)
    const files = await bundle(root, input.id)
    const content = Buffer.from(files['SKILL.md'] ?? []).toString('utf8')
    const meta = metadata(content)
    if (action === 'read') return { ...meta, content, paths: Object.keys(files).sort() }
    return { filename: `${meta.name}.zip`, base64: Buffer.from(zipSync(files)).toString('base64') }
  }
  throw new SkillError('未知技能操作', 404)
}
