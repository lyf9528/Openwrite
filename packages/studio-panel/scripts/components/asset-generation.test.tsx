import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NewAssetForm, AssetEditor } from '../../src/client/AssetEditor.tsx'
import { generateId, generateStages, validAssetId, validStages, GENRES, type Conditions } from '../../src/client/asset-generation.ts'
vi.mock('../../src/client/VditorBody.tsx', () => ({ VditorBody: () => null }))
const t = ((key: string) => key) as never
const base: Conditions = { genre: 'xianxia', surname: '', category: 'location', direction: '御火', count: 4, progressionKind: 'ability' }

describe('local asset generation', () => {
  it('creates legal identifiers and avoids known IDs', () => {
    const ids = Array.from({ length: 100 }, () => generateId('character'))
    expect(ids.every(validAssetId)).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
    const uuid = vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce('11111111-1111-4111-8111-111111111111').mockReturnValueOnce('22222222-2222-4222-8222-222222222222')
    expect(generateId('world', ['world_1111111111114111'])).toBe('world_2222222222224222')
    uuid.mockRestore()
  })
  it('generates complete valid stages for every genre and rejects duplicate or malformed IDs', () => {
    for (const genre of GENRES) {
      const stages = generateStages({ ...base, genre })
      expect(stages).toHaveLength(4)
      expect(validStages(stages)).toBe(true)
      expect(stages.every(s => s.abilities?.[0]?.includes('御火') && s.limitations?.length && s.requirements?.length)).toBe(true)
    }
    expect(validStages([{ id: 'bad..id', name: 'A' }])).toBe(false)
    expect(validStages([{ id: 'a', name: 'A' }, { id: ' a ', name: 'B' }])).toBe(false)
    expect(validStages([{ id: 'a', name: '' }])).toBe(false)
  })
  it('previews, adopts and submits abilities without saving during generation', () => {
    const onSubmit = vi.fn()
    render(<NewAssetForm kind="progression" busy={false} error={null} onSubmit={onSubmit} onCancel={() => {}} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: 'assets.generate.id' }))
    fireEvent.change(screen.getByLabelText('assets.edit.name'), { target: { value: '御火体系' } })
    fireEvent.change(screen.getByLabelText('assets.generate.direction'), { target: { value: '御火' } })
    fireEvent.change(screen.getByLabelText('assets.generate.count'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('assets.create.progressionKind'), { target: { value: 'cultivation' } })
    fireEvent.click(screen.getByRole('button', { name: 'assets.generate.stages' }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getAllByLabelText('assets.create.stageName')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'assets.generate.apply' }))
    expect(screen.getAllByLabelText('assets.create.stageName')).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: 'assets.create.submit' }))
    const payload = onSubmit.mock.calls[0]![0]
    expect(payload.data.kind).toBe('cultivation')
    expect(payload.data.stages).toHaveLength(3)
    expect(payload.data.stages[0].abilities[0]).toContain('御火')
    expect(payload.data.stages[0].requirements.length).toBeGreaterThan(0)
  })
  it('protects filled stages and blocks duplicate asset IDs', () => {
    render(<NewAssetForm kind="progression" existingIds={['taken']} busy={false} error={null} onSubmit={vi.fn()} onCancel={() => {}} t={t} />)
    fireEvent.change(screen.getByLabelText('ID'), { target: { value: 'taken' } })
    fireEvent.change(screen.getByLabelText('assets.edit.name'), { target: { value: '已有体系' } })
    fireEvent.change(screen.getByLabelText('assets.create.stageName'), { target: { value: '已有阶段' } })
    expect((screen.getByRole('button', { name: 'assets.create.submit' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'assets.generate.stages' }))
    expect((screen.getByRole('button', { name: 'assets.generate.apply' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText('assets.create.stageName') as HTMLInputElement).value).toBe('已有阶段')
    fireEvent.click(screen.getByLabelText('assets.generate.overwrite'))
    fireEvent.click(screen.getByRole('button', { name: 'assets.generate.apply' }))
    expect(screen.getAllByLabelText('assets.create.stageName')).toHaveLength(6)
  })
  it('uses surname conditions and does not replace a name until a candidate is selected', () => {
    render(<NewAssetForm kind="character" busy={false} error={null} onSubmit={vi.fn()} onCancel={() => {}} t={t} />)
    fireEvent.change(screen.getByLabelText('assets.edit.name'), { target: { value: '原名' } })
    fireEvent.change(screen.getByLabelText('assets.generate.surname'), { target: { value: '欧阳' } })
    fireEvent.click(screen.getByRole('button', { name: 'assets.generate.names' }))
    expect((screen.getByLabelText('assets.edit.name') as HTMLInputElement).value).toBe('原名')
    const candidate = screen.getAllByRole('button', { name: /^欧阳/ })[0]!
    fireEvent.click(candidate)
    expect((screen.getByLabelText('assets.edit.name') as HTMLInputElement).value).toBe(candidate.textContent)
  })
  it('edits saved stages while preserving unknown stage metadata and English enum values', () => {
    const onSave = vi.fn()
    const onFieldSave = vi.fn()
    render(<AssetEditor kind="progression" source={{ name: '体系', summary: '', aliases: [], tags: [], scalars: [{ key: 'kind', value: 'ability' }], lists: [], related: [], derivedRelations: [], body: '', stages: [{ id: 'first', name: '初阶', abilities: ['感知'], custom_cost: 3 }] }} candidates={[]} saving={false} saveError={null} conflict={false} onSave={onSave} onFieldSave={onFieldSave} fieldBusy={null} onCancel={() => {}} onRefresh={() => {}} t={t} />)
    fireEvent.change(screen.getByLabelText('assets.stage.abilities'), { target: { value: '感知\n御火' } })
    fireEvent.change(screen.getByLabelText('assets.field.kind'), { target: { value: 'curse' } })
    expect(onFieldSave).toHaveBeenCalledWith('kind', 'curse')
    fireEvent.click(screen.getByRole('button', { name: 'assets.edit.save' }))
    expect(onSave.mock.calls[0]![0].stages[0]).toEqual({ id: 'first', name: '初阶', abilities: ['感知', '御火'], custom_cost: 3 })
  })
})
