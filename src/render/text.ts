export function detectTextDirection(text: string): 'rtl' | 'ltr' {
  if (!text) return 'ltr';
  const rtlRange = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
  const ltrRange = /[A-Za-z\u00C0-\u024F]/;

  for (const char of text) {
    if (rtlRange.test(char)) {
      return 'rtl';
    }
    if (ltrRange.test(char)) {
      return 'ltr';
    }
  }
  return 'ltr';
}

export const FONT_STACK = '"Noto Sans Arabic","Segoe UI",Tahoma,Arial,sans-serif';
