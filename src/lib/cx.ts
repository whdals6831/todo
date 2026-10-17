/** 조건부 className 합치기: cx('a', on && 'b') */
export const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' ')
