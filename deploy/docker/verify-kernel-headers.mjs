import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";

export function validateHeaderInventory(files, stat, packages) {
  assert.ok(files.length > 500, "The full installed header inventory is required");
  assert.ok(!packages.some((name) => /^linux-(?:image|modules|headers)(?:-|:|$)/u.test(name)), "A kernel or kernel-module package cannot use header-only VEX");
  let headers = 0;
  for (const file of files) {
    const info = stat(file);
    if (info.isDirectory()) continue;
    if (file.startsWith("/usr/include/") && file.endsWith(".h")) {
      assert.ok(info.isFile() && (info.mode & 0o111) === 0, "Only non-executable userspace headers are allowed");
      headers++;
    } else {
      assert.match(file, /^\/usr\/share\/doc\/linux-libc-dev(?:\/|$)/u, "No kernel implementation may be present in this development package");
    }
  }
  assert.ok(headers > 500);
  return headers;
}

if (process.argv[1]?.endsWith("/verify-kernel-headers.mjs")) {
  const command = (...args) => execFileSync("dpkg-query", args, { encoding: "utf8", timeout: 10_000 }).trim();
  assert.match(readFileSync("/etc/os-release", "utf8"), /VERSION_ID="24\.04"/u);
  const [version, architecture] = command("-W", "-f=${Version}\t${Architecture}", "linux-libc-dev").split("\t");
  const files = command("-L", "linux-libc-dev").split("\n");
  assert.equal(execFileSync("dpkg", ["--verify", "linux-libc-dev"], { encoding: "utf8", timeout: 10_000 }).trim(), "", "Installed headers must match the package inventory");
  const packages = command("-W", "-f=${binary:Package}\n").split("\n");
  const headers = validateHeaderInventory(files, lstatSync, packages);
  console.log(JSON.stringify({ package: "linux-libc-dev", version, architecture, headers, kernelImplementation: false, hostKernel: "Not assessed; the deployment host must maintain its own kernel security updates." }));
}
