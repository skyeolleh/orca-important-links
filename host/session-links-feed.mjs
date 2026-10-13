export function subscribeLinksFeed(api, session, onFrame, onError) {
  let stopped = false, cleanup = null
  const safe = frame => { if (!stopped) onFrame(frame) }
  const fail = error => { if (!stopped) onError(error instanceof Error ? error.message : String(error)) }
  const own = handle => {
    const dispose = typeof handle === 'function' ? handle : () => handle?.unsubscribe?.()
    if (stopped) dispose(); else cleanup = dispose
  }
  const args = { subscriptionId: `session-links-${crypto.randomUUID()}`, agent: 'codex',
    sessionId: session.id, transcriptPath: session.transcriptPath, limit: 300 }
  try {
    if (session.hostId.startsWith('ssh:')) throw new Error('이 SSH 세션의 기록 연결은 지원하지 않습니다. 로컬 기록으로 대신 수집하지 않습니다.')
    if (session.mode === 'terminal' && !session.hostId.startsWith('runtime:')) {
      own(api.nativeChat.subscribe(args, safe))
    } else {
      const structured = session.mode === 'structured'
      const method = structured ? 'agentSession.subscribe' : 'nativeChat.subscribe'
      const params = structured ? { sessionId: session.id } : args
      const callback = response => {
        if (response.ok === false) { fail(response.error?.message ?? '대화 기록 연결에 실패했습니다.'); return }
        const frame = response.result
        if (!frame || typeof frame !== 'object') return
        if (frame.type === 'end') { fail('기록 구독이 종료됐습니다. 새로고침해 다시 연결하세요.'); return }
        if (!structured) { safe(frame); return }
        if (frame.page) safe({ type: frame.type === 'reset' ? 'reset' : 'snapshot',
          messages: frame.page.items ?? [], hasMore: frame.page.hasOlder })
        else if (frame.batch) safe({ type: 'appended', messages: frame.batch.items ?? [],
          removedIds: frame.batch.removedItemIds ?? [] })
      }
      if (session.hostId.startsWith('runtime:')) {
        Promise.resolve(api.runtimeEnvironments.subscribe({
          selector: decodeURIComponent(session.hostId.slice(8)), method, params, timeoutMs: 15000
        }, { onResponse: callback, onError: error => fail(error.message),
          onClose: () => fail('연결이 끊겼습니다. 새로고침해 다시 연결하세요.') })).then(own, fail)
      } else {
        Promise.resolve(api.runtime.subscribe({ method, params }, callback)).then(own, fail)
      }
    }
  } catch (error) { fail(error) }
  return () => { stopped = true; cleanup?.(); cleanup = null }
}

export async function openSessionLink(api, link, session) {
  if (link.type === 'web') return api.shell.openUrl(link.target)
  if (!/\.(?:html?|md|txt|json|pdf|csv|tsv|xlsx?|docx?|pptx?|png|jpe?g|gif|webp|svg|mp4|webm|mov|mkv|wav|mp3|ogg)(?:$|[?#])/i.test(link.target)) {
    throw new Error('이 파일은 바로 열기를 지원하지 않습니다. 프리뷰·문서·미디어 파일을 등록하세요.')
  }
  return api.shell.openPath(link.target, session.hostId)
}
