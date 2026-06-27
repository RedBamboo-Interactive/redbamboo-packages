import type { FeedbackSubmission, FeedbackResult } from "./feedback-dialog"
import { NOVA_PORT, SUITE_APPS } from "./suite-registry"

const REDLEAF_PORT = SUITE_APPS.find(a => a.name === "RedLeaf")!.port

function buildPrompt(submission: FeedbackSubmission): string {
  const lines: string[] = []

  lines.push(`A user has submitted feedback from ${submission.systemInfo.appName}. Your job is to investigate this report and create a proper Issue entity in RedLeaf.`)
  lines.push("")
  lines.push(`## Feedback`)
  lines.push(`- **Description**: ${submission.description}`)
  lines.push("")
  lines.push(`## System Info`)
  lines.push(`- App: ${submission.systemInfo.appName} v${submission.systemInfo.appVersion}`)
  lines.push(`- Browser: ${submission.systemInfo.browser}`)
  lines.push(`- OS: ${submission.systemInfo.os}`)
  lines.push(`- Screen: ${submission.systemInfo.screenResolution}`)
  lines.push(`- Theme: ${submission.systemInfo.colorScheme}`)
  lines.push(`- URL: ${submission.systemInfo.currentUrl}`)
  lines.push(`- Time: ${submission.systemInfo.timestamp}`)

  if (submission.context) {
    lines.push("")
    lines.push(`## Page Context`)
    lines.push(`- Page title: ${submission.context.title}`)
    lines.push(`- Route: ${submission.context.route}`)
    if (submission.context.screenshot) {
      lines.push(`- Screenshot: attached`)
    }
    if (submission.context.domContext) {
      lines.push(`- DOM context: ${JSON.stringify(submission.context.domContext)}`)
    }
  }

  if (submission.customMetadata) {
    lines.push("")
    lines.push(`## Additional Metadata`)
    for (const [key, value] of Object.entries(submission.customMetadata)) {
      lines.push(`- ${key}: ${value}`)
    }
  }

  lines.push("")
  lines.push(`## Instructions`)
  lines.push(`1. Analyze this feedback and determine the appropriate repository (use GET http://localhost:${REDLEAF_PORT}/api/entities?type=repository to list available repos).`)
  lines.push(`2. If this is a bug report, investigate the relevant code to understand the issue better.`)
  lines.push(`3. Create an Issue entity in RedLeaf via POST http://localhost:${REDLEAF_PORT}/api/entities with:`)
  lines.push(`   - typeSlug: "issue"`)
  lines.push(`   - name: a clear, concise issue title`)
  lines.push(`   - data: { repository: "<repo-entity-id>", type: "<bug|feature|refactor|test|docs — determine from the description>", status: "open", severity: "<your assessment>", reporter: "User", reporter_type: "user" }`)
  lines.push(`4. If you find related issues or context, include them in the issue description using the entity content endpoint.`)
  lines.push(`5. Report back with the issue title and ID.`)

  return lines.join("\n")
}

async function resolveProjectPath(appName: string): Promise<string> {
  try {
    const res = await fetch(`http://localhost:${REDLEAF_PORT}/api/entities?type=repository`, { credentials: "omit" })
    if (res.ok) {
      const data = await res.json()
      const repos = data.items as Array<{ name: string; data: string }>
      const match = repos.find(r => r.name.toLowerCase() === appName.toLowerCase())
      if (match) {
        const parsed = JSON.parse(match.data)
        return parsed.local_path
      }
      if (repos.length > 0) {
        return JSON.parse(repos[0].data).local_path
      }
    }
  } catch {}
  return "."
}

export async function submitFeedbackViaSession(
  submission: FeedbackSubmission,
): Promise<FeedbackResult> {
  const novaBase = `http://localhost:${NOVA_PORT}`
  const prompt = buildPrompt(submission)
  const projectPath = await resolveProjectPath(submission.systemInfo.appName)

  let res: Response
  try {
    res = await fetch(`${novaBase}/api/delegate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectPath,
        prompt,
        navigate: false,
        qualityMode: "standard",
      }),
    })
  } catch {
    throw new Error("Nova is not running. Start Nova to submit feedback.")
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "Failed to create feedback session" }))
    throw new Error(err.message || err.error || "Failed to submit feedback")
  }

  return {
    title: submission.description.slice(0, 80) + (submission.description.length > 80 ? "..." : ""),
    issueUrl: "",
  }
}
