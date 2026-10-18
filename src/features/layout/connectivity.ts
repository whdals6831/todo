import { flushWrites, resync } from '@/store/actions.ts'
import { getState } from '@/store/store.ts'

/**
 * 네트워크가 돌아오면 쌓인 쓰기를 보내고 놓친 변경을 맞춘다.
 * 아직 서버에 쓰지 못한 변경이 있으면 창을 닫기 전에 묻는다.
 */
export function watchConnectivity() {
  const online = () => {
    void flushWrites().then(resync)
  }
  const beforeUnload = (e: BeforeUnloadEvent) => {
    if (!getState().sync.pending) return
    void flushWrites()
    e.preventDefault()
  }
  window.addEventListener('online', online)
  window.addEventListener('beforeunload', beforeUnload)
  return () => {
    window.removeEventListener('online', online)
    window.removeEventListener('beforeunload', beforeUnload)
  }
}
