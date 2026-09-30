import { useEffect, useRef, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { StudioApiInjected } from './api.ts'
import { parseModelProfiles, type ModelProfileDto } from './dto.ts'
import { PROGRESSION_KINDS, validStages, type AssetKind, type Stage } from './asset-generation.ts'
import css from './views.module.css'

export type GenerationApi = Pick<StudioApiInjected, 'fetchStudioApi' | 'postStudioApi'>
export type AiDraft = Record<string, string | Stage[]>
type T = PropsLocale<'studio-panel'>['t']
const fields: Record<AssetKind, string[]> = {
  character: ['name', 'summary', 'personality', 'goal', 'fear', 'appearance', 'voice', 'tier'],
  world: ['name', 'summary', 'type', 'subtype'],
  progression: ['name', 'summary', 'kind', 'stages'],
}
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
function unwrap(value: unknown) { const root = record(value); return 'data' in root ? record(root['data']) : root }

export function AssetAiGeneration({ kind, api, current, busy, onApply, t }: {
  kind: AssetKind; api: GenerationApi; current: AiDraft; busy: boolean; onApply: (draft: AiDraft) => void; t: T
}) {
  const [open, setOpen] = useState(false)
  const [profiles, setProfiles] = useState<ModelProfileDto[]>([])
  const [loading, setLoading] = useState(false)
  const [profileId, setProfileId] = useState('')
  const [instructions, setInstructions] = useState('')
  const [includeContext, setIncludeContext] = useState(true)
  const [count, setCount] = useState(6)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [names, setNames] = useState<string[]>([])
  const [draft, setDraft] = useState<AiDraft | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [model, setModel] = useState('')
  const version = useRef(0)
  const currentRef = useRef(current)
  currentRef.current = current
  useEffect(() => () => { version.current++ }, [])
  const loadProfiles = async () => {
    const ticket = ++version.current
    setLoading(true); setError('')
    try {
      const response = await api.fetchStudioApi('/model/profiles')
      if (version.current !== ticket) return
      setProfiles(parseModelProfiles(response).filter(p => p.configured && p.capabilities.chat))
    } catch (cause) { if (version.current === ticket) setError(cause instanceof Error ? cause.message : t('assets.ai.failed')) }
    finally { if (version.current === ticket) setLoading(false) }
  }
  const generate = async (mode: 'names' | 'asset') => {
    if (pending || busy) return
    const ticket = ++version.current
    setPending(true); setError(''); setDraft(null); setNames([]); setSelected([])
    try {
      const response = unwrap(await api.postStudioApi('/assets/generate', {
        kind, mode, profile_id: profileId, instructions, include_context: includeContext, count,
        progression_kind: typeof current['kind'] === 'string' ? current['kind'] : 'ability',
        current: Object.fromEntries(Object.entries(current).filter(([key, value]) => fields[kind].includes(key) && typeof value === 'string')),
      }))
      if (version.current !== ticket) return
      const modelInfo = record(response['model'])
      setModel([modelInfo['label'], modelInfo['model']].filter(v => typeof v === 'string').join(' · '))
      if (mode === 'names') {
        if (!Array.isArray(response['names']) || !response['names'].length || !response['names'].every(n => typeof n === 'string' && n.trim())) throw new Error(t('assets.ai.invalid'))
        setNames(response['names'] as string[])
      } else {
        const raw = record(response['draft'])
        const next: AiDraft = {}
        for (const key of fields[kind]) {
          const value = raw[key]
          if (key === 'stages') {
            if (!Array.isArray(value) || !value.every(s => typeof s === 'object' && s !== null && typeof s.id === 'string' && typeof s.name === 'string' && ['abilities', 'limitations', 'requirements'].every(f => Array.isArray(s[f]) && s[f].every((v: unknown) => typeof v === 'string'))) || !validStages(value as Stage[])) throw new Error(t('assets.ai.invalid'))
            next[key] = value as Stage[]
          } else if (typeof value === 'string') next[key] = value
        }
        if (!next['name'] || !next['summary']) throw new Error(t('assets.ai.invalid'))
        if (kind === 'progression' && !PROGRESSION_KINDS.includes(next['kind'] as typeof PROGRESSION_KINDS[number])) throw new Error(t('assets.ai.invalid'))
        setDraft(next)
        // Filled fields are locked by default, including edits made during the request.
        setSelected(Object.keys(next).filter(key => {
          const value = currentRef.current[key]
          return value === undefined || value === '' || (Array.isArray(value) && !value.some(s => s.name || s.abilities?.length))
        }))
      }
    } catch (cause) { if (version.current === ticket) setError(cause instanceof Error ? cause.message : t('assets.ai.failed')) }
    finally { if (version.current === ticket) setPending(false) }
  }
  const label = (key: string): string => key === 'name' ? t('assets.edit.name') : key === 'summary' ? t('assets.edit.summary') : key === 'stages' ? t('assets.create.stages') : t(`assets.field.${key}` as Parameters<T>[0])
  return <section className={css.stageCard}>
    <button type="button" className={css.button} aria-expanded={open} disabled={busy || pending} onClick={() => { setOpen(!open); if (!open) void loadProfiles() }}>{t('assets.ai.title')}</button>
    {open && <>
      <p className={css.detailNotice}>{t('assets.ai.hint')}</p>
      <fieldset disabled={busy || pending || loading} className={css.stageCard}>
        <label className={css.editorRow}><span className={css.editorLabel}>{t('assets.ai.model')}</span><select className={css.input} value={profileId} onChange={e => setProfileId(e.target.value)}><option value="">{t('assets.ai.default')}</option>{profiles.map(p => <option key={p.id} value={p.id}>{p.label} · {p.model}</option>)}</select></label>
        {!loading && profiles.length === 0 && <p>{t('assets.ai.noModel')}</p>}
        <label className={css.editorRow}><span className={css.editorLabel}>{t('assets.ai.instructions')}</span><textarea className={css.textarea} rows={3} maxLength={4000} placeholder={t('assets.ai.example')} value={instructions} onChange={e => setInstructions(e.target.value)} /></label>
        <label><input type="checkbox" checked={includeContext} onChange={e => setIncludeContext(e.target.checked)} />{t('assets.ai.context')}</label>
        {kind === 'progression' && <label className={css.editorRow}><span className={css.editorLabel}>{t('assets.generate.count')}</span><input type="number" className={css.input} min={1} max={12} value={count} onChange={e => setCount(Number(e.target.value))} /></label>}
        <div className={css.generationActions}>
          <button type="button" className={css.button} disabled={!profiles.length} onClick={() => void generate('names')}>{t('assets.ai.names')}</button>
          <button type="button" className={css.button} disabled={!profiles.length || !Number.isInteger(count) || count < 1 || count > 12} onClick={() => void generate('asset')}>{t('assets.ai.generate')}</button>
        </div>
      </fieldset>
      {pending && <p role="status">{t('assets.ai.running')}</p>}
      {error && <p role="alert" className={css.errorText}>{error}</p>}
      {(draft || names.length > 0) && <p className={css.detailNotice}>{model}</p>}
      <div className={css.generationActions}>{names.map(name => <button type="button" className={css.button} key={name} disabled={busy || pending} onClick={() => onApply({ name })}>{name}</button>)}</div>
      {draft && <fieldset disabled={busy || pending} className={css.stageCard}>
        <legend>{t('assets.ai.preview')}</legend>
        <p>{t('assets.ai.selectHint')}</p>
        {Object.entries(draft).map(([key, value]) => <div key={key} className={css.stageCard}>
          <label><input type="checkbox" checked={selected.includes(key)} onChange={e => setSelected(old => e.target.checked ? [...old, key] : old.filter(k => k !== key))} />{label(key)}</label>
          {Array.isArray(value) ? value.map(stage => <div key={stage.id}><strong>{stage.name}</strong>{(['abilities', 'limitations', 'requirements'] as const).map(field => <p key={field}>{t(`assets.stage.${field}`)}：{stage[field]?.join('；')}</p>)}</div>) : <p style={{ whiteSpace: 'pre-wrap' }}>{key === 'kind' ? t(`assets.progression.${value as typeof PROGRESSION_KINDS[number]}`) : value}</p>}
        </div>)}
        <button type="button" className={css.primaryButton} disabled={!selected.length} onClick={() => { onApply(Object.fromEntries(Object.entries(draft).filter(([key]) => selected.includes(key)))); setDraft(null) }}>{t('assets.ai.apply')}</button>
      </fieldset>}
    </>}
  </section>
}
