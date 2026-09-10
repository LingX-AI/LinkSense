import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../deploy/production/deploy-production.sh", import.meta.url),
  "utf8",
);
function fn(name) {
  const match = source.match(
    new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}`, "m"),
  );
  assert.ok(match, `missing ${name}`);
  return match[0];
}
function run(functions, harness, input = "") {
  return execFileSync(
    "sh",
    ["-ec", `${functions.map(fn).join("\n")}\n${harness}`],
    { encoding: "utf8", timeout: 5_000, input },
  );
}

test("force shutdown stops producers, bounds native interrupt, then stops workers before settlement", () => {
  const output = run(
    ["stop_deployment_execution"],
    `
    shutdown_remaining() { echo 1; }
    stop_deployment_service() { echo "stop:$1"; }
    run_deployment_task_command() { echo "native:$1"; return 1; }
    remove_deployment_workers() { echo workers; }
    stop_deployment_execution
  `,
  );
  assert.ok(output.indexOf("stop:api") < output.indexOf("native:interrupt"));
  assert.ok(output.indexOf("native:interrupt") < output.indexOf("stop:runner"));
  assert.ok(output.indexOf("stop:runner") < output.indexOf("workers"));
});

test("worker cleanup validates deployment labels, stops in parallel and keeps volumes", () => {
  const output = run(
    ["remove_deployment_workers"],
    `
    worker_instance_key() { echo expected; }
    shutdown_remaining() { echo 0; }
    bounded_docker() { docker "$@"; }
    docker() {
      case "$1" in
        ps) echo 'worker-a worker-b' ;;
        inspect) case "$3" in *managed*) echo true ;; *instance*) echo expected ;; esac ;;
        stop) echo "stop:$*" ;;
        rm) echo "remove:$*" ;;
      esac
    }
    remove_deployment_workers
  `,
  );
  assert.match(output, /stop:stop --timeout 0 worker-a/);
  assert.match(output, /stop:stop --timeout 0 worker-b/);
  assert.match(output, /remove:rm worker-a worker-b/);
  assert.doesNotMatch(output, /--volumes|-v /);
});

test("wrong worker labels fail closed without deleting anything", () => {
  assert.throws(
    () =>
      run(
        ["remove_deployment_workers"],
        `
    worker_instance_key() { echo expected; }
    shutdown_remaining() { echo 0; }
    bounded_docker() { docker "$@"; }
    docker() {
      case "$1" in
        ps) echo worker-a ;;
        inspect) echo unrelated ;;
        stop|rm) echo UNSAFE; exit 99 ;;
      esac
    }
    remove_deployment_workers
  `,
      ),
    (error) => error.status === 1 && !String(error.stdout).includes("UNSAFE"),
  );
});

test("settlement failure does not authorize runtime restoration", () => {
  const output = run(
    ["settle_deployment_execution"],
    `
    execution_settled=0
    run_deployment_task_command() { return 1; }
    if settle_deployment_execution; then exit 99; fi
    echo "settled:$execution_settled"
  `,
  );
  assert.match(output, /settled:0/);
});

for (const command of ["interrupt", "settle"]) {
  test(`${command} helper closes stdin and disables Compose's default interactive attachment`, () => {
    const output = run(
      ["run_deployment_task_command", "cleanup_deployment_helper"],
      `
      temporary_root=/tmp/test-deploy
      compose_file=compose.yml
      environment_file=production.env
      timeout() {
        case " $* " in
          *' --interactive=false '*) ;;
          *) echo interactive-attachment-enabled; return 124 ;;
        esac
        if IFS= read -r unexpected_input; then
          echo helper-consumed-terminal-input
          return 124
        fi
        echo '{"done":true}'
      }
      bounded_docker() {
        case "$1" in
          ps) return 0 ;;
          *) echo unexpected-cleanup; return 99 ;;
        esac
      }
      result=0
      run_deployment_task_command ${command} 10 || result=$?
      IFS= read -r remaining_input
      echo "result:$result remaining:$remaining_input helper:$deployment_helper"
    `,
      "keep-parent-terminal-input\n",
    );
    assert.match(output, /\{"done":true\}/);
    assert.match(
      output,
      /result:0 remaining:keep-parent-terminal-input helper:\s*$/,
    );
    assert.doesNotMatch(
      output,
      /interactive-attachment-enabled|helper-consumed-terminal-input|unexpected-cleanup/,
    );
  });
}

