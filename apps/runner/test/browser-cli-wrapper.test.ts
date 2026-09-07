import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  BrowserSessionLeaseStore,
  BrowserSessionLimitError,
  MAX_WORKSPACE_HTML_BYTES,
  browserCliMain,
  isManagedBrowserDaemonArguments,
  normalizeBrowserCliArguments,
  validateBrowserCliArguments,
  type BrowserCliRunner,
} from "../src/browser/cli-wrapper.js"
import {
  prepareManagedBrowserPolicy,
  readManagedBrowserPolicy,
} from "../src/browser/policy.js"
import { cleanupManagedBrowserSession } from "../src/browser/session-cleanup.js"
import { makeDirectoryTreeRemovable } from "../src/workspace/filesystem.js"

const roots: string[] = []
const firstConversationId = "019f45dd-a318-7d02-b03b-eaece8887865"
const secondConversationId = "019f45dd-a318-7d02-b03b-eaece8887866"
const thirdConversationId = "019f45dd-a318-7d02-b03b-eaece8887867"

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(async (root) => {
      await makeDirectoryTreeRemovable(root)
      await rm(root, { recursive: true, force: true })
    }),
  )
})

describe("managed browser CLI", () => {
  it("allows broad Playwright commands and navigation targets", () => {
    expect(
      validateBrowserCliArguments(["open", "https://example.com/path"]),
    ).toBe("open")
    expect(validateBrowserCliArguments(["open", "about:blank"])).toBe("open")
    expect(
      validateBrowserCliArguments(["goto", "http://127.0.0.1:4010"]),
    ).toBe("goto")
    expect(
      validateBrowserCliArguments(["goto", "http://192.168.1.10"]),
    ).toBe("goto")
    expect(
      validateBrowserCliArguments([
        "goto",
        "http://metadata.google.internal",
      ]),
    ).toBe("goto")
    expect(
      validateBrowserCliArguments([
        "goto",
        "https://user:secret@example.com",
      ]),
    ).toBe("goto")
    expect(validateBrowserCliArguments(["open", "file:///etc/passwd"])).toBe(
      "open",
    )
  })

  it("normalizes managed boundary options while keeping the CLI surface open", () => {
    for (const command of [
      "attach",
      "install-browser",
      "kill-all",
      "list",
      "run-code",
      "unroute",
    ]) {
      expect(validateBrowserCliArguments([command])).toBe(command)
    }
    expect(
      normalizeBrowserCliArguments(
        [
          "open",
          "about:blank",
          "--browser=firefox",
          "--headed",
          "--session=another-task",
          "--config",
          "/tmp/override.json",
          "--profile=outside",
          "--persistent",
          "/tmp/profile",
        ],
        "/workspace/task/temp/browser",
      ),
    ).toEqual(["open", "about:blank", "--browser=firefox", "--headed"])
    expect(
      normalizeBrowserCliArguments(
        [
          "screenshot",
          "-s",
          "another-task",
          "--filename",
          "evidence.png",
        ],
        "/workspace/task/temp/browser",
      ),
    ).toEqual([
      "screenshot",
      "--filename",
      path.join("/workspace/task/temp/browser", "evidence.png"),
    ])
    for (const option of [
      "--browser=firefox",
      "--headed",
    ]) {
      expect(
        validateBrowserCliArguments(["open", "about:blank", option]),
      ).toBe("open")
    }
    for (const args of [
      ["open-workspace-html"],
      ["open-workspace-html", "/tmp/page.html"],
      ["open-workspace-html", "artifacts/page.txt"],
    ]) {
      expect(() => validateBrowserCliArguments(args)).toThrow(
        "browser workspace HTML command requires one relative .html path",
      )
    }
    expect(
      validateBrowserCliArguments([
        "open-workspace-html",
        "artifacts/page.html",
        "--headed",
      ]),
    ).toBe("open-workspace-html")
  })

  it("recognizes only the daemon for the exact managed task session", () => {
    const session = `linksense-${firstConversationId}`
    expect(
      isManagedBrowserDaemonArguments(
        [
          "/usr/local/bin/node",
          "/runtime/playwright-core/lib/entry/cliDaemon.js",
          session,
          "--config=/task/config.json",
        ],
        session,
      ),
    ).toBe(true)
    expect(
      isManagedBrowserDaemonArguments(
        [
          "/usr/local/bin/node",
          "/runtime/playwright-core/lib/entry/cliDaemon.js",
          `linksense-${secondConversationId}`,
        ],
        session,
      ),
    ).toBe(false)
    expect(
      isManagedBrowserDaemonArguments(
        ["/usr/local/bin/node", "/task/other.js", session],
        session,
      ),
    ).toBe(false)
  })

  it("keeps generated browser files inside the task browser output directory", () => {
    const outputRoot = "/workspace/task/temp/browser"
    expect(
      normalizeBrowserCliArguments(
        ["screenshot", "--filename", "页面证据.png"],
        outputRoot,
      ),
    ).toEqual([
      "screenshot",
      "--filename",
      path.join(outputRoot, "页面证据.png"),
    ])
    expect(
      normalizeBrowserCliArguments(
        ["video-start", "recording.webm"],
        outputRoot,
      ),
    ).toEqual([
      "video-start",
      path.join(outputRoot, "recording.webm"),
    ])
    for (const filename of [
      "../escape.png",
      "/tmp/escape.png",
      "nested/escape.png",
      "nested\\escape.png",
    ]) {
      expect(() =>
        normalizeBrowserCliArguments(
          ["screenshot", `--filename=${filename}`],
          outputRoot,
        ),
      ).toThrow("browser output filename must be a plain filename")
    }
  })

  it("enforces the per-user active browser session limit atomically", async () => {
    const root = await temporaryRoot()
    const leases = new BrowserSessionLeaseStore(root, 2)

    await leases.acquire(firstConversationId)
    await leases.acquire(secondConversationId)
    await expect(leases.acquire(thirdConversationId)).rejects.toBeInstanceOf(
      BrowserSessionLimitError,
    )

    await leases.release(firstConversationId)
    await expect(leases.acquire(thirdConversationId)).resolves.toBeUndefined()
  })

  it("stores the supervisor browser policy in a read-only managed directory", async () => {
    const root = path.join(await temporaryRoot(), "policy")
    const policy = {
      sessionRoot:
        "/home/linksense/.local/share/linksense/browser-sessions",
      sessionLimit: 3,
    }
    await prepareManagedBrowserPolicy(policy, root)
    await expect(readManagedBrowserPolicy(root)).resolves.toEqual(policy)
    expect((await stat(root)).mode & 0o777).toBe(0o555)
    expect((await stat(path.join(root, "policy.json"))).mode & 0o777).toBe(
      0o444,
    )
    await expect(
      prepareManagedBrowserPolicy(
        { sessionRoot: "relative/sessions", sessionLimit: 3 },
        root,
      ),
    ).rejects.toThrow("invalid managed browser policy")
  })

  it("creates an isolated full Chromium config and reuses only the current task session", async () => {
    const root = await temporaryRoot()
    const runtimeRoot = path.join(root, "runtime")
    const userHome = path.join(root, "home")
    const codexHome = path.join(userHome, ".codex")
    const workspace = path.join(
      userHome,
      "workspaces",
      firstConversationId,
    )
    const sessionRoot = path.join(root, "sessions")
    await Promise.all([
      mkdir(codexHome, { recursive: true }),
      prepareBrowserRuntime(runtimeRoot),
      ...["artifacts", "attachments", "temp"].map((name) =>
        mkdir(path.join(workspace, name), { recursive: true }),
      ),
    ])
    const calls: Parameters<BrowserCliRunner>[0][] = []
    const runCli = vi.fn<BrowserCliRunner>(async (input) => {
      calls.push(input)
      return 0
    })
    const environment = {
      HOME: userHome,
      CODEX_HOME: codexHome,
      LINKSENSE_BROWSER_SESSION_ROOT: path.join(root, "attacker-sessions"),
      LINKSENSE_BROWSER_SESSION_LIMIT: "20",
    }
    const policy = { sessionRoot, sessionLimit: 2 }
    const canonicalHome = await realpath(userHome)
    const canonicalWorkspace = await realpath(workspace)

    await expect(
      browserCliMain(
        [
          "open",
          "about:blank",
          "--session=another-task",
          "--config=/tmp/override.json",
        ],
        environment,
        workspace,
        { runtimeRoot, runCli, policy },
      ),
    ).resolves.toBe(0)

    const browserStateRoot = path.join(
      canonicalHome,
      ".local",
      "share",
      "linksense",
      "browser",
      firstConversationId,
    )
    const configPath = path.join(browserStateRoot, "cli.config.json")
    const config = JSON.parse(await readFile(configPath, "utf8")) as {
      browser: {
        browserName: string
        isolated: boolean
        launchOptions: {
          channel: string
          headless: boolean
          chromiumSandbox: boolean
          ignoreDefaultArgs: string[]
        }
        contextOptions: {
          acceptDownloads: boolean
          serviceWorkers: string
        }
        initPage: string[]
      }
      outputDir: string
      allowUnrestrictedFileAccess: boolean
    }
    expect(config).toMatchObject({
      browser: {
        browserName: "chromium",
        isolated: true,
        launchOptions: {
          channel: "chromium",
          headless: true,
          chromiumSandbox: false,
          ignoreDefaultArgs: ["--disable-dev-shm-usage"],
        },
        contextOptions: {
          userAgent: testBrowserUserAgent,
          acceptDownloads: true,
          serviceWorkers: "allow",
        },
        initPage: [path.join(runtimeRoot, "init-page.ts")],
      },
      outputDir: path.join(canonicalWorkspace, "temp", "browser"),
      allowUnrestrictedFileAccess: false,
    })

    const forgedWorkspace = path.join(workspace, secondConversationId)
    await Promise.all(
      ["artifacts", "attachments", "temp"].map((name) =>
        mkdir(path.join(forgedWorkspace, name), { recursive: true }),
      ),
    )
    await expect(
      browserCliMain(
        ["open", "about:blank"],
        environment,
        forgedWorkspace,
        { runtimeRoot, runCli, policy },
      ),
    ).resolves.toBe(0)
    expect(calls.at(-1)?.args[0]).toBe(
      `-s=linksense-${firstConversationId}`,
    )
    expect(calls[0]?.args).toEqual([
      `-s=linksense-${firstConversationId}`,
      "open",
      "about:blank",
      "--config",
      configPath,
    ])
    expect(calls[0]?.environment).toMatchObject({
      HOME: canonicalHome,
      XDG_CACHE_HOME: path.join(browserStateRoot, "cache"),
      TMPDIR: path.join("/tmp/lb", firstConversationId),
      PLAYWRIGHT_CLI_SESSION: `linksense-${firstConversationId}`,
    })
    await expect(
      readFile(path.join(sessionRoot, `${firstConversationId}.lease`), "utf8"),
    ).resolves.toContain(firstConversationId)
    await expect(
      readFile(
        path.join(
          environment.LINKSENSE_BROWSER_SESSION_ROOT,
          `${firstConversationId}.lease`,
        ),
        "utf8",
      ),
    ).rejects.toMatchObject({ code: "ENOENT" })

    await expect(
      browserCliMain(
        ["screenshot", "--filename=evidence.png"],
        environment,
        workspace,
        { runtimeRoot, runCli, policy },
      ),
    ).resolves.toBe(0)
    expect(calls[2]?.args).toEqual([
      `-s=linksense-${firstConversationId}`,
      "screenshot",
      `--filename=${path.join(
        canonicalWorkspace,
        "temp",
        "browser",
        "evidence.png",
      )}`,
    ])

    await expect(
      browserCliMain(["close"], environment, workspace, {
        runtimeRoot,
        runCli,
        policy,
      }),
    ).resolves.toBe(0)
    expect(calls[3]?.args).toEqual([
      `-s=linksense-${firstConversationId}`,
      "close",
    ])
    await expect(readFile(configPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    })

    await expect(
      browserCliMain(
        ["open", "https://example.test/read-only"],
        { ...environment, LINKSENSE_BROWSER_READ_ONLY: "1" },
        workspace,
        { runtimeRoot, runCli, policy },
      ),
    ).resolves.toBe(0)
    const readOnlyConfig = JSON.parse(
      await readFile(configPath, "utf8"),
    ) as {
      browser: {
        contextOptions: { acceptDownloads: boolean; serviceWorkers: string }
      }
    }
    expect(readOnlyConfig.browser.contextOptions.acceptDownloads).toBe(false)
    expect(readOnlyConfig.browser.contextOptions.serviceWorkers).toBe("block")
    await expect(
      browserCliMain(
        ["close"],
        { ...environment, LINKSENSE_BROWSER_READ_ONLY: "1" },
        workspace,
        { runtimeRoot, runCli, policy },
      ),
    ).resolves.toBe(0)
    expect(calls.every((call) => call.cwd === canonicalWorkspace)).toBe(true)
  })

  it("opens a bounded self-contained workspace HTML through the managed browser", async () => {
    const root = await temporaryRoot()
    const runtimeRoot = path.join(root, "runtime")
    const userHome = path.join(root, "home")
    const codexHome = path.join(userHome, ".codex")
    const workspace = path.join(
      userHome,
      "workspaces",
      firstConversationId,
    )
    const sessionRoot = path.join(root, "sessions")
    const htmlPath = path.join(workspace, "artifacts", "deck.html")
    const html = "<!doctype html><title>预览</title><main>LinkSense</main>"
    await Promise.all([
      mkdir(codexHome, { recursive: true }),
      prepareBrowserRuntime(runtimeRoot),
      ...["artifacts", "attachments", "temp"].map((name) =>
        mkdir(path.join(workspace, name), { recursive: true }),
      ),
    ])
    await writeFile(htmlPath, html)
    const runCli = vi.fn<BrowserCliRunner>(async () => 0)
    const writeOutput = vi.fn<(value: string) => void>()
    const dependencies = {
      runtimeRoot,
      runCli,
      policy: { sessionRoot, sessionLimit: 2 },
      writeOutput,
    }

    await expect(
      browserCliMain(
        ["--help"],
        { HOME: userHome, CODEX_HOME: codexHome },
        workspace,
        dependencies,
      ),
    ).resolves.toBe(0)
    expect(writeOutput).toHaveBeenCalledWith(
      expect.stringContaining(
        "linksense-browser open-workspace-html <workspace-relative-html-path>",
      ),
    )
    runCli.mockClear()

    await expect(
      browserCliMain(
        ["open-workspace-html", "artifacts/deck.html"],
        { HOME: userHome, CODEX_HOME: codexHome },
        workspace,
        dependencies,
      ),
    ).resolves.toBe(0)

    const invocation = runCli.mock.calls[0]?.[0]
    expect(invocation?.args[0]).toBe(
      `-s=linksense-${firstConversationId}`,
    )
    expect(invocation?.args[1]).toBe("open")
    const target = invocation?.args[2] ?? ""
    expect(target).toMatch(/^data:text\/html,/u)
    expect(decodeURIComponent(target.slice("data:text/html,".length))).toBe(
      html,
    )
    expect(target).not.toContain("file://")
  })

  it("rejects workspace HTML traversal, symbolic links, and oversized files", async () => {
    const root = await temporaryRoot()
    const runtimeRoot = path.join(root, "runtime")
    const userHome = path.join(root, "home")
    const codexHome = path.join(userHome, ".codex")
    const workspace = path.join(
      userHome,
      "workspaces",
      firstConversationId,
    )
    const sessionRoot = path.join(root, "sessions")
    const outsideHtml = path.join(root, "outside.html")
    const linkedHtml = path.join(workspace, "artifacts", "linked.html")
    const oversizedHtml = path.join(workspace, "artifacts", "oversized.html")
    await Promise.all([
      mkdir(codexHome, { recursive: true }),
      prepareBrowserRuntime(runtimeRoot),
      ...["artifacts", "attachments", "temp"].map((name) =>
        mkdir(path.join(workspace, name), { recursive: true }),
      ),
      writeFile(outsideHtml, "<title>outside</title>"),
    ])
    await symlink(outsideHtml, linkedHtml)
    await writeFile(oversizedHtml, "x".repeat(MAX_WORKSPACE_HTML_BYTES + 1))
    const environment = { HOME: userHome, CODEX_HOME: codexHome }
    const dependencies = {
      runtimeRoot,
      runCli: vi.fn<BrowserCliRunner>(async () => 0),
      policy: { sessionRoot, sessionLimit: 2 },
    }

    await expect(
      browserCliMain(
        ["open-workspace-html", "../outside.html"],
        environment,
        workspace,
        dependencies,
      ),
    ).rejects.toThrow(
      "browser workspace HTML path is outside the current task workspace",
    )
    await expect(
      browserCliMain(
        ["open-workspace-html", "artifacts/linked.html"],
        environment,
        workspace,
        dependencies,
      ),
    ).rejects.toThrow("browser workspace HTML file is unavailable")
    await expect(
      browserCliMain(
        ["open-workspace-html", "artifacts/oversized.html"],
        environment,
        workspace,
        dependencies,
      ),
    ).rejects.toThrow(
      "browser workspace HTML file exceeds the managed size limit",
    )
    expect(dependencies.runCli).not.toHaveBeenCalled()
  })

  it("runs supervisor cleanup with only the scoped browser environment", async () => {
    const root = await temporaryRoot()
    const userHome = path.join(root, "home")
    const codexHome = path.join(userHome, ".codex")
    const workspace = path.join(
      userHome,
      "workspaces",
      firstConversationId,
    )
    const log = path.join(root, "cleanup.log")
    const command = path.join(root, "cleanup-browser")
    await Promise.all([
      mkdir(workspace, { recursive: true }),
      mkdir(codexHome, { recursive: true }),
      writeFile(
        command,
        `#!/bin/sh\nprintf '%s|%s|%s|%s|%s\\n' "$1" "$HOME" "$CODEX_HOME" "\${LINKSENSE_BROWSER_SESSION_ROOT-unset}" "\${LINKSENSE_BROWSER_SESSION_LIMIT-unset}" > '${log}'\n`,
      ),
    ])
    await chmod(command, 0o755)

    await cleanupManagedBrowserSession({
      command,
      userHome,
      codexHome,
      workspace,
      sourceEnvironment: { PATH: process.env.PATH },
    })

    expect(await readFile(log, "utf8")).toBe(
      `__cleanup|${userHome}|${codexHome}|unset|unset\n`,
    )
  })
})

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "linksense-browser-"))
  roots.push(root)
  return root
}

const testBrowserUserAgent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36"

async function prepareBrowserRuntime(runtimeRoot: string): Promise<void> {
  await mkdir(runtimeRoot, { recursive: true })
  await writeFile(path.join(runtimeRoot, "user-agent.json"), JSON.stringify({ userAgent: testBrowserUserAgent }))
}
