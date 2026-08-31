import { describe, expect, it } from "vitest"

import {
  isolatedChildInvocation,
  SETPRIV_COMMAND,
} from "../src/child-process-isolation.js"

describe("task child process isolation", () => {
  it("leaves supervisor-side commands unchanged when no task identity is set", () => {
    expect(isolatedChildInvocation("node", ["script.js"])).toEqual({
      command: "node",
      args: ["script.js"],
    })
  })

  it("drops identity and every inheritable capability before task exec", () => {
    expect(
      isolatedChildInvocation("codex", ["app-server"], {
        uid: 1001,
        gid: 1000,
      }),
    ).toEqual({
      command: SETPRIV_COMMAND,
      args: [
        "--reuid=1001",
        "--regid=1000",
        "--keep-groups",
        "--bounding-set=-all",
        "--inh-caps=-all",
        "--ambient-caps=-all",
        "--",
        "codex",
        "app-server",
      ],
    })
  })

  it("rejects root and invalid child identities", () => {
    expect(() =>
      isolatedChildInvocation("codex", [], { uid: 0, gid: 1000 }),
    ).toThrow("child process identity is invalid")
    expect(() =>
      isolatedChildInvocation("codex", [], { uid: 1001, gid: -1 }),
    ).toThrow("child process identity is invalid")
  })
})
