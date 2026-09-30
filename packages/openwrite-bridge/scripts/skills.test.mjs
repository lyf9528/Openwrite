import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zipSync, unzipSync } from 'fflate'
import { listSkills, prepareSkill, skillAction } from '../lib/skills.js'
import { Context } from '@deepseek-ai/cordis'
import { NovelDomainService, API_PROXY_ROUTE } from '../lib/domain.js'

const text = '---\nname: test-writing\ndescription: Test writing rules\n---\n\nWrite vividly.\n'
const upload = (content = text) => ({ filename: 'SKILL.md', base64: Buffer.from(content).toString('base64') })
const zip = files => ({ filename: 'skill.zip', base64: Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([path, value]) => [path, Buffer.from(value)])))).toString('base64') })

test('converts plain Markdown and validates invocation metadata', () => {
  const converted = prepareSkill({ ...upload('写作时使用具体动作。'), name: 'my-rules', description: '写作规则' })
  assert.equal(converted.name, 'my-rules')
  assert.match(converted.content, /写作时使用具体动作/)
  assert.throws(() => prepareSkill(upload('plain text')), /填写/)
  assert.throws(() => prepareSkill(upload(text.replace('description:', 'user-invocable: maybe\ndescription:'))), /布尔/)
  assert.throws(() => prepareSkill(upload(text.replace('test-writing', '../escape'))), /名称/)
})

test('accepts one enclosing folder, rejects traversal and multiple skills', () => {
  assert.deepEqual(prepareSkill(zip({ 'rules/SKILL.md': text, 'rules/references/style.md': 'style' })).paths, ['SKILL.md', 'references/style.md'])
  assert.throws(() => prepareSkill(zip({ 'SKILL.md': text, '../escape': 'bad' })), /路径/)
  assert.throws(() => prepareSkill(zip({ 'first/SKILL.md': text, 'second/SKILL.md': text })), /单个|一个/)
  assert.throws(() => prepareSkill(zip({ 'SKILL.md': text, 'large.txt': 'x'.repeat(8 * 1024 * 1024) })), /超过/)
})

test('imports into dsh project discovery root and exports all resources losslessly', async () => {
  const root = await mkdtemp(join(tmpdir(), 'openwrite-skills-'))
  try {
    await mkdir(join(root, '.git'))
    await mkdir(join(root, 'novel'))
    const input = zip({ 'test-writing/SKILL.md': text, 'test-writing/references/style.md': '参考资料', 'test-writing/assets/image.bin': '\u0000\u0001\u0002' })
    const workspace = join(root, 'novel')
    await skillAction(workspace, 'preview', input)
    assert.equal((await listSkills(workspace)).items.filter(item => item.source === 'project').length, 0)
    await skillAction(workspace, 'import', input)
    assert.equal(await readFile(join(root, '.dsh/skills/test-writing/SKILL.md'), 'utf8'), text)
    await assert.rejects(skillAction(workspace, 'import', input), /同名/)
    const selector = { id: 'test-writing', source: 'project' }
    assert.equal((await skillAction(workspace, 'read', selector)).content, text)
    const output = await skillAction(workspace, 'export', selector)
    const files = unzipSync(Buffer.from(output.base64, 'base64'))
    assert.equal(Buffer.from(files['references/style.md']).toString(), '参考资料')
    assert.deepEqual([...files['assets/image.bin']], [0, 1, 2])
    await assert.rejects(skillAction(workspace, 'export', { id: '../outside', source: 'project' }), /路径|标识/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('refuses symlinked storage and exporting symlink resources', async () => {
  const root = await mkdtemp(join(tmpdir(), 'openwrite-skills-links-'))
  const outside = await mkdtemp(join(tmpdir(), 'openwrite-skills-outside-'))
  try {
    await mkdir(join(root, '.git'))
    await symlink(outside, join(root, '.dsh'), 'dir')
    await assert.rejects(skillAction(root, 'import', upload()), /符号链接/)
    await rm(join(root, '.dsh'))
    await skillAction(root, 'import', upload())
    await symlink(outside, join(root, '.dsh/skills/test-writing/outside'), 'dir')
    await assert.rejects(skillAction(root, 'export', { id: 'test-writing', source: 'project' }), /符号链接/)
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }) }
})

test('skill routes require host authentication and registered workspace, without a Python backend', async () => {
  const root = await mkdtemp(join(tmpdir(), 'openwrite-skills-route-'))
  const ctx = new Context()
  const routes = []
  ctx.provide('webServer', { register: route => { routes.push(route); return () => {} } })
  const service = new NovelDomainService(ctx, {
    baseUrl: 'http://127.0.0.1:1', timeoutMs: 100,
    resolveWorkspace: id => id === 'workspace' ? root : undefined,
    authorizeRequest: headers => headers?.authorization === 'test' ? undefined : 401,
  })
  service.registerWebRoutes(ctx)
  const route = routes.find(route => route.path === API_PROXY_ROUTE)
  async function request(path, method, headers, body) {
    let status
    let value
    await route.handler({ url: API_PROXY_ROUTE + path, method, headers,
      async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)) },
    }, { writeHead(code) { status = code }, end(bytes) { value = JSON.parse(String(bytes)) } })
    return { status, value }
  }
  try {
    await mkdir(join(root, '.git'))
    assert.equal((await request('/skills', 'GET', {})).status, 401)
    assert.equal((await request('/skills', 'GET', { authorization: 'test' })).status, 400)
    const headers = { authorization: 'test', 'x-dsh-workspace-id': 'workspace' }
    assert.equal((await request('/skills/import', 'POST', headers, upload())).status, 200)
    const list = await request('/skills', 'GET', headers)
    assert.equal(list.status, 200)
    assert.ok(list.value.items.some(item => item.name === 'test-writing' && item.source === 'project'))
    assert.equal((await request('/skills/import', 'POST', headers, upload())).status, 409)
    assert.equal((await request('/skills/import', 'DELETE', headers)).status, 405)
  } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
})
