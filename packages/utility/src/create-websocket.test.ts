import assert from "node:assert/strict"
import test from "node:test"
import { createWebSocket, MAX_RECONNECT_MS, reconnectDelay } from "./create-websocket.ts"

class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static instances: FakeWebSocket[] = []

  readonly url: string
  readyState = FakeWebSocket.CONNECTING
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  open() {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.()
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED
  }

  serverClose() {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.()
  }
}

class FakeDocument extends EventTarget {
  visibilityState: DocumentVisibilityState = "visible"
}

function installBrowserFakes() {
  const previousWebSocket = Object.getOwnPropertyDescriptor(globalThis, "WebSocket")
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document")
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window")
  const document = new FakeDocument()
  const window = new EventTarget()
  FakeWebSocket.instances = []

  Object.defineProperty(globalThis, "WebSocket", { configurable: true, value: FakeWebSocket })
  Object.defineProperty(globalThis, "document", { configurable: true, value: document })
  Object.defineProperty(globalThis, "window", { configurable: true, value: window })

  return {
    document,
    window,
    restore() {
      restoreProperty("WebSocket", previousWebSocket)
      restoreProperty("document", previousDocument)
      restoreProperty("window", previousWindow)
    },
  }
}

function restoreProperty(name: string, descriptor: PropertyDescriptor | undefined) {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor)
  else delete (globalThis as Record<string, unknown>)[name]
}

test("replaces a falsely-open socket when a mobile page becomes visible", () => {
  const browser = installBrowserFakes()
  try {
    let reconnects = 0
    const handle = createWebSocket({
      url: "ws://leaf/ws",
      onEvent: () => {},
      onReconnect: () => { reconnects++ },
    })

    const first = FakeWebSocket.instances[0]
    first.open()
    assert.equal(first.readyState, FakeWebSocket.OPEN)

    browser.document.visibilityState = "hidden"
    browser.document.dispatchEvent(new Event("visibilitychange"))
    browser.document.visibilityState = "visible"
    browser.document.dispatchEvent(new Event("visibilitychange"))

    assert.equal(FakeWebSocket.instances.length, 2)
    assert.equal(first.readyState, FakeWebSocket.CLOSED)
    FakeWebSocket.instances[1].open()
    assert.equal(reconnects, 1)
    handle.close()
  } finally {
    browser.restore()
  }
})

test("reconnects and reports recovery after a server-side close", async () => {
  const browser = installBrowserFakes()
  try {
    let disconnects = 0
    let reconnects = 0
    const handle = createWebSocket({
      url: "ws://leaf/ws",
      reconnectMs: 1,
      onEvent: () => {},
      onDisconnect: () => { disconnects++ },
      onReconnect: () => { reconnects++ },
    })

    FakeWebSocket.instances[0].open()
    FakeWebSocket.instances[0].serverClose()
    await new Promise((resolve) => setTimeout(resolve, 10))

    assert.equal(disconnects, 1)
    assert.equal(FakeWebSocket.instances.length, 2)
    FakeWebSocket.instances[1].open()
    assert.equal(reconnects, 1)
    handle.close()
  } finally {
    browser.restore()
  }
})

test("a 4401 close (session revoked) never reconnects, not even on resume", async () => {
  const browser = installBrowserFakes()
  try {
    const revoked: string[] = []
    const handle = createWebSocket({
      url: "ws://leaf/ws",
      reconnectMs: 1,
      onEvent: () => {},
      onSessionRevoked: (reason) => void revoked.push(reason),
    })

    const socket = FakeWebSocket.instances[0] as FakeWebSocket & { onclose: ((e?: { code: number; reason: string }) => void) | null }
    socket.open()
    socket.readyState = FakeWebSocket.CLOSED
    socket.onclose?.({ code: 4401, reason: "session_revoked" })
    await new Promise((resolve) => setTimeout(resolve, 10))
    browser.document.visibilityState = "visible"
    browser.document.dispatchEvent(new Event("visibilitychange"))
    browser.window.dispatchEvent(new Event("online"))

    assert.deepEqual(revoked, ["session_revoked"])
    assert.equal(FakeWebSocket.instances.length, 1)
    handle.close()
  } finally {
    browser.restore()
  }
})

