import assert from "node:assert/strict";
import test from "node:test";
import { classifyImageFindings, runtimeForRole } from "./release-image-policy.mjs";

const baseLayer = `sha256:${"a".repeat(64)}`;
const applicationLayer = `sha256:${"b".repeat(64)}`;
function fixture(architecture = "amd64") {
  return {
    role: "LINKSENSE_WORKER", scope: "application", architecture,
    baseImageConfigs: { [`linux/${architecture}`]: { os: "linux", architecture, rootfs: { type: "layers", diff_ids: [baseLayer] } } },
    report: {
      Metadata: { DiffIDs: [baseLayer, applicationLayer] },
      Results: [{ Vulnerabilities: [{ VulnerabilityID: "CVE-2026-12345", PkgName: "fixture", InstalledVersion: "1.0.0", Severity: "HIGH", Layer: { DiffID: baseLayer } }] }],
    },
  };
}

test("maps owned roles to their actual runtime without accepting unknown roles", () => {
  for (const [role, expected] of Object.entries({ LINKSENSE_API: "api", LINKSENSE_WEB: "web", LINKSENSE_MIGRATE: "node", LINKSENSE_RUNNER: "node", LINKSENSE_WORKER: "worker", POSTGRES: null, DOCLING: null })) {
    assert.equal(runtimeForRole(role), expected);
  }
  assert.throws(() => runtimeForRole("UNKNOWN"));
});

for (const architecture of ["amd64", "arm64"]) {
  test(`records inherited findings on ${architecture} without concealing or relabeling them as fixed`, () => {
    const input = fixture(architecture);
    const original = structuredClone(input);
    const result = classifyImageFindings(input);
    assert.equal(result.status, "external_risks_recorded");
    assert.deepEqual(result.counts, { application: 0, inherited: 1, external: 0 });
    assert.deepEqual(result.findings, [{ id: "CVE-2026-12345", package: "fixture", version: "1.0.0", severity: "HIGH", origin: "inherited", layer: baseLayer }]);
    assert.deepEqual(input, original);
  });
}

for (const severity of ["HIGH", "CRITICAL"]) {
  for (const layer of [applicationLayer, undefined, `sha256:${"c".repeat(64)}`]) {
    test(`blocks ${severity} application findings with layer evidence ${layer}`, () => {
      const input = fixture();
      input.report.Results[0].Vulnerabilities.push({ VulnerabilityID: "CVE-2026-54321", PkgName: "application-package", InstalledVersion: "2.0.0", Severity: severity, ...(layer ? { Layer: { DiffID: layer } } : {}) });
      const result = classifyImageFindings(input);
      assert.equal(result.status, "vulnerabilities");
      assert.deepEqual(result.counts, { application: 1, inherited: 1, external: 0 });
    });
  }
}

test("records external vendor findings without needing an application baseline", () => {
  const input = fixture();
  input.role = "MINIO";
  delete input.baseImageConfigs;
  assert.deepEqual(classifyImageFindings(input).counts, { application: 0, inherited: 0, external: 1 });
});

test("baseline maintenance records runtime risks but still validates scope and role", () => {
  const input = fixture();
  input.scope = "baseline";
  delete input.baseImageConfigs;
  assert.equal(classifyImageFindings(input).status, "external_risks_recorded");
  assert.throws(() => classifyImageFindings({ ...input, scope: "skip-all" }));
  assert.throws(() => classifyImageFindings({ ...input, role: "UNKNOWN" }));
});

for (const mutate of [
  input => { delete input.baseImageConfigs; },
  input => { input.baseImageConfigs["linux/amd64"].architecture = "arm64"; },
  input => { input.baseImageConfigs["linux/amd64"].rootfs.diff_ids = []; },
  input => { input.baseImageConfigs["linux/amd64"].rootfs.diff_ids = ["untrusted-layer"]; },
  input => { input.report.Metadata.DiffIDs.reverse(); },
  input => { delete input.report.Metadata; },
]) {
  test("rejects absent, malformed, wrong-architecture or unrelated baseline ancestry", () => {
    const input = fixture();
    mutate(input);
    assert.throws(() => classifyImageFindings(input));
  });
}

test("keeps empty and lower-severity reports passing without unsupported baseline claims", () => {
  const input = fixture();
  input.report.Results[0].Vulnerabilities[0].Severity = "MEDIUM";
  delete input.baseImageConfigs;
  assert.equal(classifyImageFindings(input).status, "passed");
  input.report.Results = null;
  assert.deepEqual(classifyImageFindings(input).counts, { application: 0, inherited: 0, external: 0 });
});

for (const key of ["Severity", "VulnerabilityID", "PkgName", "InstalledVersion"]) {
  test(`rejects an incomplete finding missing ${key}`, () => {
    const input = fixture();
    delete input.report.Results[0].Vulnerabilities[0][key];
    assert.throws(() => classifyImageFindings(input));
  });
}
