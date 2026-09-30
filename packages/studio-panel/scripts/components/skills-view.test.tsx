import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SkillsView } from '../../src/client/SkillsView.tsx'

const preview = { name: 'writing-rules', description: '写作规则', content: '具体动作优先', paths: ['SKILL.md'] }
const item = { id: 'writing-rules', source: 'project', name: preview.name, description: preview.description }
const listing = { items: [item], warnings: [], directory: '/project/.dsh/skills' }

describe('Skill management', () => {
  it('previews local Markdown before explicit import and refreshes the list', async () => {
    const fetchStudioApi = vi.fn(async () => listing)
    const postStudioApi = vi.fn(async (_path: string, _body: unknown) => preview)
    render(<SkillsView fetchStudioApi={fetchStudioApi} postStudioApi={postStudioApi} />)
    await screen.findByText('writing-rules')
    const file = new File(['具体动作优先'], 'rules.md', { type: 'text/markdown' })
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode('具体动作优先').buffer })
    fireEvent.change(screen.getByLabelText('技能文件'), { target: { files: [file] } })
    fireEvent.change(screen.getByLabelText('技能名称'), { target: { value: 'writing-rules' } })
    fireEvent.change(screen.getByLabelText('用途说明'), { target: { value: '写作规则' } })
    fireEvent.click(screen.getByRole('button', { name: '预览导入' }))
    await screen.findByRole('button', { name: '确认导入' })
    expect(postStudioApi).toHaveBeenCalledTimes(1)
    expect(postStudioApi.mock.calls[0]?.[0]).toBe('/skills/preview')
    fireEvent.click(screen.getByRole('button', { name: '确认导入' }))
    await screen.findByRole('status')
    expect(postStudioApi.mock.calls[1]?.[0]).toBe('/skills/import')
    expect(fetchStudioApi).toHaveBeenCalledTimes(2)
  })

  it('shows API failures without claiming success', async () => {
    const postStudioApi = vi.fn(async () => { throw new Error('已有同名技能') })
    render(<SkillsView fetchStudioApi={async () => listing} postStudioApi={postStudioApi} />)
    fireEvent.click(await screen.findByRole('button', { name: /writing-rules/ }))
    expect((await screen.findByRole('alert')).textContent).toContain('已有同名技能')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('downloads an installed skill as ZIP', async () => {
    const create = vi.fn(() => 'blob:skill')
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const postStudioApi = vi.fn(async (path: string) => path.endsWith('read') ? preview : { filename: 'writing-rules.zip', base64: btoa('zip') })
    render(<SkillsView fetchStudioApi={async () => listing} postStudioApi={postStudioApi} />)
    fireEvent.click(await screen.findByRole('button', { name: /writing-rules/ }))
    fireEvent.click(await screen.findByRole('button', { name: '导出 ZIP 到电脑' }))
    await waitFor(() => expect(click).toHaveBeenCalled())
    expect(postStudioApi).toHaveBeenLastCalledWith('/skills/export', { id: item.id, source: item.source })
    click.mockRestore()
  })
})
