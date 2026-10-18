import type Anthropic from '@anthropic-ai/sdk'

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const
export const MAX_IMAGES = 5
/** Claude 가 이보다 큰 이미지는 어차피 줄여서 본다 — 미리 줄여 보내면 빠르고 싸다 */
const MAX_EDGE = 1568

type MediaType = (typeof IMAGE_TYPES)[number]

export interface PendingImage {
  block: Anthropic.Beta.BetaImageBlockParam
  /** 미리보기용 주소 (다 쓰면 revoke) */
  url: string
}

const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })

/** 긴 변이 1568px 보다 크면 줄인다. GIF 는 첫 장만 PNG 로 */
async function shrink(file: Blob): Promise<{ blob: Blob; type: MediaType }> {
  const type = file.type as MediaType
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height))
  if (scale === 1 && type !== 'image/gif') {
    bmp.close()
    return { blob: file, type }
  }
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * scale)
  canvas.height = Math.round(bmp.height * scale)
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  bmp.close()
  const outType: MediaType = type === 'image/jpeg' ? 'image/jpeg' : type === 'image/webp' ? 'image/webp' : 'image/png'
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('이미지를 변환하지 못했습니다'))), outType, 0.9),
  )
  return { blob, type: outType }
}

/** 붙여넣기·끌어놓기·선택한 파일을 Claude 에 보낼 이미지 블록으로 */
export async function toPendingImage(file: Blob): Promise<PendingImage> {
  if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) throw new Error('PNG, JPG, WebP, GIF 이미지만 붙일 수 있어요.')
  const { blob, type } = await shrink(file)
  return {
    block: { type: 'image', source: { type: 'base64', media_type: type, data: await toBase64(blob) } },
    url: URL.createObjectURL(blob),
  }
}
