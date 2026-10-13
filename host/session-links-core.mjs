import { normalizeLink, classifyLink, extractMarkdownLinks } from '../src/link-parser.mjs'
export { normalizeLink, classifyLink, extractMarkdownLinks }

export function linksFromMessages(messages, cwd = '') {
  const found = []
  for (const message of messages ?? []) {
    const body = message.body ?? message
    if (body.role !== 'assistant' || message.agentId || body.state === 'running') continue
    for (const block of body.blocks ?? []) {
      if (block.type !== 'text') continue
      for (const link of extractMarkdownLinks(block.text, cwd)) {
        found.push({ ...link, messageId: message.itemId ?? message.id,
          updatedAt: message.observedAt ?? message.timestamp ?? 0 })
      }
    }
  }
  return found
}

export function sessionStorageKey(session) {
  return `orca-session-links:v1:${encodeURIComponent(session.hostId)}:codex:${encodeURIComponent(session.id)}`
}

export function mergeLinks(previous, discovered) {
  const entries = new Map(previous.map(link => [link.key, link]))
  for (const link of discovered) {
    const existing = entries.get(link.key)
    if (existing && (existing.updatedAt ?? 0) > link.updatedAt) continue
    entries.set(link.key, { ...existing, ...link,
      pinned: existing?.pinned ?? false, hidden: existing?.hidden ?? false })
  }
  return [...entries.values()].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt).slice(0, 500)
}

export function loadLinks(storage, session) {
  try {
    const data = JSON.parse(storage.getItem(sessionStorageKey(session)) ?? '[]')
    if (!Array.isArray(data)) return []
    return data.flatMap(link => {
      if (!link || typeof link.title !== 'string') return []
      const normalized = normalizeLink(link.href, session.cwd)
      if (!normalized || normalized.key !== link.key) return []
      return [{ ...normalized, title: link.title.slice(0, 500), kind: classifyLink(link.title, normalized.href),
        pinned: link.pinned === true, hidden: link.hidden === true,
        messageId: typeof link.messageId === 'string' ? link.messageId : undefined,
        updatedAt: Number.isFinite(link.updatedAt) ? link.updatedAt : 0 }]
    }).slice(0, 500)
  } catch { return [] }
}

export function saveLinks(storage, session, links) {
  try { storage.setItem(sessionStorageKey(session), JSON.stringify(links.map(link => ({ ...link, href: link.target })))); return true }
  catch { return false }
}

export function resolveFocusedSession(state) {
  const worktreeId = state.activeWorktreeId
  if (!worktreeId) return null
  const groups = state.groupsByWorktree?.[worktreeId] ?? []
  const group = groups.find(g => g.id === state.activeGroupIdByWorktree?.[worktreeId]) ?? groups[0]
  const unified = (state.unifiedTabsByWorktree?.[worktreeId] ?? []).find(t => t.id === group?.activeTabId)
  const worktree = state.getKnownWorktreeById?.(worktreeId, state.activeWorkspaceExecutionHostId ?? undefined)
  const repo = state.repos?.find(r => r.id === worktree?.repoId)
  const defaultHost = state.activeWorkspaceExecutionHostId ?? worktree?.hostId ??
    (worktree?.runtimeOwnerEnvironmentId ? `runtime:${encodeURIComponent(worktree.runtimeOwnerEnvironmentId)}` : null) ??
    repo?.executionHostId ?? (repo?.connectionId ? `ssh:${encodeURIComponent(repo.connectionId)}` : 'local')
  const cwd = worktree?.path ?? worktree?.folderPath ?? ''
  if (unified?.contentType === 'agent-session') {
    if (unified.agentSessionAgent !== 'codex' || !unified.entityId) return null
    return { id: unified.entityId, hostId: unified.executionHostId ?? defaultHost,
      mode: 'structured', title: unified.customLabel ?? unified.generatedLabel ?? unified.label, cwd }
  }
  if (unified && unified.contentType !== 'terminal') return null
  if (group?.activeTabId && !unified) return null
  const tabId = unified?.entityId ?? (state.activeTabIdByWorktree ? state.activeTabIdByWorktree[worktreeId] : state.activeTabId)
  if (!tabId) return null
  const layout = state.terminalLayoutsByTabId?.[tabId]
  const leafId = layout?.activeLeafId
  const entries = Object.values(state.agentStatusByPaneKey ?? {}).filter(entry =>
    (entry.tabId === tabId || entry.paneKey?.startsWith(`${tabId}:`)) &&
    (!leafId || entry.paneKey === `${tabId}:${leafId}`))
  // 분할 터미널의 주인을 확정할 수 없을 때 다른 세션을 대신 표시하지 않는다.
  if (entries.length !== 1) return null
  const entry = entries[0]
  if (entry.agentType !== 'codex' || !entry.providerSession?.id) return null
  const hostId = entry.connectionId ? `ssh:${encodeURIComponent(entry.connectionId)}` : defaultHost
  const tab = (state.tabsByWorktree?.[worktreeId] ?? []).find(t => t.id === tabId)
  return { id: entry.providerSession.id, hostId: unified?.executionHostId ?? hostId, mode: 'terminal',
    transcriptPath: entry.providerSession.transcriptPath, cwd: tab?.startupCwd ?? cwd,
    title: unified?.customLabel ?? unified?.generatedLabel ?? tab?.customTitle ?? tab?.generatedTitle ?? tab?.title ?? entry.terminalTitle ?? '코덱스 세션' }
}
