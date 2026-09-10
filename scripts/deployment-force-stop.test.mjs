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
function run(functions, harness) {
  return execFileSync(
    "sh",
    ["-ec", `${functions.map(fn).join("\n")}\n${harness}`],
    { encoding: "utf8", timeout: 5_000 },
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
  assert.match(output, /stop:stop --time 0 worker-a/);
  assert.match(output, /stop:stop --time 0 worker-b/);
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
    run_deployment_task_command settle 95 || result=$?
    echo "result:$result helper:$deployment_helper"
  `,
  );
  assert.match(output, /settle --runtime-stopped/);
  assert.match(output, /--no-deps -T --pull never/);
  assert.match(output, /cleanup:rm -f linksense-deployment-tasks-test-deploy/);
  assert.match(output, /result:124 helper:\s*$/);
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
