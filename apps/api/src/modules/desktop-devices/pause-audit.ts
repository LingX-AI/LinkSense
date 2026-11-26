import pLimit from "p-limit";

import {
  desktopComputerPauseAuditId,
  type DesktopComputerPauseReceipt,
} from "./computer-control.js";

const maxPendingPauseAudits = 32;
export const pauseAuditWarning = "desktop computer pause audit was not recorded";

type Deps = {
  /** Idempotent writer; production uses a dedicated Prisma client. */
  write: (receipt: DesktopComputerPauseReceipt) => Promise<void>;
  /** Releases the writer's client after every admitted write has settled. */
  close?: () => Promise<void>;
  warn: (message: string) => void | Promise<void>;
};

/**
 * Best-effort supervisor for acknowledged Pause audits. It sits entirely off
 * the control path: at most one insert is issued at a time, a duplicate of a
 * still-pending generation collapses by its deterministic audit id, and the
 * pending set bounds the backlog. The writer's own transport, statement and
 * transaction deadlines settle each issued write, so an admission slot is
 * released only after the real transaction ended.
 *
 * A stalled database past the backlog cap drops the audit with the fixed
 * warning; the Pause has already been acknowledged, so the alternative would
 * be unbounded memory or a delayed control reply. This is the one deliberate
 * exception to one row per acknowledged Pause and is recorded in the desktop
 * task breakdown.
 */
export class DesktopComputerPauseAudit {
  private readonly admission = pLimit(1);
  private readonly pending = new Set<string>();
  private readonly background = new Set<Promise<void>>();
  private closing = false;

  constructor(private readonly deps: Deps) {}

  record(receipt: DesktopComputerPauseReceipt): void {
    if (this.closing) return;
    const auditId = desktopComputerPauseAuditId(receipt);
    if (this.pending.has(auditId)) return;
    if (this.pending.size >= maxPendingPauseAudits) {
      // Dropping is itself off the control path: the reply already went out
      // and even the fixed warning must not delay the transition's settlement.
      this.warnInBackground();
      return;
    }
    this.pending.add(auditId);
    // A write admitted before shutdown but not yet started must not open a new
    // dedicated connection during teardown; it reports the same fixed warning.
    // The write already in flight still settles, and close() runs only after
    // every tracked write ends.
    const tracked = this.admission(() => this.closing ? this.warn() : this.deps.write(receipt))
      .catch(() => this.warn())
      .finally(() => {
        this.pending.delete(auditId);
        this.background.delete(tracked);
      });
    this.background.add(tracked);
  }

  async close(): Promise<void> {
    this.closing = true;
    await Promise.all(this.background);
    await this.deps.close?.();
  }

  private warn(): Promise<void> {
    return Promise.resolve()
      .then(() => this.deps.warn(pauseAuditWarning))
      .catch(() => undefined);
  }

  private warnInBackground(): void {
    const warning = this.warn().finally(() => { this.background.delete(warning); });
    this.background.add(warning);
  }
}
