import { fieldBlock } from '../../core/domain/requirement-fields.mjs'
import { handoffSections, renderPack } from './domain.mjs'

export function buildPack({ store, budget = 'standard', reqSlug = null }) {
  if (reqSlug !== null && (typeof reqSlug !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(reqSlug))) {
    throw new Error('REQ slug는 소문자·숫자·하이픈만 허용한다')
  }
  const handoff = handoffSections(store.readHandoff())
  const decisions = store.readDecisions()
  const readReq = (slug) => {
    const text = store.readRequirement(slug)
    const lines = text.split('\n').filter((line) => line.trim() && !line.trimStart().startsWith('#'))
    if ((lines.length && !/^[a-z_][a-z0-9_]*:/.test(lines[0])) || lines.some((line) => !/^\s|^[a-z_][a-z0-9_]*:/.test(line))) {
      throw new Error('REQ: 템플릿의 plain mapping key가 필요하다')
    }
    const reqId = fieldBlock(text, ['metadata', 'req_id']).match(/^  req_id: (["']?)([a-z0-9][a-z0-9-]*)\1\s*(?:#.*)?$/)?.[2]
    if (reqId !== slug) throw new Error(`REQ ${slug}: metadata.req_id는 파일명 slug와 같아야 한다`)
    const status = fieldBlock(text, ['metadata', 'status']).match(/^  status: (["']?)(needs_intake|needs_clarification|ready_for_routing|verified)\1\s*(?:#.*)?$/)?.[2]
    if (!status) throw new Error(`REQ ${slug}: metadata.status에 알려진 네 가지 상태 중 하나가 필요하다`)
    return { text, status }
  }
  let requirement = ''
  if (reqSlug !== null) {
    if (!store.hasRequirement(reqSlug)) throw new Error(`REQ ${reqSlug}: 파일이 없다`)
    requirement = readReq(reqSlug).text
  } else {
    const active = store.listRequirements().map(readReq).filter(({ status }) => status !== 'verified')
    if (active.length > 1) throw new Error('활성 REQ가 여러 개다. --req <slug>로 선택한다')
    requirement = active[0]?.text ?? ''
  }
  return renderPack({ requirement, handoff, decisions, budget })
}
