import { useRef, useState, type ChangeEvent } from 'react'

/** 입력 상태와 키워드 예시 선택을 함께 다루는 훅 */
export function useHintInput() {
  const ref = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState('')
  const [focused, setFocused] = useState(false)
  const pick = (text: string) => {
    setValue(text)
    requestAnimationFrame(() => {
      const el = ref.current
      if (!el) return
      el.focus()
      const i = text.indexOf('기관명')
      if (i >= 0) el.setSelectionRange(i, i + 3)
    })
  }
  return {
    ref, value, setValue, focused, pick,
    inputProps: {
      ref,
      value,
      onChange: (e: ChangeEvent<HTMLInputElement>) => setValue(e.target.value),
      onFocus: () => setFocused(true),
      /* 예시 칩을 누르는 사이 사라지지 않도록 잠깐 기다린다 */
      onBlur: () => setTimeout(() => setFocused(false), 150),
    },
  }
}
