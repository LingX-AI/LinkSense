import assert from "node:assert/strict";
import test from "node:test";
import { dependencyTunnelArguments } from "./dev-dependencies.mjs";

const environment = {
  LINKSENSE_DEV_SSH_TARGET: "dev-server",
  LINKSENSE_DEV_SSH_FORWARDS: "19080:19080,15432:5432",
};

test("dependency tunnels use configured ports and bind both ends to loopback", () => {
  const argumentsList = dependencyTunnelArguments(environment);
  assert.deepEqual(argumentsList.slice(-6), [
    "-L", "127.0.0.1:19080:127.0.0.1:19080",
    "-L", "127.0.0.1:15432:127.0.0.1:5432",
    "--", "dev-server",
  ]);
  assert.ok(argumentsList.includes("BatchMode=yes"));
  assert.ok(argumentsList.includes("ControlPath=none"));
  assert.ok(argumentsList.includes("ExitOnForwardFailure=yes"));
  assert.equal(dependencyTunnelArguments({
    ...environment,
    LINKSENSE_DEV_SSH_TARGET: "developer@another-server",
  }).at(-1), "developer@another-server");
});

test("dependency tunnels reject missing configuration, option injection, and unsafe port mappings", () => {
  for (const target of ["", "-oProxyCommand=bad", "server command", "server;command"]) {
    assert.throws(() => dependencyTunnelArguments({
      ...environment,
      LINKSENSE_DEV_SSH_TARGET: target,
    }), /LINKSENSE_DEV_SSH_TARGET/u);
  }
  for (const forwards of ["", "0:80", "19080:65536", "19080:80,19080:81", "0.0.0.0:80:80", "19080:remote:80", "19080:80,"]) {
    assert.throws(() => dependencyTunnelArguments({
      ...environment,
      LINKSENSE_DEV_SSH_FORWARDS: forwards,
    }), /LINKSENSE_DEV_SSH_FORWARDS/u);
  }
});
