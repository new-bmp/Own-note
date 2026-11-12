interface CloseRequest {
  type: 'own:prepare-close'
  requestId: string
  discardDraft: boolean
}
type DesktopRequest = CloseRequest | { type: 'own:asset-open-result' | 'own:presentation-result'; requestId: string; status: string; error?: string }

interface NativeWebView {
  addEventListener(type: 'message', listener: (event: MessageEvent<DesktopRequest>) => void): void
  removeEventListener(type: 'message', listener: (event: MessageEvent<DesktopRequest>) => void): void
  postMessage(value: { type: string; requestId: string; status?: string; assetId?: string; filename?: string; enabled?: boolean }): void
}

export async function setPresentationFullscreen(enabled: boolean): Promise<void> {
  const bridge = window.ownDesktop && window.chrome?.webview
  if (!bridge) {
    if (enabled && !document.fullscreenElement) await document.documentElement.requestFullscreen()
    else if (!enabled && document.fullscreenElement) await document.exitFullscreen()
    return
  }
  const requestId = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); bridge.removeEventListener('message', listener) }
    const listener = (event: MessageEvent<DesktopRequest>) => {
      if (event.data?.type !== 'own:presentation-result' || event.data.requestId !== requestId) return
      cleanup()
      if (event.data.status === 'ok') resolve()
      else reject(new Error(event.data.error || '无法切换全屏。'))
    }
    const timer = setTimeout(() => { cleanup(); reject(new Error('客户端未响应全屏请求，请升级 Own 后重试。')) }, 5000)
    bridge.addEventListener('message', listener)
    bridge.postMessage({ type: 'own:presentation', requestId, enabled })
  })
}

export function openNativeAsset(assetId: string, filename: string): Promise<void> {
  const bridge = window.ownDesktop && window.chrome?.webview
  if (!bridge) return Promise.reject(new Error('请在 Own 客户端中使用系统应用打开文件。'))
  const requestId = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); bridge.removeEventListener('message', listener) }
    const listener = (event: MessageEvent<DesktopRequest>) => {
      if (event.data?.type !== 'own:asset-open-result' || event.data.requestId !== requestId) return
      cleanup()
      if (event.data.status === 'opened') resolve()
      else reject(new Error(event.data.error || '无法打开，请另存为后重试。'))
    }
    const timer = setTimeout(() => { cleanup(); reject(new Error('系统应用未能打开，请重试或另存为。')) }, 30000)
    bridge.addEventListener('message', listener)
    bridge.postMessage({ type: 'own:open-asset', requestId, assetId, filename })
  })
}

declare global {
  interface Window {
    ownDesktop?: { platform: 'windows'; version: 1 }
    chrome?: { webview?: NativeWebView }
  }
}

export function onDesktopClose(prepare: (discardDraft: boolean) => Promise<'saved' | 'draft'>) {
  const bridge = window.ownDesktop && window.chrome?.webview
  if (!bridge) return () => {}
  const listener = async (event: MessageEvent<DesktopRequest>) => {
    const request = event.data
    if (request?.type !== 'own:prepare-close' || typeof request.requestId !== 'string') return
    let status: string
    try { status = await prepare(request.discardDraft) }
    catch { status = 'error' }
    bridge.postMessage({ type: 'own:close-result', requestId: request.requestId, status })
  }
  bridge.addEventListener('message', listener)
  bridge.postMessage({ type: 'own:frontend-ready', requestId: '', status: 'ready' })
  return () => bridge.removeEventListener('message', listener)
}
