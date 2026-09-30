/**
 * Asset editor + create form for the 资产 tab. The write surface is exactly
 * the server's contract (verified against OpenWrite tools/structured_assets.py
 * create/update and tools/studio_application.py create_asset/update_asset):
 *
 * - Update: POST /api/assets/update { kind, id, revision, data } — `revision`
 *   is the optimistic lock (the detail's fingerprint); a stale revision
 *   answers 409 ASSET_CONFLICT. `data` merges into the front matter, filtered
 *   server-side to CHARACTER_FIELDS / WORLD_FIELDS (character: name, aliases,
 *   tier, summary, tags, personality, goal, fear, taboos, appearance, voice,
 *   current_state, organization, progression_system, progression_stage,
 *   detail_refs, related; world: name, kind, type, subtype, summary, status,
 *   tags, detail_refs, related). Relations edit through data.related as
 *   strings or { target, kind, note } dicts. Progression merges data into the
 *   YAML document (absent keys, e.g. stages, are preserved).
 * - Create: POST /api/assets { kind, id, data } — id must match
 *   [A-Za-z0-9][A-Za-z0-9_.-]{0,79}; progression requires a non-empty stages
 *   list of { id, name } and kind in ability/rank/cultivation/career/
 *   reputation/curse/custom.
 */