test("timed out helper is removed and settlement requires stopped runtime", () => {
  const output = run(
    ["run_deployment_task_command", "cleanup_deployment_helper"],
    `
    temporary_root=/tmp/test-deploy
    compose_file=compose.yml
    environment_file=production.env
    timeout() { echo "command:$*"; return 124; }
    bounded_docker() {
      case "$1" in
        ps) echo helper-id ;;
        inspect) echo linksense-deployment-tasks-test-deploy ;;
        rm) echo "cleanup:$*" ;;
      esac
    }
    result=0
    run_deployment_task_command settle 95 2>&1 || result=$?
    echo "result:$result helper:$deployment_helper"
  `,
  );
  assert.match(output, /settle --runtime-stopped/);
  assert.match(output, /--no-deps --interactive=false -T --pull never/);
  assert.match(output, /cleanup:rm -f linksense-deployment-tasks-test-deploy/);
  assert.match(output, /Deployment task 'settle' timed out after 95s \(exit 124\)/);
  assert.match(output, /result:124 helper:\s*$/);
});

test("helper failure keeps its exit code even when it printed a result and cleanup succeeded", () => {
  const output = run(
    ["run_deployment_task_command"],
    `
    temporary_root=/tmp/test-deploy
    compose_file=compose.yml
    environment_file=production.env
    timeout() { echo '{"turns":0}'; return 7; }
    cleanup_deployment_helper() { echo cleaned; }
    result=0
    run_deployment_task_command settle 95 2>&1 || result=$?
    echo "result:$result"
  `,
  );
  assert.match(output, /Deployment task 'settle' failed with exit code 7/);
  assert.match(output, /cleaned\nresult:7/);
});

test("helper cleanup failure is distinguished from command success and prevents settlement", () => {
  const output = run(
    ["run_deployment_task_command", "settle_deployment_execution"],
    `
    temporary_root=/tmp/test-deploy
    compose_file=compose.yml
    environment_file=production.env
    execution_settled=0
    timeout() { echo '{"turns":0}'; }
    cleanup_deployment_helper() { return 1; }
    result=0
    settle_deployment_execution 2>&1 || result=$?
    echo "result:$result settled:$execution_settled"
  `,
  );
  assert.match(
    output,
    /Deployment task 'settle' helper cleanup failed \(command exit 0\)/,
  );
  assert.match(output, /result:1 settled:0/);
});

test("helper cleanup refuses a matching name with an unrelated ownership label", () => {
  const output = run(
    ["cleanup_deployment_helper"],
    `
    deployment_helper=linksense-deployment-tasks-test-deploy
    bounded_docker() {
      case "$1" in
        ps) echo unrelated-id ;;
        inspect) echo unrelated ;;
        rm) echo UNSAFE ;;
      esac
    }
    if cleanup_deployment_helper; then exit 99; fi
    echo refused
  `,
  );
  assert.match(output, /refused/);
  assert.doesNotMatch(output, /UNSAFE/);
});

test("an exhausted global grace period does not launch a helper", () => {
  const output = run(
    ["run_deployment_task_command"],
    `
    timeout() { echo UNSAFE; }
    if run_deployment_task_command interrupt 0; then exit 99; fi
    echo skipped
  `,
  );
  assert.match(output, /skipped/);
  assert.doesNotMatch(output, /UNSAFE/);
});
