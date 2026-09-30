import { useEffect, useRef, useState } from 'react'
import type { StudioApiInjected } from './api.ts'
import css from './SkillsView.module.css'

interface Item { id: string; source: string; name: string; description: string }
interface Preview { name: string; description: string; content: string; paths: string[] }
interface Upload { filename: string; base64: string; name: string; description: string }

export function SkillsView({ fetchStudioApi, postStudioApi }: Pick<StudioApiInjected, 'fetchStudioApi' | 'postStudioApi'>) {
  const [items, setItems] = useState<Item[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [directory, setDirectory] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [upload, setUpload] = useState<Upload | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [selected, setSelected] = useState<Item | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const alive = useRef(true)

  async function refresh() {
    const result = await fetchStudioApi('/skills') as { items: Item[]; warnings: string[]; directory: string }
    if (!alive.current) return
    setItems(result.items); setWarnings(result.warnings); setDirectory(result.directory)
  }
  useEffect(() => {
    alive.current = true
    void refresh().catch(cause => { if (alive.current) setError(String(cause)) })
    return () => { alive.current = false }
  }, [])

  async function run(action: () => Promise<void>) {
    setBusy(true); setError(''); setNote('')
    try { await action() } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { if (alive.current) setBusy(false) }
  }
  function clearPreview() { setUpload(null); setPreview(null); setSelected(null) }
  async function previewFile() {
    if (!file) return
    if (file.size > 8 * 1024 * 1024) throw new Error('文件不能超过 8 MB')
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (!alive.current) return
    let binary = ''
    for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
    const input = { filename: file.name, base64: btoa(binary), name, description }
    const result = await postStudioApi('/skills/preview', input) as Preview
    if (!alive.current) return
    setUpload(input); setPreview(result); setSelected(null)
  }
  async function importFile() {
    if (!upload) return
    await postStudioApi('/skills/import', upload)
    if (!alive.current) return
    setUpload(null); setNote('导入成功。可在创作对话中要求使用此技能；目录通常会在下一轮对话刷新。')
    await refresh()
  }
  async function read(item: Item) {
    const result = await postStudioApi('/skills/read', { id: item.id, source: item.source }) as Preview
    if (!alive.current) return
    setSelected(item); setUpload(null); setPreview(result)
  }
  async function download() {
    if (!selected) return
    const result = await postStudioApi('/skills/export', { id: selected.id, source: selected.source }) as { filename: string; base64: string }
    if (!alive.current) return
    const bytes = Uint8Array.from(atob(result.base64), char => char.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }))
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = result.filename
    document.body.append(anchor); anchor.click(); anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return <div className={css.root}>
    <header><h2>Skill</h2><p>管理当前项目导入的技能，查看和导出 OpenWrite 内置技能。</p>
      <p>技能用于创作对话；导入后不会自动改变后台写章模型的提示词。</p></header>
    {error && <p role="alert" className={css.error}>{error}</p>}
    {note && <p role="status">{note}</p>}
    <section className={css.upload} aria-label="导入技能">
      <h3>从电脑导入</h3>
      <p>支持 Markdown 或 ZIP（根目录或单个文件夹内含 SKILL.md），最多 8 MB。ZIP 会保留附带的参考资料和脚本，导入时不执行脚本。</p>
      <label>技能文件<input type="file" accept=".md,.zip" disabled={busy} onChange={event => { setFile(event.target.files?.[0] ?? null); clearPreview() }} /></label>
      <p>普通 Markdown 没有技能头部时，填写以下两项即可转换；已有头部的文件保留原名称和说明。</p>
      <label>技能名称<input value={name} disabled={busy} placeholder="my-writing-skill" onChange={event => { setName(event.target.value); clearPreview() }} /></label>
      <label>用途说明<input value={description} disabled={busy} placeholder="说明何时使用这个技能" onChange={event => { setDescription(event.target.value); clearPreview() }} /></label>
      <button type="button" disabled={busy || !file} onClick={() => void run(previewFile)}>预览导入</button>
    </section>
    <div className={css.columns}>
      <section aria-label="技能列表"><h3>技能列表</h3>
        <button type="button" disabled={busy} onClick={() => void run(refresh)}>刷新列表</button>
        {items.length === 0 && <p>暂无技能</p>}
        {items.map(item => <button type="button" className={css.item} key={`${item.source}:${item.id}`} disabled={busy}
          aria-pressed={selected?.id === item.id && selected.source === item.source} onClick={() => void run(() => read(item))}>
          <strong>{item.name}</strong><small>{item.source === 'bundled' ? '内置' : '项目'}</small><span>{item.description}</span>
        </button>)}
      </section>
      <section aria-label="技能内容"><h3>{preview?.name ?? '内容预览'}</h3>
        {preview ? <><p>{preview.description}</p>
          {upload && <button type="button" disabled={busy} onClick={() => void run(importFile)}>确认导入</button>}
          {selected && <button type="button" disabled={busy} onClick={() => void run(download)}>导出 ZIP 到电脑</button>}
          <pre className={css.content}>{preview.content}</pre>
          <details><summary>包含 {preview.paths.length} 个文件</summary><ul>{preview.paths.map(path => <li key={path}>{path}</li>)}</ul></details>
        </> : <p>选择技能查看内容，或先预览要导入的文件。</p>}
      </section>
    </div>
    {warnings.length > 0 && <details><summary>有 {warnings.length} 个技能无法读取</summary><ul>{warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></details>}
    <p className={css.path}>项目技能目录：{directory || '正在读取…'}。同一 Git 项目下的作品共享此目录。</p>
  </div>
}
