import { useEffect, useRef, useState } from 'react'
import type { StudioApiInjected } from './api.ts'
import { JobPanel, RankTable } from './SaobangPanels.tsx'
import css from './SaobangView.module.css'

interface RankBook { rank: number; bookName: string; author: string; lastChapterTitle: string; abstract: string; firstChapterItemId: string; bookId: string }
export interface RankResult { ok: boolean; count: number; books: RankBook[] }
export interface Job {
  id: string; status: 'running' | 'done' | 'error' | 'cancelled'
  progress: string[]; meta?: Record<string, unknown>; markdown?: string; error?: string
}

const POLL_MS = 2500

export function SaobangView({ fetchStudioApi, postStudioApi }: Pick<StudioApiInjected, 'fetchStudioApi' | 'postStudioApi'>) {
  const [categories, setCategories] = useState<Record<string, string>>({})
  const [path, setPath] = useState('1_1_1014')
  const [limit, setLimit] = useState(10)
  const [books, setBooks] = useState(5)
  const [golden, setGolden] = useState(3)
  const [rank, setRank] = useState<RankResult | null>(null)
  const [job, setJob] = useState<Job | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    void (async () => {
      try {
        const result = await fetchStudioApi('/saobang/categories') as { ok: boolean; categories: Record<string, string> }
        if (!alive.current) return
        setCategories(result.categories ?? {})
        const first = Object.keys(result.categories ?? {})[0]
        if (first && !result.categories[path]) setPath(first)
      } catch (cause) { if (alive.current) setError(message(cause)) }
    })()
    return () => { alive.current = false }
  }, [])

  useEffect(() => {
    if (job?.status !== 'running') return
    const timer = setInterval(() => {
      void (async () => {
        try {
          const next = await fetchStudioApi(`/saobang/jobs/${job.id}`) as Job
          if (alive.current) setJob(next)
        } catch (cause) { if (alive.current) setError(message(cause)) }
      })()
    }, POLL_MS)
    return () => { clearInterval(timer) }
  }, [job?.id, job?.status])

  async function run(action: () => Promise<void>) {
    setBusy(true); setError(''); setNote('')
    try { await action() } catch (cause) { if (alive.current) setError(message(cause)) }
    finally { if (alive.current) setBusy(false) }
  }

  const loadRank = () => run(async () => {
    const result = await fetchStudioApi(`/saobang/rank?path=${encodeURIComponent(path)}&limit=${limit}`) as RankResult
    if (alive.current) setRank(result)
  })

  const startReport = () => run(async () => {
    const result = await postStudioApi('/saobang/report', { path, limit, books, golden }) as { job_id: string }
    if (!alive.current) return
    setRank(null)
    setNote('已开始抓取，字形解码较慢，请保持此页打开。')
    setJob({ id: result.job_id, status: 'running', progress: [] })
  })

  const cancelReport = () => run(async () => {
    if (!job) return
    await postStudioApi(`/saobang/jobs/${job.id}/cancel`, {})
    setJob({ ...job, status: 'cancelled' })
    setNote('已取消。')
  })

  return (
    <div className={css.root}>
      <h2>扫榜</h2>
      <p>抓取番茄小说网实时分类榜单，并按需解出上榜作品的黄金三章全文，生成扫榜报告。抓取只在点击后进行，全程在本机完成。</p>
      <div className={css.controls}>
        <label>榜单分类
          <select value={path} onChange={event => setPath(event.target.value)} disabled={busy || job?.status === 'running'}>
            {Object.keys(categories).length === 0 && <option value={path}>{path}</option>}
            {Object.entries(categories).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
        <label>榜单条数<input type="number" min={1} max={30} value={limit} onChange={e => setLimit(Number(e.target.value))} /></label>
        <label>抓黄金三章的书数<input type="number" min={0} max={10} value={books} onChange={e => setBooks(Number(e.target.value))} /></label>
        <label>每本章数<input type="number" min={1} max={5} value={golden} onChange={e => setGolden(Number(e.target.value))} /></label>
      </div>
      <div className={css.actions}>
        <button type="button" disabled={busy} onClick={() => void loadRank()}>看榜单</button>
        <button type="button" disabled={busy || job?.status === 'running'} onClick={() => void startReport()}>生成扫榜报告</button>
        {job?.status === 'running' && <button type="button" onClick={() => void cancelReport()}>取消</button>}
      </div>
      {error && <p className={css.error}>{error}</p>}
      {note && <p className={css.note}>{note}</p>}
      {job && <JobPanel job={job} />}
      {rank && <RankTable rank={rank} />}
    </div>
  )
}

function message(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause) }
