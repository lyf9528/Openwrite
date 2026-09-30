export const PROGRESSION_KINDS = ['ability', 'rank', 'cultivation', 'career', 'reputation', 'curse', 'custom'] as const
export const GENRES = ['xianxia', 'fantasy', 'urban', 'scifi', 'wuxia'] as const
export type Genre = typeof GENRES[number]
export type AssetKind = 'character' | 'world' | 'progression'
export interface Stage {
  id: string
  name: string
  abilities?: string[]
  limitations?: string[]
  requirements?: string[]
  [key: string]: unknown
}
export const validAssetId = (id: string) => /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(id) && !id.includes('..')
export const validStages = (stages: Stage[]) => stages.length > 0 && stages.every(s => validAssetId(s.id.trim()) && s.name.trim() !== '') && new Set(stages.map(s => s.id.trim())).size === stages.length
export function generateId(kind: AssetKind, existing: readonly string[] = []): string {
  let id: string
  do { id = `${kind}_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}` } while (existing.includes(id))
  return id
}
function pick<T>(items: readonly T[]): T { return items[Math.floor(Math.random() * items.length)]! }
const themes = {
  xianxia: { roots: ['青霄', '玄月', '太虚', '九霄', '归元', '灵渊'], powers: ['御火', '御剑', '灵识', '符阵'], resource: '灵力', steps: ['感气', '聚元', '筑基', '凝丹', '化神', '合道'] },
  fantasy: { roots: ['星辉', '秘银', '暮光', '赤焰', '苍穹', '幽影'], powers: ['元素塑形', '契约召唤', '幻象', '结界'], resource: '魔力', steps: ['启蒙', '学徒', '术士', '导师', '贤者', '传奇'] },
  urban: { roots: ['极夜', '零点', '赤潮', '回声', '暗流', '白昼'], powers: ['电磁感应', '重力操控', '感官强化', '短距跃迁'], resource: '精神力', steps: ['潜能', '觉醒', '掌控', '突破', '领域', '超越'] },
  scifi: { roots: ['量子', '深空', '矩阵', '脉冲', '星环', '引力'], powers: ['无人机协同', '神经链接', '动力装甲', '引力调制'], resource: '能源', steps: ['接入', '适配', '强化', '协同', '聚变', '星际'] },
  wuxia: { roots: ['听雨', '沧浪', '孤峰', '流云', '断岳', '长风'], powers: ['剑术', '掌法', '轻功', '内功'], resource: '内力', steps: ['入门', '熟练', '登堂', '入室', '宗师', '化境'] },
} satisfies Record<Genre, { roots: string[]; powers: string[]; resource: string; steps: string[] }>
export interface Conditions { genre: Genre; surname: string; category: string; direction: string; count: number; progressionKind: string }
export function generateName(kind: AssetKind, c: Conditions): string {
  const theme = themes[c.genre]
  if (kind === 'character') {
    const givenNames = {
      xianxia: ['清尘', '云澜', '怀月', '知遥', '景玄', '昭宁', '明霄', '星微'],
      fantasy: ['星岚', '暮歌', '月曦', '银霜', '夜辰', '炎羽', '雪翎', '晨曦'],
      urban: ['子安', '嘉宁', '一凡', '思远', '雨桐', '明轩', '知夏', '可欣'],
      scifi: ['星航', '云枢', '明宇', '远舟', '天衡', '北辰', '思源', '景行'],
      wuxia: ['长风', '听雪', '无咎', '惊鸿', '一舟', '照川', '云归', '青锋'],
    }
    return (c.surname.trim() || pick(['林', '沈', '顾', '陆', '苏', '谢', '叶', '江', '萧', '秦'])) + pick(givenNames[c.genre])
  }
  if (kind === 'world') return pick(theme.roots) + ({ location: pick(['城', '谷', '港']), organization: pick(['盟', '会', '阁']), item: pick(['印', '戒', '刃']), rule: '法则' }[c.category] ?? '秘境')
  return pick(theme.roots) + (c.direction.trim() || pick(theme.powers)) + ({ career: '职业体系', rank: '等阶体系', reputation: '声望体系', curse: '诅咒体系', cultivation: '修炼体系' }[c.progressionKind] ?? '能力体系')
}
export function generateStages(c: Conditions): Stage[] {
  const theme = themes[c.genre]
  const power = c.direction.trim() || pick(theme.powers)
  const count = Math.max(1, Math.min(12, Math.floor(c.count) || 1))
  const effects = ['感知并识别目标', '稳定作用于单个目标', '连续施展并精确控制', '同时影响多个目标', '形成可持续的作用领域', '在领域内组合运用多种技巧']
  return Array.from({ length: count }, (_, i) => {
    const level = count === 1 ? 0 : Math.round(i * 5 / (count - 1))
    return {
      id: `stage_${i + 1}`,
      name: `${theme.steps[level]}·${i + 1}阶`,
      abilities: [`${power}：${effects[level]}；熟练度 ${i + 1}/${count}。`],
      limitations: [`消耗${theme.resource}；连续使用会引起${pick(['疲劳', '失控风险', '恢复期延长'])}，不得越过当前阶段的作用范围。`],
      requirements: [i === 0 ? `完成${power}基础训练与首次稳定施展。` : `熟练掌握${theme.steps[Math.round((i - 1) * 5 / Math.max(1, count - 1))]}阶段技巧，并完成第 ${i + 1} 阶考核。`],
    }
  })
}
