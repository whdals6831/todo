import { useEffect, useState } from 'react'

/** 지금 화면이 불러온 앱 파일. 빌드마다 이름이 바뀐다 (개발 서버에는 없다) */
const loaded = () => document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]')?.src ?? ''

/** 배포된 index.html 의 앱 파일이 지금 것과 다르면 새 버전이 나온 것 */
async function check() {
  const cur = loaded()
  if (!cur) return false
  try {
    const html = await (await fetch('/', { cache: 'no-store' })).text()
    const src = html.match(/<script[^>]+src="([^"]*\/assets\/[^"]+\.js)"/)?.[1]
    return !!src && new URL(src, location.href).href !== cur
  } catch {
    return false
  }
}

/** 새 버전이 배포됐는가. 화면으로 돌아올 때와 30분마다 확인한다 */
export function useNewVersion() {
  const [fresh, setFresh] = useState(false)
  useEffect(() => {
    const run = () => void check().then((v) => v && setFresh(true))
    const onVisible = () => document.visibilityState === 'visible' && run()
    document.addEventListener('visibilitychange', onVisible)
    const id = setInterval(run, 30 * 60 * 1000)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(id)
    }
  }, [])
  return fresh
}
