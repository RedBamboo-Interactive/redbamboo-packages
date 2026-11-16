import { useEffect, useMemo, useRef, useState } from "react"
import { useWsSubscribe } from "@redbamboo/utility"
import { isExcludedJob, normalizeChatJob, type ChatJob, type ComputeJobRecord, type NormalizeJobOptions } from "../lib/chat-jobs"
import { ChatJobsSync, type ChatJobsTransport } from "../lib/chat-jobs-sync"

export interface UseChatJobsOptions {
  /** The viewer's setting, and whether this conversation can have cards at all (Live can't). */
  enabled: boolean
  /** The conversation the jobs belong to; a change starts over. */
  conversationKey: string | null | undefined
  /** The oldest loaded message's time. Nothing loads until there is one. */
  since: string | null | undefined
  /** The host's authorized endpoint. Keep the reference stable per conversation. */
  transport: ChatJobsTransport | null | undefined
  /** See `ChatJobsSyncOptions.mayConcern`. Read when a frame arrives; may change freely. */
  mayConcern?: (data: Record<string, unknown>) => boolean
  confidential?: boolean
  jobHref?: NormalizeJobOptions["jobHref"]
}

const RECONNECTED = new Set(["websocket.connected", "upstream.connected"])

/**
 * The jobs of one conversation for `ChatPanel.jobs`: undefined while disabled
 * (so the panel takes its unchanged path), else the normalized cards' jobs,
 * exclusions applied. Disabled means no read, no timer and no frame handling.
 */
export function useChatJobs(options: UseChatJobsOptions): ChatJob[] | undefined {
  const { enabled, conversationKey, since, transport, confidential = false } = options
  const active = enabled && !!conversationKey && !!transport
  const [records, setRecords] = useState<ComputeJobRecord[]>([])
  const syncRef = useRef<ChatJobsSync | null>(null)
  const mayConcernRef = useRef(options.mayConcern)
  mayConcernRef.current = options.mayConcern
  const sinceRef = useRef(since)
  sinceRef.current = since

  useEffect(() => {
    setRecords([])
    if (!active || !transport) return
    const sync = new ChatJobsSync({
      transport,
      onChange: setRecords,
      mayConcern: data => mayConcernRef.current?.(data) ?? false,
      confidential,
    })
    syncRef.current = sync
    sync.setSince(sinceRef.current)
    return () => {
      sync.dispose()
      if (syncRef.current === sync) syncRef.current = null
    }
  }, [active, conversationKey, transport, confidential])

  useEffect(() => { syncRef.current?.setSince(since) }, [since])

  useWsSubscribe(event => {
    const sync = syncRef.current
    if (!sync) return
    if (RECONNECTED.has(event.type)) sync.reconnected()
    else if (event.type.startsWith("job.")) sync.frame(event.type, event.data)
  })

  const jobHref = options.jobHref
  return useMemo(() => active
    ? records.filter(record => !isExcludedJob(record)).map(record => normalizeChatJob(record, { jobHref }))
    : undefined, [active, records, jobHref])
}
