import { useEffect, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { GENRES, generateName, generateStages, type AssetKind, type Conditions, type Genre, type Stage } from './asset-generation.ts'
import css from './views.module.css'
type T = PropsLocale<'studio-panel'>['t']

// Preserve imported structured values until the user explicitly edits this field.
function stageText(value: unknown): string {
  const text = (item: unknown) => typeof item === 'string' ? item : JSON.stringify(item) ?? ''
  return Array.isArray(value) ? value.map(text).join('\n') : value == null ? '' : text(value)
}

export function StageFields({ stages, onChange, busy, t }: { stages: Stage[]; onChange: (stages: Stage[]) => void; busy: boolean; t: T }) {
  const update = (index: number, patch: Partial<Stage>) => onChange(stages.map((stage, at) => at === index ? { ...stage, ...patch } : stage))
  return <div className={css.relationEditor}>{stages.map((stage, index) => <fieldset key={index} className={css.stageCard} disabled={busy}>
    <legend>{t('assets.create.stages')} {index + 1}</legend>
    <label className={css.editorRow}><span className={css.editorLabel}>{t('assets.create.stageId')}</span><input className={css.input} value={stage.id} onChange={e => update(index, { id: e.target.value })} /></label>
    <label className={css.editorRow}><span className={css.editorLabel}>{t('assets.create.stageName')}</span><input className={css.input} value={stage.name} onChange={e => update(index, { name: e.target.value })} /></label>
    {(['abilities', 'limitations', 'requirements'] as const).map(field => <label className={css.editorRow} key={field}>
      <span className={css.editorLabel}>{t(`assets.stage.${field}`)}</span><textarea className={css.textarea} rows={2} value={stageText(stage[field])} onChange={e => update(index, { [field]: e.target.value.split('\n') })} />
    </label>)}
    <button type="button" className={css.button} disabled={stages.length <= 1} onClick={() => onChange(stages.filter((_, at) => at !== index))}>{t('assets.stage.remove')}</button>
  </fieldset>)}
    <button type="button" className={css.button} disabled={busy} onClick={() => {
      let next = stages.length + 1
      while (stages.some(s => s.id === `stage_${next}`)) next++
      onChange([...stages, { id: `stage_${next}`, name: '' }])
    }}>{t('assets.create.addStage')}</button>
  </div>
}

export function AssetGeneration({ kind, progressionKind, busy, hasStages, onName, onStages, t }: {
  kind: AssetKind; progressionKind: string; busy: boolean; hasStages: boolean; onName: (name: string) => void; onStages: (stages: Stage[]) => void; t: T
}) {
  const [genre, setGenre] = useState<Genre>('xianxia')
  const [surname, setSurname] = useState('')
  const [category, setCategory] = useState('location')
  const [direction, setDirection] = useState('')
  const [count, setCount] = useState(6)
  const [names, setNames] = useState<string[]>([])
  const [preview, setPreview] = useState<Stage[]>([])
  const [overwrite, setOverwrite] = useState(false)
  useEffect(() => { setNames([]); setPreview([]); setOverwrite(false) }, [progressionKind])
  const conditions: Conditions = { genre, surname, category, direction, count, progressionKind }
  const clear = () => { setNames([]); setPreview([]); setOverwrite(false) }
  return <fieldset className={css.stageCard} disabled={busy}>
    <legend>{t('assets.generate.title')}</legend>
    <p className={css.detailNotice}>{t('assets.generate.hint')}</p>
    <label className={css.editorRow}><span className={css.editorLabel}>{t('assets.generate.genre')}</span><select className={css.input} value={genre} onChange={e => { setGenre(e.target.value as Genre); clear() }}>{GENRES.map(g => <option key={g} value={g}>{t(`assets.genre.${g}`)}</option>)}</select></label>
    {kind === 'character' && <label className={css.editorRow}><span className={css.editorLabel}>{t('assets.generate.surname')}</span><input className={css.input} value={surname} maxLength={8} onChange={e => { setSurname(e.target.value); clear() }} /></label>}
    {kind === 'world' && <label className={css.editorRow}><span className={css.editorLabel}>{t('assets.generate.category')}</span><select className={css.input} value={category} onChange={e => { setCategory(e.target.value); clear() }}>{(['location', 'organization', 'item', 'rule'] as const).map(c => <option key={c} value={c}>{t(`assets.category.${c}`)}</option>)}</select></label>}
    {kind === 'progression' && <>
      <label className={css.editorRow}><span className={css.editorLabel}>{t('assets.generate.direction')}</span><input className={css.input} value={direction} maxLength={80} onChange={e => { setDirection(e.target.value); clear() }} /></label>
      <label className={css.editorRow}><span className={css.editorLabel}>{t('assets.generate.count')}</span><input className={css.input} type="number" min={1} max={12} value={count} onChange={e => { setCount(Number(e.target.value)); clear() }} /></label>
    </>}
    <button type="button" className={css.button} onClick={() => setNames([...new Set(Array.from({ length: 5 }, () => generateName(kind, conditions)))])}>{t('assets.generate.names')}</button>
    <div className={css.generationActions}>{names.map(name => <button type="button" className={css.button} key={name} onClick={() => onName(name)}>{name}</button>)}</div>
    {kind === 'progression' && <>
      <button type="button" className={css.button} disabled={!Number.isInteger(count) || count < 1 || count > 12} onClick={() => { setPreview(generateStages(conditions)); setOverwrite(false) }}>{t('assets.generate.stages')}</button>
      {preview.length > 0 && <div>
        {preview.map(stage => <div key={stage.id} className={css.stageCard}><strong>{stage.name}</strong><p>{stage.abilities?.join('\n')}</p><p>{stage.limitations?.join('\n')}</p><p>{stage.requirements?.join('\n')}</p></div>)}
        {hasStages && <label><input type="checkbox" checked={overwrite} onChange={e => setOverwrite(e.target.checked)} />{t('assets.generate.overwrite')}</label>}
        <button type="button" className={css.button} disabled={hasStages && !overwrite} onClick={() => { onStages(preview); setPreview([]); setOverwrite(false) }}>{t('assets.generate.apply')}</button>
      </div>}
    </>}
  </fieldset>
}
