let state = { session: null, links: [], bookmarks: [], error: '', connected: false }
let nonce = '', sequence = 0
const requests = new Map()
function request(action, params = {}) {
  if (action !== 'hello' && !state.connected) return Promise.reject(new Error('Orca 연결 코드가 필요합니다. 메뉴의 사용 안내를 확인하세요.'))
  return new Promise((resolve, reject) => {
    const requestId = String(++sequence)
    const timer = setTimeout(() => { requests.delete(requestId); reject(new Error('Orca 응답이 없습니다. 연결 상태를 확인하세요.')) }, 10000)
    requests.set(requestId, { resolve, reject, timer })
    parent.postMessage({ type: 'session-links:request', requestId, action, nonce, params }, '*')
  })
}
window.addEventListener('message', event => {
  if (event.source !== parent || !event.data) return
  const data = event.data
  if (data.type === 'session-links:snapshot' && data.version === 4 && typeof data.nonce === 'string' && Array.isArray(data.links) && Array.isArray(data.bookmarks)) {
    nonce = data.nonce
    state = { ...data, connected: true }
    render()
  } else if (data.type === 'session-links:result') {
    const pending = requests.get(data.requestId)
    if (!pending) return
    clearTimeout(pending.timer); requests.delete(data.requestId)
    data.ok ? pending.resolve(data.value) : pending.reject(new Error(data.error || '요청을 처리하지 못했습니다.'))
  }
})
const greet = () => { if (!state.connected) void request('hello').catch(() => {}) }
const greetingTimer = setInterval(greet, 5000)
window.addEventListener('pagehide', () => {
  clearInterval(greetingTimer)
  for (const pending of requests.values()) { clearTimeout(pending.timer); pending.reject(new Error('패널이 닫혔습니다.')) }
  requests.clear()
}, { once: true })
