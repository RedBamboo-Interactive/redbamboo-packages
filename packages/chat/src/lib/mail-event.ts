export interface QuotedMail {
  from: string
  subject: string | null
}

/**
 * Pulls the quoted headers back out of a mail notice. leaf-mail writes each
 * message as `> From: …` / `> Subject: …` lines with Markdown metacharacters
 * backslash-escaped; the fields are already sanitized, so this only undoes the
 * escaping for display. Anything that isn't a header line is ignored.
 */
export function parseQuotedMails(text: string): { mails: QuotedMail[]; more: number } {
  const mails: QuotedMail[] = []
  let more = 0
  for (const line of text.split("\n")) {
    const from = /^> From: (.+)$/.exec(line)
    if (from) { mails.push({ from: unescapeField(from[1]), subject: null }); continue }
    const subject = /^> Subject: (.+)$/.exec(line)
    if (subject && mails.length > 0 && mails[mails.length - 1].subject == null) {
      mails[mails.length - 1].subject = unescapeField(subject[1])
      continue
    }
    const rest = /^\(and (\d+) more\b/.exec(line)
    if (rest) more = Number(rest[1])
  }
  return { mails, more }
}

function unescapeField(value: string): string {
  return value.replace(/\\(.)/g, "$1").trim()
}