test("any other close code still reconnects", async () => {
  const browser = installBrowserFakes()
  try {
    let revoked = 0
    const handle = createWebSocket({
      url: "ws://leaf/ws",
      reconnectMs: 1,
      onEvent: () => {},
      onSessionRevoked: () => void revoked++,
    })
    const socket = FakeWebSocket.instances[0] as FakeWebSocket & { onclose: ((e?: { code: number; reason: string }) => void) | null }
    socket.open()
    socket.readyState = FakeWebSocket.CLOSED
    socket.onclose?.({ code: 1001, reason: "Server is stopping" })
    await new Promise((resolve) => setTimeout(resolve, 10))

    assert.equal(revoked, 0)
    assert.equal(FakeWebSocket.instances.length, 2)
    handle.close()
  } finally {
    browser.restore()
  }
})

test("a handle stopped by 4401 re-arms after a sign-in without a reload", async () => {
  const browser = installBrowserFakes()
  try {
    const handle = createWebSocket({ url: "ws://leaf/ws", reconnectMs: 1, onEvent: () => {} })
    const socket = FakeWebSocket.instances[0] as FakeWebSocket & { onclose: ((e?: { code: number; reason: string }) => void) | null }
    socket.open()
    socket.readyState = FakeWebSocket.CLOSED
    socket.onclose?.({ code: 4401, reason: "session_revoked" })
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(FakeWebSocket.instances.length, 1)

    handle.rearm()
    assert.equal(FakeWebSocket.instances.length, 2)
    handle.rearm()  // already armed: nothing more
    assert.equal(FakeWebSocket.instances.length, 2)
    handle.close()
    handle.rearm()  // closed for good
    assert.equal(FakeWebSocket.instances.length, 2)
  } finally {
    browser.restore()
  }
})

test("rearm does nothing to a socket that was never revoked", () => {
  const browser = installBrowserFakes()
  try {
    const handle = createWebSocket({ url: "ws://leaf/ws", onEvent: () => {} })
    FakeWebSocket.instances[0].open()
    handle.rearm()
    assert.equal(FakeWebSocket.instances.length, 1)
    handle.close()
  } finally {
    browser.restore()
  }
})

test("reconnect delays double from the base up to a minute while connects keep failing", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map((n) => reconnectDelay(3000, n)),
    [3000, 6000, 12_000, 24_000, 48_000, 60_000, 60_000, 60_000])
  assert.equal(reconnectDelay(3000, 0), 3000)
  assert.equal(reconnectDelay(3000, 10_000), MAX_RECONNECT_MS)
  assert.equal(reconnectDelay(120_000, 3), 120_000)  // a base above the cap is kept as is
})

test("a refused socket backs off, and one that opens starts again from the base", async () => {
  const browser = installBrowserFakes()
  const realSetTimeout = globalThis.setTimeout
  const delays: number[] = []
  globalThis.setTimeout = ((fn: () => void, ms?: number) => {
    delays.push(ms ?? 0)
    return realSetTimeout(fn, 0)
  }) as typeof setTimeout
  try {
    const handle = createWebSocket({ url: "ws://leaf/ws", reconnectMs: 100, onEvent: () => {} })
    for (let i = 0; i < 4; i++) {
      FakeWebSocket.instances.at(-1)!.serverClose()  // the upgrade is refused: never opens
      await new Promise((resolve) => realSetTimeout(resolve, 5))
    }
    FakeWebSocket.instances.at(-1)!.open()
    FakeWebSocket.instances.at(-1)!.serverClose()
    await new Promise((resolve) => realSetTimeout(resolve, 5))
    handle.close()

    assert.deepEqual(delays.filter((ms) => ms >= 100), [100, 200, 400, 800, 100])
  } finally {
    globalThis.setTimeout = realSetTimeout
    browser.restore()
  }
})
