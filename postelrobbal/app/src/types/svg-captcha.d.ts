/**
 * Minimal ambient declaration for `svg-captcha` (no bundled types upstream).
 * Only the surface we actually consume is declared (§90 style: narrow types).
 */
declare module 'svg-captcha' {
  export interface CreateOptions {
    /** number of characters */
    size?: number | undefined;
    /** number of noise lines */
    noise?: number | undefined;
    /** random colors per character */
    color?: boolean | undefined;
    /** background color (rgba allowed) */
    background?: string | undefined;
    /** image width in px */
    width?: number | undefined;
    /** image height in px */
    height?: number | undefined;
    /** characters to exclude from the random pool */
    ignoreChars?: string | undefined;
    /** custom pool of characters (default: a-z0-9) */
    charPreset?: string | undefined;
    /** font size in px */
    fontSize?: number | undefined;
  }

  export interface CaptchaResult {
    /** raw SVG markup */
    data: string;
    /** plain-text code shown in the image */
    text: string;
  }

  export function create(options?: CreateOptions): CaptchaResult;
  export function createSync(options?: CreateOptions): CaptchaResult;
}
