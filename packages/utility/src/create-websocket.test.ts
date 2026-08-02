import assert from "node:assert/strict"
import test from "node:test"
import { createWebSocket } from "./create-websocket.ts"

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
