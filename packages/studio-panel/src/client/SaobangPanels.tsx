import { useState } from 'react'
import type { Job, RankResult } from './SaobangView.tsx'
import css from './SaobangView.module.css'

export function RankTable({ rank }: { rank: RankResult }) {
  return (
    <section className={css.block}>
      <h3>榜单前 {rank.books.length} 名</h3>
      <table className={css.table}>
        <thead><tr><th>#</th><th>书名</th><th>作者</th><th>最新章节</th></tr></thead>
        <tbody>
          {rank.books.map(book => <tr key={`${book.rank}-${book.bookId}`}>
            <td>{book.rank}</td>
            <td>{book.bookName}</td>
            <td>{book.author}</td>
            <td>{book.lastChapterTitle}</td>
          </tr>)}
        </tbody>
      </table>
    </section>
  )
}

export function JobPanel({ job }: { job: Job }) {
  const [copied, setCopied] = useState(false)
  const markdown = job.markdown ?? ''

  async function copy() {
    try {
      await navigator.clipboard.writeText(markdown)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { setCopied(false) }
  }

  function download() {
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `扫榜报告-${new Date().toISOString().slice(0, 10)}.md`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section className={css.block}>
      <h3>抓取任务 {job.status === 'running' ? '进行中…' : job.status === 'done' ? '已完成' : job.status === 'cancelled' ? '已取消' : '失败'}</h3>
      {job.status === 'error' && <p className={css.error}>{job.error}</p>}
      {job.progress.length > 0 && <pre className={css.progress}>{job.progress.slice(-6).join('\n')}</pre>}
      {job.status === 'done' && <>
        {job.meta && <p className={css.note}>榜单 {String(job.meta.books ?? '')} 本 · 黄金三章 {String(job.meta.golden_books ?? '')} 本 · 约 {String(job.meta.chars ?? '')} 字</p>}
        <div className={css.actions}>
          <button type="button" onClick={() => void copy()}>{copied ? '已复制' : '复制 Markdown'}</button>
          <button type="button" onClick={download}>下载 .md</button>
        </div>
        <pre className={css.content}>{markdown}</pre>
      </>}
    </section>
  )
}
