import { describe, expect, it } from "vitest"

import {
  codexArgumentsForTesting,
  codexChildEnvironmentForTesting,
  codexEnvironmentForTesting,
} from "../src/codex/json-rpc-client.js"

describe("Codex child environment", () => {
  it("strips deployment credentials from the inherited Codex environment", () => {
    const environment = codexEnvironmentForTesting({
      PATH: "/usr/bin",
      LINK_SENSE_API_KEY: "load-balancer-key",
      OPENAI_API_KEY: "model-key",
      DATABASE_URL: "postgresql://secret",
      MINIO_SECRET_KEY: "minio-secret",
      LINKSENSE_RUNNER_SHARED_SECRET: "runner-secret",
      SMTP_PASSWORD: "smtp-secret",
    })
    expect(environment).toEqual({
      PATH: "/usr/bin",
    })
    expect(JSON.stringify(environment)).not.toContain("postgresql")
    expect(JSON.stringify(environment)).not.toContain("runner-secret")
    expect(JSON.stringify(environment)).not.toContain("smtp-secret")
  })

  it("isolates HOME and disables the ChatGPT remote-control startup path", () => {
    const environment = codexChildEnvironmentForTesting(
      {
        PATH: "/usr/bin",
        HOME: "/Users/developer",
        LINK_SENSE_API_KEY: "load-balancer-key",
      },
      "/runtime/user-home",
      "/runtime/user-home/.codex",
      {
        BASH_ENV: "/tmp/untrusted-bash-env",
        PATH: "/tmp/untrusted-bin",
        LINKSENSE_FILE_SERVICE_TOKEN: "turn-token",
      },
      {
        BASH_ENV: "/opt/linksense/runtime/shell/linksense-bash-env.sh",
        PATH: "/opt/linksense/bin:/usr/bin",
      },
    )

    expect(environment).toMatchObject({
      HOME: "/runtime/user-home",
      CODEX_HOME: "/runtime/user-home/.codex",
      BASH_ENV: "/opt/linksense/runtime/shell/linksense-bash-env.sh",
      PATH: "/opt/linksense/bin:/usr/bin",
      CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED: "1",
      LINKSENSE_FILE_SERVICE_TOKEN: "turn-token",
    })
    expect(environment).not.toHaveProperty("LINK_SENSE_API_KEY")
    expect(JSON.stringify(environment)).not.toContain("/Users/developer")
  })

  it("keeps turn-scoped credentials out of every Codex shell subprocess", () => {
    const argumentsList = codexArgumentsForTesting({
      SERVICE_API_TOKEN: "service-secret",
      PERSONAL_API_TOKEN: "personal-secret",
      LINKSENSE_FILE_SERVICE_TOKEN: "file-service-secret",
    })

    expect(argumentsList).toEqual([
      "app-server",
      "-c",
      "allow_login_shell=false",
      "-c",
      "skills.bundled.enabled=false",
      "-c",
      'shell_environment_policy.exclude=["AZURE_OPENAI_API_KEY","CODEX_API_KEY","LINKSENSE_FILE_SERVICE_TOKEN","LINKSENSE_MODEL_GATEWAY_TOKEN","LINK_SENSE_API_KEY","OPENAI_API_KEY","PERSONAL_API_TOKEN","SERVICE_API_TOKEN"]',
      "--stdio",
    ])
    expect(JSON.stringify(argumentsList)).not.toContain("service-secret")
    expect(JSON.stringify(argumentsList)).not.toContain("personal-secret")
    expect(JSON.stringify(argumentsList)).not.toContain("file-service-secret")
  })

  it("always keeps provider credentials out of Codex shell subprocesses", () => {
    expect(codexArgumentsForTesting(undefined)).toEqual([
      "app-server",
      "-c",
      "allow_login_shell=false",
      "-c",
      "skills.bundled.enabled=false",
      "-c",
      'shell_environment_policy.exclude=["AZURE_OPENAI_API_KEY","CODEX_API_KEY","LINKSENSE_MODEL_GATEWAY_TOKEN","LINK_SENSE_API_KEY","OPENAI_API_KEY"]',
      "--stdio",
    ])
  })

  it("pins the managed shell bootstrap, PATH, and package sources in every Codex shell subprocess", () => {
    expect(
      codexArgumentsForTesting(undefined, {
        BASH_ENV: "/opt/linksense/runtime/shell/linksense-bash-env.sh",
        PATH: "/opt/linksense/bin:/usr/bin",
        LINKSENSE_PYTHON_PACKAGE_INDEX_URL:
          "https://pypi.example.test/simple/",
        LINKSENSE_NODE_PACKAGE_REGISTRY_URL: "https://npm.example.test/",
        UV_DEFAULT_INDEX: "https://pypi.example.test/simple/",
        UV_INDEX_STRATEGY: "first-index",
        PIP_INDEX_URL: "https://pypi.example.test/simple/",
        NPM_CONFIG_REGISTRY: "https://npm.example.test/",
        DATABASE_URL: "postgresql://must-not-appear",
      }),
    ).toEqual([
      "app-server",
      "-c",
      "allow_login_shell=false",
      "-c",
      "skills.bundled.enabled=false",
      "-c",
      'shell_environment_policy.exclude=["AZURE_OPENAI_API_KEY","CODEX_API_KEY","LINKSENSE_MODEL_GATEWAY_TOKEN","LINK_SENSE_API_KEY","OPENAI_API_KEY"]',
      "-c",
      'shell_environment_policy.set={BASH_ENV="/opt/linksense/runtime/shell/linksense-bash-env.sh",PATH="/opt/linksense/bin:/usr/bin",LINKSENSE_PYTHON_PACKAGE_INDEX_URL="https://pypi.example.test/simple/",LINKSENSE_NODE_PACKAGE_REGISTRY_URL="https://npm.example.test/",UV_DEFAULT_INDEX="https://pypi.example.test/simple/",UV_INDEX_STRATEGY="first-index",PIP_INDEX_URL="https://pypi.example.test/simple/",NPM_CONFIG_REGISTRY="https://npm.example.test/"}',
      "--stdio",
    ])
  })
})