import { useEffect, useRef, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { VditorBody } from './VditorBody.tsx'
import css from './views.module.css'
import { AssetAiGeneration, type GenerationApi, type AiDraft } from './AssetAiGeneration.tsx'
import { AssetGeneration, StageFields } from './AssetGeneration.tsx'
import { PROGRESSION_KINDS, generateId, validAssetId, validStages as areStagesValid, type Stage } from './asset-generation.ts'

/** The summary fields the editor needs from the parsed detail. */
export interface AssetEditorSource {
  stages?: Stage[]
  name: string
  summary: string
  aliases: string[]
  tags: string[]
  scalars: { key: string; value: string }[]
  /** List-typed whitelist fields (taboos/detail_refs), edited one entry per line. */
  lists: { key: string; items: string[] }[]
  related: RelationDraft[]
  /** The markdown body (body_markdown), edited with a preview toggle. */
  body: string
  /**
   * Derived relations (incoming edges and annotation-sourced entries) shown
   * read-only in the editor. They live in OTHER assets' front matter (or in
   * body annotations), so they are not editable here — but hiding them made
   * the editor look broken next to the read view, which shows them.
   */
  derivedRelations: DerivedRelation[]
}

/** One derived (non-editable) relation row for editor display. */
export interface DerivedRelation {
  name: string
  note: string
  direction: 'outgoing' | 'incoming'
  origin: string
}

/** One editable frontmatter relation row. */
export interface RelationDraft {
  target: string
  kind: string
  note: string
}

/** A relation-target candidate from the loaded asset list. */
export interface RelationCandidate {
  id: string
  name: string
  kind: string
}

type TFunc = PropsLocale<'studio-panel'>['t']

/** Split a comma/、/，-separated input into a clean string list. */
function splitList(value: string): string[] {
  return value.split(/[,、，]/).map(item => item.trim()).filter(item => item !== '')
}

/** Split a one-entry-per-line textarea into a clean string list (Studio's line-join semantics). */
function splitLines(value: string): string[] {
  return value.split('\n').map(item => item.trim()).filter(item => item !== '')
}

/** Localized label for a list-typed whitelist field (raw key as fallback). */
function listLabel(key: string, t: TFunc): string {
  switch (key) {
    case 'detail_refs': return t('assets.list.detail_refs')
    case 'taboos': return t('assets.list.taboos')
    default: return key
  }
}

/**
 * Localized label for any front-matter field key (edit form + read field
 * table). List-typed keys delegate to the 索引 labels; unmapped keys fall
 * back to the raw key — unknown fields are never hidden.
 */
export function fieldLabel(key: string, t: TFunc): string {
  switch (key) {
    case 'detail_refs':
    case 'taboos':
      return listLabel(key, t)
    case 'tier':
    case 'personality':
    case 'goal':
    case 'fear':
    case 'appearance':
    case 'voice':
    case 'current_state':
    case 'organization':
    case 'progression_system':
    case 'progression_stage':
    case 'status':
    case 'kind':
    case 'type':
    case 'subtype':
    case 'state_updated_at':
    case 'role':
      return t(`assets.field.${key}`)
    default:
      return key
  }
}

/** Scalar keys always shown even when absent from the current front matter. */
const ALWAYS_SCALARS: Record<string, readonly string[]> = {
  character: ['tier', 'personality', 'goal', 'current_state'],
  world: ['type', 'subtype', 'status'],
  progression: ['kind'],
}

interface AssetEditorProps {
  generationApi?: GenerationApi
  kind: string
  /** Current values from the freshly loaded detail (remount on epoch change resets the draft). */
  source: AssetEditorSource
  candidates: readonly RelationCandidate[]
  saving: boolean
  saveError: string | null
  conflict: boolean
  onSave: (data: Record<string, unknown>, bodyMarkdown: string) => void
  /** Single-field autosave on blur (Obsidian-style): AssetsView owns the revision chain. */
  onFieldSave: (field: string, value: unknown) => void
  /** The field key whose single-field save is in flight (input stays interactive otherwise). */
  fieldBusy: string | null
  onCancel: () => void
  onRefresh: () => void
  onDirtyChange?: (dirty: boolean) => void
  initialDraft?: AssetEditorDraft | undefined
  onDraftChange?: (draft: AssetEditorDraft, dirty: boolean) => void
  t: TFunc
}

export interface AssetEditorDraft {
  stages?: Stage[]
  name: string
  summary: string
  aliasesText: string
  tagsText: string
  scalars: Record<string, string>
  related: RelationDraft[]
  listsText: Record<string, string>
  newTarget: string
  newNote: string
  bodyDraft: string
}

/** Read-write editor over one asset's allowed front-matter fields. */
export function AssetEditor({ generationApi, kind, source, candidates, saving, saveError, conflict, onSave, onFieldSave, fieldBusy, onCancel, onRefresh, onDirtyChange, initialDraft, onDraftChange, t }: AssetEditorProps) {
  const [stages, setStages] = useState<Stage[]>(initialDraft?.stages ?? source.stages ?? [])
  const [name, setName] = useState(initialDraft?.name ?? source.name)
  const [summary, setSummary] = useState(initialDraft?.summary ?? source.summary)
  const [aliasesText, setAliasesText] = useState(initialDraft?.aliasesText ?? source.aliases.join('、'))
  const [tagsText, setTagsText] = useState(initialDraft?.tagsText ?? source.tags.join('、'))
  const [scalars, setScalars] = useState<Record<string, string>>(() => {
    if (initialDraft) return initialDraft.scalars
    const initial: Record<string, string> = {}
    for (const { key, value } of source.scalars) initial[key] = value
    for (const key of ALWAYS_SCALARS[kind] ?? []) initial[key] ??= ''
    return initial
  })
  const [related, setRelated] = useState<RelationDraft[]>(initialDraft?.related ?? source.related.map(row => ({ ...row })))
  const [listsText, setListsText] = useState<Record<string, string>>(() =>
    initialDraft?.listsText ?? Object.fromEntries(source.lists.map(list => [list.key, list.items.join('\n')])))
  const [newTarget, setNewTarget] = useState(initialDraft?.newTarget ?? '')
  const [newNote, setNewNote] = useState(initialDraft?.newNote ?? '')
  const [bodyDraft, setBodyDraft] = useState(initialDraft?.bodyDraft ?? source.body)
  /** True after the Vditor script failed — the body falls back to a textarea with a notice. */
  const [liveFailed, setLiveFailed] = useState(false)

  const scalarKeys = Object.keys(scalars)
  const otherFieldsDirty = JSON.stringify(stages) !== JSON.stringify(source.stages ?? []) || name !== source.name || summary !== source.summary ||
    JSON.stringify(splitList(aliasesText)) !== JSON.stringify(source.aliases) ||
    JSON.stringify(splitList(tagsText)) !== JSON.stringify(source.tags) ||
    JSON.stringify(related) !== JSON.stringify(source.related) ||
    scalarKeys.some(key => (scalars[key] ?? '') !== (source.scalars.find(item => item.key === key)?.value ?? '')) ||
    Object.keys(listsText).some(key => JSON.stringify(splitLines(listsText[key] ?? '')) !== JSON.stringify(source.lists.find(item => item.key === key)?.items ?? [])) ||
    newTarget !== '' || newNote !== ''
  const dirty = otherFieldsDirty || bodyDraft !== source.body
  const draftRef = useRef<AssetEditorDraft>({ stages, name, summary, aliasesText, tagsText, scalars, related, listsText, newTarget, newNote, bodyDraft })
  draftRef.current = { stages, name, summary, aliasesText, tagsText, scalars, related, listsText, newTarget, newNote, bodyDraft }
  const updateBody = (value: string) => {
    const draft = { ...draftRef.current, bodyDraft: value }
    draftRef.current = draft
    setBodyDraft(value)
    // Vditor can flush during unmount, when no further React render/effect
    // will run. Recovery must receive the latest body synchronously.
    const changed = otherFieldsDirty || value !== source.body
    onDraftChange?.(draft, changed)
    onDirtyChange?.(changed)
  }
  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  useEffect(() => () => { onDirtyChange?.(false) }, [onDirtyChange])
  useEffect(() => {
    onDraftChange?.({ stages, name, summary, aliasesText, tagsText, scalars, related, listsText, newTarget, newNote, bodyDraft }, dirty)
  }, [stages, aliasesText, bodyDraft, dirty, listsText, name, newNote, newTarget, onDraftChange, related, scalars, summary, tagsText])

  /**
   * Blur-commit one field when it drifted from the loaded detail. Single-key
   * merge on the wire; AssetsView owns the revision chain and conflict UX.
   */
  const commitField = (field: string, value: unknown) => {
    if (fieldBusy === field || saving) return
    onFieldSave(field, value)
  }

  const save = () => {
    const data: Record<string, unknown> = {
      name: name.trim(),
      summary,
      aliases: splitList(aliasesText),
      tags: splitList(tagsText),
    }
    for (const [key, value] of Object.entries(scalars)) {
      if (value !== '') data[key] = value
    }
    // List fields serialize back as arrays, one entry per line.
    for (const [key, value] of Object.entries(listsText)) {
      data[key] = splitLines(value)
    }
    // character/world only: related is the editable front-matter list
    // (relation_view's incoming/annotation entries are derived, not edited).
    if (kind !== 'progression') {
      data['related'] = related
        .filter(row => row.target.trim() !== '')
        .map(row => row.note.trim() === '' && row.kind === 'related'
          ? row.target.trim()
          : { target: row.target.trim(), kind: row.kind.trim() || 'related', note: row.note.trim() })
    }
    if (kind === 'progression') {
      if (!areStagesValid(stages)) return
      data['stages'] = stages.map(stage => ({ ...stage, id: stage.id.trim(), name: stage.name.trim() }))
    }
    onSave(data, draftRef.current.bodyDraft)
  }

  const applyAiDraft = (draft: AiDraft) => {
    if (typeof draft['name'] === 'string') setName(draft['name'])
    if (typeof draft['summary'] === 'string') setSummary(draft['summary'])
    if (Array.isArray(draft['stages'])) setStages(draft['stages'])
    setScalars(previous => ({ ...previous, ...Object.fromEntries(Object.entries(draft).filter(([key, value]) => !['name', 'summary', 'stages'].includes(key) && typeof value === 'string')) as Record<string, string> }))
  }
  return (
    <div className={css.editor}>
      {generationApi && <AssetAiGeneration kind={kind as 'character' | 'world' | 'progression'} api={generationApi} current={{ name, summary, ...scalars, stages }} busy={saving || fieldBusy !== null} onApply={applyAiDraft} t={t} />}
      <label className={css.editorRow}>
        <span className={css.editorLabel}>{t('assets.edit.name')}</span>
        <input className={css.input} value={name} onChange={event => { setName(event.target.value) }}
          onBlur={() => { if (name.trim() !== '' && name !== source.name) commitField('name', name.trim()) }}
          disabled={saving || fieldBusy === 'name'} />
      </label>
      <label className={css.editorRow}>
        <span className={css.editorLabel}>{t('assets.edit.summary')}</span>
        <textarea className={css.textarea} rows={2} value={summary} onChange={event => { setSummary(event.target.value) }}
          onBlur={() => { if (summary !== source.summary) commitField('summary', summary) }}
          disabled={saving || fieldBusy === 'summary'} />
      </label>
      <label className={css.editorRow}>
        <span className={css.editorLabel}>{t('assets.aliases')}</span>
        <input className={css.input} value={aliasesText} placeholder={t('assets.edit.listHint')} onChange={event => { setAliasesText(event.target.value) }}
          onBlur={() => { if (splitList(aliasesText).join('、') !== source.aliases.join('、')) commitField('aliases', splitList(aliasesText)) }}
          disabled={saving || fieldBusy === 'aliases'} />
      </label>
      <label className={css.editorRow}>
        <span className={css.editorLabel}>{t('assets.edit.tags')}</span>
        <input className={css.input} value={tagsText} placeholder={t('assets.edit.listHint')} onChange={event => { setTagsText(event.target.value) }}
          onBlur={() => { if (splitList(tagsText).join('、') !== source.tags.join('、')) commitField('tags', splitList(tagsText)) }}
          disabled={saving || fieldBusy === 'tags'} />
      </label>
      {scalarKeys.map(key => (
        <label key={key} className={css.editorRow}>
          <span className={css.editorLabel}>{fieldLabel(key, t)}</span>
          {kind === 'progression' && key === 'kind' ? <select className={css.input} value={scalars[key] || 'ability'} disabled={saving || fieldBusy === key}
            onChange={event => { const value = event.target.value; setScalars(previous => ({ ...previous, [key]: value })); commitField(key, value) }}>
            {!PROGRESSION_KINDS.includes(scalars[key] as typeof PROGRESSION_KINDS[number]) && scalars[key] && <option value={scalars[key]}>{scalars[key]}</option>}
            {PROGRESSION_KINDS.map(value => <option key={value} value={value}>{t(`assets.progression.${value}`)}</option>)}
          </select> : <input
            className={css.input}
            value={scalars[key] ?? ''}
            placeholder={(scalars[key] ?? '') === '' ? t('assets.edit.optional') : undefined}
            onChange={event => { setScalars(previous => ({ ...previous, [key]: event.target.value })) }}
            onBlur={() => {
              const baseline = source.scalars.find(item => item.key === key)?.value ?? ''
              if ((scalars[key] ?? '') !== baseline) commitField(key, scalars[key] ?? '')
            }}
            disabled={saving || fieldBusy === key}
          />}
        </label>
      ))}
      {kind === 'progression' && <>
        <AssetGeneration kind="progression" progressionKind={scalars['kind'] || 'ability'} busy={saving || fieldBusy !== null} hasStages={stages.length > 0} onName={setName} onStages={setStages} t={t} />
        <StageFields stages={stages} onChange={setStages} busy={saving} t={t} />
        {!areStagesValid(stages) && <p className={css.errorText}>{t('assets.generate.invalid')}</p>}
      </>}
      {Object.keys(listsText).map(key => (
        <label key={key} className={css.editorRow}>
          <span className={css.editorLabel}>{fieldLabel(key, t)}</span>
          <textarea
            className={css.textarea}
            rows={Math.max(2, splitLines(listsText[key] ?? '').length + 1)}
            value={listsText[key] ?? ''}
            placeholder={t('assets.edit.linesHint')}
            onChange={event => { setListsText(previous => ({ ...previous, [key]: event.target.value })) }}
            onBlur={() => {
              const baseline = source.lists.find(item => item.key === key)?.items.join('\n') ?? ''
              if ((listsText[key] ?? '') !== baseline) commitField(key, splitLines(listsText[key] ?? ''))
            }}
            disabled={saving || fieldBusy === key}
          />
        </label>
      ))}
      {kind !== 'progression' && (
        <div className={css.editorRow}>
          <span className={css.editorLabel}>{t('assets.detail.relations')}</span>
          <div className={css.relationEditor}>
            {related.map((row, index) => (
              <div key={index} className={css.relationRow}>
                <input
                  className={css.input}
                  value={row.target}
                  list="studio-panel-relation-targets"
                  placeholder={t('assets.edit.relationTarget')}
                  onChange={event => {
                    const value = event.target.value
                    setRelated(previous => previous.map((item, at) => (at === index ? { ...item, target: value } : item)))
                  }}
                  disabled={saving}
                />
                <input
                  className={css.input}
                  value={row.note}
                  placeholder={t('assets.edit.relationNote')}
                  onChange={event => {
                    const value = event.target.value
                    setRelated(previous => previous.map((item, at) => (at === index ? { ...item, note: value } : item)))
                  }}
                  disabled={saving}
                />
                <button
                  type="button"
                  className={css.iconButton}
                  aria-label={t('assets.edit.removeRelation')}
                  onClick={() => { setRelated(previous => previous.filter((_, at) => at !== index)) }}
                  disabled={saving}
                >
                  ×
                </button>
              </div>
            ))}
            <div className={css.relationRow}>
              <input
                className={css.input}
                value={newTarget}
                list="studio-panel-relation-targets"
                placeholder={t('assets.edit.relationTarget')}
                onChange={event => { setNewTarget(event.target.value) }}
                disabled={saving}
              />
              <input
                className={css.input}
                value={newNote}
                placeholder={t('assets.edit.relationNote')}
                onChange={event => { setNewNote(event.target.value) }}
                disabled={saving}
              />
              <button
                type="button"
                className={css.button}
                disabled={saving || newTarget.trim() === ''}
                onClick={() => {
                  setRelated(previous => [...previous, { target: newTarget.trim(), kind: 'related', note: newNote.trim() }])
                  setNewTarget('')
                  setNewNote('')
                }}
              >
                {t('assets.edit.addRelation')}
              </button>
            </div>
            <datalist id="studio-panel-relation-targets">
              {candidates.map(candidate => (
                <option key={`${candidate.kind}:${candidate.id}`} value={candidate.id}>
                  {candidate.name !== '' ? `${candidate.name} (${candidate.id})` : candidate.id}
                </option>
              ))}
            </datalist>
            {source.derivedRelations.length > 0 && (
              <div className={css.derivedRelations}>
                <div className={css.derivedTitle}>{t('assets.edit.derivedRelations')}</div>
                {source.derivedRelations.map((relation, index) => (
                  <div key={`${relation.direction}:${relation.name}:${index}`} className={css.derivedRow}>
                    <span className={css.derivedArrow}>{relation.direction === 'incoming' ? '←' : '→'}</span>
                    <span className={css.derivedName}>{relation.name}</span>
                    {relation.note !== '' && <span className={css.derivedNote}>{relation.note}</span>}
                    <span className={css.derivedOrigin}>
                      {relation.direction === 'incoming'
                        ? t('assets.relation.incoming')
                        : t('assets.relation.registered')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      <div className={css.editorRow}>
        <span className={css.editorLabel}>{t('assets.edit.body')}</span>
        <div className={css.bodyEditor}>
          {/* The body edits in Vditor IR (实时渲染) — editing and rendered
              output are one pane, so there is no separate preview mode. The
              plain textarea is the load-failure fallback, with notice. */}
          {liveFailed && (
            <>
              <div className={css.detailNotice}>{t('assets.edit.liveFailed')}</div>
              <textarea
                aria-label={t('assets.edit.body')}
                className={css.textarea}
                rows={10}
                value={bodyDraft}
                onChange={event => { updateBody(event.target.value) }}
                disabled={saving}
              />
            </>
          )}
          {!liveFailed && (
            <VditorBody
              initial={bodyDraft}
              disabled={saving}
              flushOnLeave
              onChange={updateBody}
              onFailed={() => { setLiveFailed(true) }}
            />
          )}
        </div>
      </div>
      {conflict && (
        <div className={css.conflictNotice}>
          <span className={css.errorText}>{saveError ?? t('assets.edit.conflict')}</span>
          <button type="button" className={css.button} onClick={onRefresh} disabled={saving}>
            {t('assets.edit.conflictRefresh')}
          </button>
        </div>
      )}
      {!conflict && saveError !== null && <div className={css.errorText}>{saveError}</div>}
      <div className={css.editorActions}>
        <button type="button" className={css.primaryButton} onClick={save} disabled={saving || fieldBusy !== null || name.trim() === '' || (kind === 'progression' && !areStagesValid(stages))}>
          {saving ? t('assets.edit.saving') : t('assets.edit.save')}
        </button>
        <button type="button" className={css.button} onClick={onCancel} disabled={saving}>
          {t('assets.edit.cancel')}
        </button>
      </div>
    </div>
  )
}

interface NewAssetFormProps {
  generationApi?: GenerationApi
  existingIds?: readonly string[]
  kind: 'character' | 'world' | 'progression'
  busy: boolean
  error: string | null
  onSubmit: (payload: { id: string; data: Record<string, unknown> }) => void
  onCancel: () => void
  onDirtyChange?: (dirty: boolean) => void
  t: TFunc
}


/** Inline create form for one asset kind (minimal required fields per the server contract). */
export function NewAssetForm({ generationApi, existingIds = [], kind, busy, error, onSubmit, onCancel, onDirtyChange, t }: NewAssetFormProps) {
  const [generatedData, setGeneratedData] = useState<Record<string, string>>({})
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [summary, setSummary] = useState('')
  const [extra, setExtra] = useState('')
  const [stages, setStages] = useState<Stage[]>([{ id: 'stage_1', name: '' }])
  const dirty = Object.keys(generatedData).length > 0 || id !== '' || name !== '' || summary !== '' || extra !== '' || stages.length !== 1 || stages.some(stage => stage.id !== 'stage_1' || stage.name !== '' || stage.abilities?.some(Boolean) || stage.limitations?.some(Boolean) || stage.requirements?.some(Boolean))
  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  useEffect(() => () => { onDirtyChange?.(false) }, [onDirtyChange])

  const extraLabel = kind === 'character' ? t('assets.create.tier') : kind === 'world' ? t('assets.create.type') : ''
  const validId = validAssetId(id) && !existingIds.includes(id)
  const validStages = kind !== 'progression' || areStagesValid(stages)
  const canSubmit = validId && (kind !== 'progression' || name.trim() !== '') && validStages && !busy

  const submit = () => {
    if (!canSubmit) return
    const data: Record<string, unknown> = { ...generatedData, name: name.trim() || id }
    if (summary.trim() !== '') data['summary'] = summary.trim()
    if (kind === 'character' && extra.trim() !== '') data['tier'] = extra.trim()
    if (kind === 'world' && extra.trim() !== '') data['type'] = extra.trim()
    if (kind === 'progression') {
      data['kind'] = PROGRESSION_KINDS.includes(extra as (typeof PROGRESSION_KINDS)[number]) ? extra : 'ability'
      data['stages'] = stages
        .filter(stage => stage.id.trim() !== '' && stage.name.trim() !== '')
        .map(stage => ({ ...stage, id: stage.id.trim(), name: stage.name.trim() }))
    }
    onSubmit({ id: id.trim(), data })
  }

  return (
    <div className={css.editor}>
      {generationApi && <AssetAiGeneration kind={kind} api={generationApi} current={{ ...generatedData, name, summary, ...(kind === 'progression' ? { kind: extra || 'ability', stages } : kind === 'world' ? { type: extra } : { tier: extra }) }} busy={busy} onApply={draft => {
        if (typeof draft['name'] === 'string') setName(draft['name'])
        if (typeof draft['summary'] === 'string') setSummary(draft['summary'])
        if (Array.isArray(draft['stages'])) setStages(draft['stages'])
        const extraKey = kind === 'progression' ? 'kind' : kind === 'world' ? 'type' : 'tier'
        if (typeof draft[extraKey] === 'string') setExtra(draft[extraKey])
        setGeneratedData(previous => ({ ...previous, ...Object.fromEntries(Object.entries(draft).filter(([key, value]) => !['name', 'summary', 'stages', extraKey].includes(key) && typeof value === 'string')) as Record<string, string> }))
      }} t={t} />}
      {Object.entries(generatedData).map(([key, value]) => <label key={key} className={css.editorRow}><span className={css.editorLabel}>{fieldLabel(key, t)}</span><textarea className={css.textarea} value={value} disabled={busy} onChange={e => setGeneratedData(previous => ({ ...previous, [key]: e.target.value }))} /></label>)}
      <AssetGeneration kind={kind} progressionKind={extra || 'ability'} busy={busy} hasStages={stages.some(stage => stage.name !== '' || stage.abilities?.some(Boolean) || stage.limitations?.some(Boolean) || stage.requirements?.some(Boolean))} onName={setName} onStages={setStages} t={t} />
      <button type="button" className={css.button} disabled={busy} onClick={() => setId(generateId(kind, existingIds))}>{t('assets.generate.id')}</button>
      <label className={css.editorRow}>
        <span className={css.editorLabel}>ID</span>
        <input
          className={css.input}
          value={id}
          placeholder={t('assets.create.idHint')}
          onChange={event => { setId(event.target.value) }}
          disabled={busy}
          data-invalid={id !== '' && !validId}
        />
      </label>
      <label className={css.editorRow}>
        <span className={css.editorLabel}>{t('assets.edit.name')}</span>
        <input className={css.input} value={name} onChange={event => { setName(event.target.value) }} disabled={busy} />
      </label>
      <label className={css.editorRow}>
        <span className={css.editorLabel}>{t('assets.edit.summary')}</span>
        <textarea className={css.textarea} rows={2} value={summary} onChange={event => { setSummary(event.target.value) }} disabled={busy} />
      </label>
      {kind !== 'progression' && (
        <label className={css.editorRow}>
          <span className={css.editorLabel}>{extraLabel}</span>
          <input className={css.input} value={extra} onChange={event => { setExtra(event.target.value) }} disabled={busy} />
        </label>
      )}
      {kind === 'progression' && (
        <>
          <label className={css.editorRow}>
            <span className={css.editorLabel}>{t('assets.create.progressionKind')}</span>
            <select className={css.input} value={extra || 'ability'} onChange={event => { setExtra(event.target.value) }} disabled={busy}>
              {PROGRESSION_KINDS.map(value => <option key={value} value={value}>{t(`assets.progression.${value}`)}</option>)}
            </select>
          </label>
          <StageFields stages={stages} onChange={setStages} busy={busy} t={t} />
          {!validStages && <p className={css.errorText}>{t('assets.generate.invalid')}</p>}
        </>
      )}
      {id !== '' && !validId && <p className={css.errorText}>{t('assets.generate.invalid')}</p>}
      {error !== null && error !== '' && <div className={css.errorText}>{error}</div>}
      <div className={css.editorActions}>
        <button type="button" className={css.primaryButton} onClick={submit} disabled={!canSubmit}>
          {busy ? t('assets.edit.saving') : t('assets.create.submit')}
        </button>
        <button type="button" className={css.button} onClick={onCancel} disabled={busy}>
          {t('assets.edit.cancel')}
        </button>
      </div>
    </div>
  )
}
