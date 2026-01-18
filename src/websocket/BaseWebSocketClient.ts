// BaseWebSocketClient.ts
type Listener = (payload?: unknown) => void;

export type BaseWSOptions = {
  autoReconnect?: boolean; // default true
  maxReconnectAttempts?: number | null; // default null (infinite)
  reconnectDelayMinMs?: number; // default 300
  reconnectDelayMaxMs?: number; // default 30000
  reconnectBackoffFactor?: number; // default 1.6
  reconnectJitter?: number; // fraction 0..1, default 0.2
  heartbeat?: {
    enabled?: boolean; // default false
    pingPayload?: unknown; // if provided, send this periodically
    intervalMs?: number; // ping every N ms (default 20s)
    timeoutMs?: number; // wait for pong N ms (default 10s)
    expectPongPredicate?: (msg: unknown) => boolean; // optional function to detect pong messages
  };
  debug?: boolean; // default false
};

export class BaseWebSocketClient {
  private url: string;
  private ws?: WebSocket;
  private listeners = new Map<string, Set<Listener>>();
  private sendQueue: unknown[] = [];
  private opts: Required<BaseWSOptions>;
  private reconnectAttempts = 0;
  private reconnectTimer?: number;
  private manualClose = false;
  private lastMessageAt = 0;
  private heartbeatTimer?: number;
  private heartbeatTimeoutTimer?: number;
  private connectedResolve?: (() => void) | null = null;

  constructor(url: string, options: BaseWSOptions = {}) {
    this.url = url;

    // set defaults
    this.opts = {
      autoReconnect: options.autoReconnect ?? true,
      maxReconnectAttempts: options.maxReconnectAttempts ?? null,
      reconnectDelayMinMs: options.reconnectDelayMinMs ?? 300,
      reconnectDelayMaxMs: options.reconnectDelayMaxMs ?? 30_000,
      reconnectBackoffFactor: options.reconnectBackoffFactor ?? 1.6,
      reconnectJitter: options.reconnectJitter ?? 0.2,
      heartbeat: {
        enabled: options.heartbeat?.enabled ?? false,
        pingPayload: options.heartbeat?.pingPayload ?? null,
        intervalMs: options.heartbeat?.intervalMs ?? 20_000,
        timeoutMs: options.heartbeat?.timeoutMs ?? 10_000,
        expectPongPredicate:
          options.heartbeat?.expectPongPredicate ?? undefined,
      },
      debug: options.debug ?? false,
    };
  }

