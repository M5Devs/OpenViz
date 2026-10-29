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

export interface MetadataTagContext {
  artist?: string;
  title?: string;
  positionSec?: number;
  durationSec?: number;
  fps?: number;
}

export function formatTimeMMSS(seconds: number | undefined): string {
  if (seconds === undefined || isNaN(seconds) || seconds < 0) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export function expandTextTags(templateText: string, context?: MetadataTagContext): string {
  if (!templateText) return '';

  const artist = context?.artist || 'Unknown Artist';
  const title = context?.title || 'Unknown Title';
  const artistAndTitle = `${artist} - ${title}`;
  const position = formatTimeMMSS(context?.positionSec);
  const duration = formatTimeMMSS(context?.durationSec);
  const fps = Math.round(context?.fps ?? 60).toString();

  return templateText
    .replace(/\{ArtistAndTitle\}/g, artistAndTitle)
    .replace(/\{Artist\}/g, artist)
    .replace(/\{Title\}/g, title)
    .replace(/\{Position\}/g, position)
    .replace(/\{Duration\}/g, duration)
    .replace(/\{Fps\}/g, fps);
}
