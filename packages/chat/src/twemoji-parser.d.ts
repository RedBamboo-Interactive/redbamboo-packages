declare module "twemoji-parser" {
  interface EmojiEntity {
    url: string
    indices: [number, number]
    text: string
    type: string
  }
  interface ParseOptions {
    buildRecursive?: boolean
    assetType?: string
  }
  export function parse(text: string, options?: ParseOptions): EmojiEntity[]
  export function toCodePoints(unicodeSurrogates: string): string[]
}
