import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { Button } from '@/components/ui/Button.tsx'
import { Textarea } from '@/components/ui/Field.tsx'
import { cx } from '@/lib/cx.ts'
import { setUi } from '@/store/ui.ts'
import { newChat, send, useChat } from './chat.ts'
import { IMAGE_TYPES, MAX_IMAGES, toPendingImage, type PendingImage } from './images.ts'
import s from './Chat.module.css'

const SUGGEST = ['이번 주 할 일 우선순위 정리해줘', '지연된 거 있어?', '다음 주 외근 기준으로 준비할 일 알려줘']
const WELCOME = '외근 추가, 할 일 정리, 기한 계산을 도와드릴게요. 예를 들어 "10/21 14시 분당서울대 MV 추가해줘"라고 쓰면 외근과 기한 할 일을 함께 만듭니다.'

/** Claude 채팅 (오른쪽 패널). 이미지는 붙여넣기·끌어놓기·＋ 버튼으로 붙인다 */
export function ChatPanel() {
  const lines = useChat((c) => c.lines)
  const busy = useChat((c) => c.busy)
  const [text, setText] = useState('')
  const [pending, setPending] = useState<PendingImage[]>([])
  const [dropping, setDropping] = useState(false)
  const [notice, setNotice] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [lines, busy])

  const addImages = async (files: Blob[]) => {
    setNotice('')
    const room = MAX_IMAGES - pending.length
    if (files.length > room) setNotice('한 번에 ' + MAX_IMAGES + '장까지 보낼 수 있어요.')
    const added: PendingImage[] = []
    for (const f of files.slice(0, Math.max(0, room))) {
      try {
        added.push(await toPendingImage(f))
      } catch (e) {
        setNotice(e instanceof Error ? e.message : String(e))
      }
    }
    if (added.length) setPending((p) => [...p, ...added])
    inputRef.current?.focus()
  }
  const removeImage = (i: number) =>
    setPending((p) => {
      URL.revokeObjectURL(p[i].url)
      return p.filter((_, j) => j !== i)
    })
  const submit = (value = text) => {
    if (busy || (!value.trim() && !pending.length)) return
    void send(value, pending)
    setText('')
    setPending([])
    setNotice('')
  }

  const onPaste = (e: ClipboardEvent) => {
    const files = [...e.clipboardData.items].filter((it) => it.kind === 'file' && it.type.startsWith('image/')).map((it) => it.getAsFile()).filter((f): f is File => !!f)
    if (files.length) {
      e.preventDefault()
      void addImages(files)
    }
  }
  const hasFiles = (e: DragEvent) => [...e.dataTransfer.types].includes('Files')

  return (
    <aside
      className={cx(s.chat, dropping && s.dropping)}
      aria-label="Claude와 채팅"
      onDragOver={(e) => {
        if (hasFiles(e)) {
          e.preventDefault()
          setDropping(true)
        }
      }}
      onDragLeave={(e) => {
        if (e.target === e.currentTarget) setDropping(false)
      }}
      onDrop={(e) => {
        setDropping(false)
        if (e.dataTransfer.files.length) {
          e.preventDefault()
          void addImages([...e.dataTransfer.files])
        }
      }}
    >
      <div className={s.head}>
        <b>Claude</b>
        <Button size="sm" variant="ghost" disabled={busy} onClick={newChat}>
          새 대화
        </Button>
        <Button size="sm" onClick={() => setUi({ chatOpen: false })}>
          닫기
        </Button>
      </div>
      <div className={s.msgs} ref={listRef}>
        {!lines.length && <div className={cx(s.msg, s.assistant)}>{WELCOME}</div>}
        {lines.map((l, i) =>
          l.role === 'user' ? (
            <div key={i} className={cx(s.msg, s.user)}>
              {l.images.length > 0 && (
                <div className={s.imgs}>
                  {l.images.map((u) => (
                    <img key={u} src={u} alt="첨부 이미지" />
                  ))}
                </div>
              )}
              {l.text}
            </div>
          ) : (
            <div key={i} className={cx(s.msg, l.role === 'assistant' ? s.assistant : s.sys)}>
              {l.text}
            </div>
          ),
        )}
        {busy && lines.at(-1)?.role !== 'assistant' && <div className={cx(s.msg, s.assistant, s.typing)}>…</div>}
        {notice && <div className={cx(s.msg, s.sys)}>{notice}</div>}
      </div>
      {!lines.length && (
        <div className={s.suggest}>
          {SUGGEST.map((q) => (
            <Button key={q} size="sm" onClick={() => submit(q)}>
              {q}
            </Button>
          ))}
        </div>
      )}
      {pending.length > 0 && (
        <div className={s.att}>
          {pending.map((p, i) => (
            <div key={p.url} className={s.thumb}>
              <img src={p.url} alt={'첨부 이미지 ' + (i + 1)} />
              <button type="button" aria-label="첨부 삭제" onClick={() => removeImage(i)}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <form
        className={s.input}
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <Button className={s.attach} title="이미지 첨부 (붙여넣기·끌어놓기도 돼요)" aria-label="이미지 첨부" onClick={() => fileRef.current?.click()}>
          ＋
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept={IMAGE_TYPES.join(',')}
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])]
            e.target.value = ''
            void addImages(files)
          }}
        />
        <Textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={onPaste}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
          placeholder="예: 이번 주 할 일 정리해줘 / 10/21 분당서울대 MV 14시 추가해줘"
          aria-label="메시지"
        />
        <Button type="submit" variant="solid" disabled={busy}>
          보내기
        </Button>
      </form>
    </aside>
  )
}
