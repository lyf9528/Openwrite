import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AssetAiGeneration } from '../../src/client/AssetAiGeneration.tsx'
import { NewAssetForm } from '../../src/client/AssetEditor.tsx'
vi.mock('../../src/client/VditorBody.tsx', () => ({ VditorBody: () => null }))
const t = ((key: string) => key) as never
const profiles = { data: { profiles: [{ id: 'writer', label: '写作模型', model: 'model-x', configured: true, capabilities: { chat: true } }] } }
const response = { data: { draft: { name: '新名字', summary: '新简介', personality: '谨慎' }, model: { label: '写作模型', model: 'model-x' } } }
function api(result: unknown = response) { return { fetchStudioApi: vi.fn(async () => profiles), postStudioApi: vi.fn(async () => result) } }
async function open() { fireEvent.click(screen.getByRole('button', { name: 'assets.ai.title' })); await screen.findByRole('option', { name: '写作模型 · model-x' }) }

describe('AI asset drafts', () => {
  it('uses configured model and conditions, protects existing fields and only applies selected data', async () => {
    const service = api(), onApply = vi.fn()
    render(<AssetAiGeneration kind="character" api={service} current={{ name: '原名', summary: '' }} busy={false} onApply={onApply} t={t} />)
    expect(service.fetchStudioApi).not.toHaveBeenCalled()
    await open()
    fireEvent.change(screen.getByLabelText('assets.ai.model'), { target: { value: 'writer' } })
    fireEvent.change(screen.getByLabelText('assets.ai.instructions'), { target: { value: '都市侦探' } })
    fireEvent.click(screen.getByRole('button', { name: 'assets.ai.generate' }))
    await screen.findByText('新简介')
    expect(service.postStudioApi).toHaveBeenCalledWith('/assets/generate', expect.objectContaining({ profile_id: 'writer', kind: 'character', instructions: '都市侦探', include_context: true }))
    expect(onApply).not.toHaveBeenCalled()
    expect((screen.getByLabelText('assets.edit.name') as HTMLInputElement).checked).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'assets.ai.apply' }))
    expect(onApply).toHaveBeenCalledWith({ summary: '新简介', personality: '谨慎' })
  })
  it('exposes failure and allows retry, and does not apply malformed replies', async () => {
    const service = api({ data: { draft: { name: 'missing summary' } } }), onApply = vi.fn()
    render(<AssetAiGeneration kind="world" api={service} current={{}} busy={false} onApply={onApply} t={t} />)
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'assets.ai.generate' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'assets.ai.invalid')
    expect(onApply).not.toHaveBeenCalled()
    expect((screen.getByRole('button', { name: 'assets.ai.generate' }) as HTMLButtonElement).disabled).toBe(false)
  })
  it('prevents duplicate requests and protects edits made while the model is running', async () => {
    let finish!: (value: unknown) => void
    const service = { fetchStudioApi: vi.fn(async () => profiles), postStudioApi: vi.fn(() => new Promise(resolve => { finish = resolve })) }
    const props = { kind: 'character' as const, api: service, current: {}, busy: false, onApply: vi.fn(), t }
    const view = render(<AssetAiGeneration {...props} />)
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'assets.ai.generate' }))
    fireEvent.click(screen.getByRole('button', { name: 'assets.ai.generate' }))
    expect(service.postStudioApi).toHaveBeenCalledTimes(1)
    view.rerender(<AssetAiGeneration {...props} current={{ name: '刚写的名字', summary: '刚写的简介' }} />)
    finish(response)
    await screen.findByText('新简介')
    expect((screen.getByLabelText('assets.edit.name') as HTMLInputElement).checked).toBe(false)
    expect((screen.getByLabelText('assets.edit.summary') as HTMLInputElement).checked).toBe(false)
  })
  it('fills the creation form without saving, and includes editable generated fields in Create', async () => {
    const service = api(), onSubmit = vi.fn()
    render(<NewAssetForm kind="character" generationApi={service} busy={false} error={null} onSubmit={onSubmit} onCancel={() => {}} t={t} />)
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'assets.ai.generate' }))
    await screen.findByText('新简介')
    fireEvent.click(screen.getByRole('button', { name: 'assets.ai.apply' }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect((screen.getByLabelText('assets.edit.name') as HTMLInputElement).value).toBe('新名字')
    fireEvent.change(screen.getByLabelText('assets.field.personality'), { target: { value: '沉着' } })
    fireEvent.click(screen.getByRole('button', { name: 'assets.generate.id' }))
    fireEvent.click(screen.getByRole('button', { name: 'assets.create.submit' }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ name: '新名字', summary: '新简介', personality: '沉着' }) }))
  })
  it('disables generation when no model is configured', async () => {
    const service = api(); service.fetchStudioApi.mockResolvedValue({ data: { profiles: [] } })
    render(<AssetAiGeneration kind="world" api={service} current={{}} busy={false} onApply={vi.fn()} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: 'assets.ai.title' }))
    await waitFor(() => expect(screen.getByText('assets.ai.noModel')).toBeTruthy())
    expect((screen.getByRole('button', { name: 'assets.ai.generate' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
