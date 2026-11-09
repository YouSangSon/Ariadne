import { renderGraph, renderPromotion } from './domain.mjs'

export function promote(store, project, date) {
  const page = renderPromotion(store.readRecords(), project, date)
  const changed = store.readPage(page.title) !== page.text
  if (changed) {
    store.writePage(page.title, page.text)
    if (!store.readLog().includes(page.logLine.trim())) store.appendLog(page.logLine)
  }
  return { changed: Number(changed), page: store.pagePath(page.title) }
}

export function indexWiki(store, project, date) {
  const graph = renderGraph(store.readGraph(), project, date)
  store.writeGraph(graph.indexName, graph.text)
  return { entities: graph.entities, relations: graph.relations, unresolved: graph.unresolved }
}