  // ----------------------
  // Event API
  // ----------------------
  on(
    event: "open" | "message" | "close" | "error" | "reconnect" | "flush",
    fn: Listener,
  ) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
  }
  off(event: string, fn?: Listener) {
    if (!this.listeners.has(event)) return;
    if (!fn) this.listeners.delete(event);
    else this.listeners.get(event)!.delete(fn);
  }
  once(event: string, fn: Listener) {
    const wrapper = (p?: unknown) => {
      fn(p);
      this.off(event, wrapper);
    };
    this.on(event as "message", wrapper);
  }
  private emit(event: string, payload?: unknown) {
    if (this.opts.debug) console.debug(`[BaseWS] ${event}`, payload);
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of Array.from(set)) {
      try {
        fn(payload);
      } catch (e) {
        console.error("Listener error", e);
      }
    }
  }

  // ----------------------
  // Connect / Reconnect
  // ----------------------
  connect(): Promise<void> {
    this.manualClose = false;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }

    // return a promise that resolves when 'open' emitted
    return new Promise<void>((resolve, reject) => {
      this.connectedResolve = resolve;
      try {
        this._connectInternal();
        // we set a short timeout for initial open (optional)
        // but we rely primarily on onopen/onerror events
      } catch (err) {
        reject(err);
      }
    });
  }

  private _connectInternal() {
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    if (this.opts.debug) console.info(`[BaseWS] connecting to ${this.url}`);
    this.ws = new WebSocket(this.url);

    this.ws.onopen = (ev) => this.handleOpen(ev);
    this.ws.onmessage = (msg) => this.handleMessage(msg);
    this.ws.onclose = (ev) => this.handleClose(ev);
    this.ws.onerror = (err) => this.handleError(err);
  }

  private handleOpen(ev?: Event) {
    if (this.opts.debug) console.info(`[BaseWS] open ${this.url}`);
    this.reconnectAttempts = 0;
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    this.lastMessageAt = Date.now();
    this.startHeartbeatIfNeeded();

    // flush send queue
    this.flushSendQueue();

    this.emit("open", ev);
    if (this.connectedResolve) {
      this.connectedResolve();
      this.connectedResolve = null;
    }
  }

  private handleMessage(msgEvent: MessageEvent) {
    this.lastMessageAt = Date.now();

    let parsed: unknown;
    const data = msgEvent.data;
    // try parse if JSON
    try {
      if (typeof data === "string") parsed = JSON.parse(data);
      else if (data instanceof Blob) {
        // convert Blob to text (async) - but keep synchronous fallback
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const text = reader.result as string;
            const maybe = JSON.parse(text);
            this.emit("message", maybe);
          } catch {
            this.emit("message", reader.result);
          }
        };
        reader.readAsText(data);
        return;
      } else if (data instanceof ArrayBuffer) {
        parsed = data; // caller handles binary
      } else parsed = data;
    } catch {
      parsed = data;
    }

    // If heartbeat expects a pong, check it and clear timeout
    if (
      this.opts.heartbeat.enabled &&
      this.opts.heartbeat.expectPongPredicate
    ) {
      try {
        const isPong = this.opts.heartbeat.expectPongPredicate(parsed);
        if (isPong) {
          if (this.heartbeatTimeoutTimer) {
            window.clearTimeout(this.heartbeatTimeoutTimer);
            this.heartbeatTimeoutTimer = undefined;
          }
        }
      } catch {
        // ignore predicate errors
      }
    }

    this.emit("message", parsed);
  }

  private handleClose(ev?: CloseEvent) {
    if (this.opts.debug) console.info(`[BaseWS] close ${this.url}`, ev);
    this.stopHeartbeat();

    this.emit("close", ev);

    if (!this.manualClose && this.opts.autoReconnect) {
      this.scheduleReconnect();
    }
  }

  private handleError(err?: Event | ErrorEvent) {
    if (this.opts.debug) console.warn(`[BaseWS] error`, err);
    this.emit("error", err);
    // Note: many browsers will also fire 'close' after 'error'.
  }

  // ----------------------
  // Reconnect helpers
  // ----------------------
  private scheduleReconnect() {
    if (
      this.opts.maxReconnectAttempts !== null &&
      this.reconnectAttempts >= this.opts.maxReconnectAttempts
    ) {
      if (this.opts.debug)
        console.warn("[BaseWS] max reconnect attempts reached");
      return;
    }
    this.reconnectAttempts++;
    const base =
      this.opts.reconnectDelayMinMs *
      Math.pow(this.opts.reconnectBackoffFactor, this.reconnectAttempts - 1);
    const capped = Math.min(base, this.opts.reconnectDelayMaxMs);
    const jitter = capped * this.opts.reconnectJitter * (Math.random() * 2 - 1); // +- jitter
    const delay = Math.max(0, Math.round(capped + jitter));

    if (this.opts.debug)
      console.info(
        `[BaseWS] scheduling reconnect #${this.reconnectAttempts} in ${delay}ms`,
      );

    this.reconnectTimer = window.setTimeout(() => {
      this.emit("reconnect", { attempt: this.reconnectAttempts });
      this._connectInternal();
    }, delay);
  }

  // ----------------------
  // Heartbeat (app-level)
  // ----------------------
  private startHeartbeatIfNeeded() {
    if (!this.opts.heartbeat.enabled) return;
    this.stopHeartbeat();

    // schedule pings
    this.heartbeatTimer = window.setInterval(() => {
      // if lastMessageAt is stale beyond interval + timeout, force reconnect
      const now = Date.now();
      if (
        this.opts.heartbeat.intervalMs &&
        this.opts.heartbeat.timeoutMs &&
        now - this.lastMessageAt >
          this.opts.heartbeat.intervalMs + this.opts.heartbeat.timeoutMs
      ) {
        if (this.opts.debug)
          console.warn("[BaseWS] connection stale - forcing reconnect");
        this.forceReconnect();
        return;
      }

      // send ping payload if provided
      if (this.opts.heartbeat.pingPayload !== null) {
        try {
          this.send(this.opts.heartbeat.pingPayload);
        } catch {
          /* ignore */
        }
      }

      // set timeout waiting for pong
      if (this.heartbeatTimeoutTimer)
        window.clearTimeout(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = window.setTimeout(() => {
        if (this.opts.debug)
          console.warn("[BaseWS] heartbeat timed out - reconnecting");
        this.forceReconnect();
      }, this.opts.heartbeat.timeoutMs);
    }, this.opts.heartbeat.intervalMs);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    if (this.heartbeatTimeoutTimer) {
      window.clearTimeout(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = undefined;
    }
  }

  // Immediately close and attempt reconnect (if autoReconnect)
  private forceReconnect() {
    // close socket without setting manualClose => reconnect flow will kick in
    this.manualClose = false;
    try {
      this.ws?.close();
    } catch {
      // ignore
    }
  }

  // ----------------------
  // Send / Queue
  // ----------------------
  send(payload: unknown) {
    const s = this.ws;
    if (s && s.readyState === WebSocket.OPEN) {
      try {
        if (
          typeof payload === "string" ||
          payload instanceof ArrayBuffer ||
          payload instanceof Blob
        ) {
          s.send(payload);
        } else {
          s.send(JSON.stringify(payload));
        }
      } catch {
        // on failure push to queue
        this.enqueue(payload);
      }
    } else {
      // not open yet -> enqueue
      this.enqueue(payload);
    }
  }

  private enqueue(payload: unknown) {
    this.sendQueue.push(payload);
    // optional: cap queue size to avoid memory blow
    const maxQueue = 1000;
    if (this.sendQueue.length > maxQueue) {
      this.sendQueue.splice(0, this.sendQueue.length - maxQueue); // drop oldest
      if (this.opts.debug)
        console.warn("[BaseWS] sendQueue capped, dropping oldest messages");
    }
  }

  private flushSendQueue() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.sendQueue.length === 0) return;
    // flush everything (could be batched/ratelimited by adapter if needed)
    while (this.sendQueue.length) {
      const p = this.sendQueue.shift();
      try {
        if (
          typeof p === "string" ||
          p instanceof ArrayBuffer ||
          p instanceof Blob
        )
          this.ws.send(p);
        else this.ws.send(JSON.stringify(p));
      } catch {
        // if websocket throws, re-enqueue and exit
        this.enqueue(p);
        break;
      }
    }
    this.emit("flush");
  }

  // ----------------------
  // Close
  // ----------------------
  close(code = 1000, reason = "client_close") {
    this.manualClose = true;
    this.opts.autoReconnect = false; // stop reconnect attempts
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    try {
      this.ws?.close(code, reason);
    } catch {
      // ignore
    }
  }

  // ----------------------
  // Utilities
  // ----------------------
  get isConnected() {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }
  get readyState() {
    return this.ws ? this.ws.readyState : WebSocket.CLOSED;
  }
  get pendingSendCount() {
    return this.sendQueue.length;
  }
}
