import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { applicationImages, upstreamRoles } from "./release-image-inventory.mjs";

const digest = /^sha256:[a-f0-9]{64}$/u;
export const imageSecurityPolicy = "application-owned-v1";
const acceptedRisk = JSON.parse(readFileSync(new URL("../deploy/security/v0.3.13-risk-acceptance.json", import.meta.url), "utf8"));
assert.equal(acceptedRisk.schemaVersion, 1, "Unsupported risk acceptance record");
for (const key of ["releaseVersion", "ghsa", "cve", "package", "version", "severity", "acceptedOn", "reason"]) {
  assert.ok(typeof acceptedRisk[key] === "string" && acceptedRisk[key].length > 0, `Missing risk acceptance ${key}`);
}

export function runtimeForRole(role) {
  const application = applicationImages.find(name => role === `LINKSENSE_${name.toUpperCase()}`);
  if (!application) {
    assert.ok(upstreamRoles.includes(role), "Unknown release image role");
    return null;
  }
  return application === "migrate" || application === "runner" ? "node" : application;
}

/** Preserve findings; only application-introduced vulnerabilities block release. */
export function classifyImageFindings({ role, scope, architecture, report, baseImageConfigs, releaseVersion }) {
  assert.ok(scope === "application" || scope === "baseline", "Unknown image scan scope");
  assert.ok(architecture === "amd64" || architecture === "arm64", "Unknown image architecture");
  const runtime = runtimeForRole(role);
  assert.ok(report && typeof report === "object", "Missing image report");
  assert.ok(report.Results == null || Array.isArray(report.Results), "Invalid image results");
  const findings = [];
  for (const result of report.Results ?? []) {
    assert.ok(result && typeof result === "object", "Invalid image result");
    assert.ok(result.Vulnerabilities == null || Array.isArray(result.Vulnerabilities), "Invalid vulnerability list");
    for (const finding of result.Vulnerabilities ?? []) {
      assert.ok(finding && typeof finding === "object", "Invalid vulnerability");
      assert.ok(["UNKNOWN", "LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(finding.Severity), "Invalid vulnerability severity");
      if (finding.Severity !== "HIGH" && finding.Severity !== "CRITICAL") continue;
      for (const key of ["VulnerabilityID", "PkgName", "InstalledVersion"]) {
        assert.ok(typeof finding[key] === "string" && finding[key].length > 0, `Missing ${key}`);
      }
      findings.push({ ...finding, packageType: result.Type });
    }
  }

  let baseLayers;
  if (findings.length && scope === "application" && runtime !== null) {
    // Docker resolves the immutable baseline index into architecture-specific
    // configs. Prove ancestry before treating any layer as inherited.
    const config = baseImageConfigs?.[`linux/${architecture}`];
    assert.ok(config?.os === "linux" && config.architecture === architecture, "Baseline architecture mismatch");
    assert.equal(config.rootfs?.type, "layers", "Invalid baseline root filesystem");
    baseLayers = config.rootfs.diff_ids;
    assert.ok(Array.isArray(baseLayers) && baseLayers.length > 0 && baseLayers.every(layer => digest.test(layer)), "Invalid baseline layer inventory");
    const layers = report.Metadata?.DiffIDs;
    assert.ok(Array.isArray(layers) && layers.length >= baseLayers.length && layers.every(layer => digest.test(layer)), "Invalid application layer inventory");
    assert.deepEqual(layers.slice(0, baseLayers.length), baseLayers, "Application image does not inherit the frozen baseline");
  }

  const counts = { application: 0, inherited: 0, external: 0 };
  let acceptedApplicationFindings = 0;
  const classified = findings.map(finding => {
    let origin;
    if (scope === "baseline" || runtime === null) {
      origin = "external";
    } else if (baseLayers.includes(finding.Layer?.DiffID)) {
      origin = "inherited";
    } else {
      // Absent or unrecognized layer evidence never authorizes an exemption.
      origin = "application";
    }
    counts[origin]++;
    const riskAccepted = origin === "application" &&
      releaseVersion === acceptedRisk.releaseVersion &&
      ["npm", "node-pkg", "pnpm"].includes(finding.packageType) &&
      finding.PkgName === acceptedRisk.package &&
      finding.InstalledVersion === acceptedRisk.version &&
      finding.Severity === acceptedRisk.severity &&
      [acceptedRisk.ghsa, acceptedRisk.cve].includes(finding.VulnerabilityID);
    if (riskAccepted) acceptedApplicationFindings++;
    return {
      id: finding.VulnerabilityID,
      package: finding.PkgName,
      version: finding.InstalledVersion,
      severity: finding.Severity,
      origin,
      layer: finding.Layer?.DiffID ?? null,
      ...(riskAccepted ? { riskAcceptance: acceptedRisk } : {}),
    };
  });
  return {
    policy: imageSecurityPolicy,
    status: counts.application > acceptedApplicationFindings ? "vulnerabilities"
      : acceptedApplicationFindings ? "accepted_application_risks_recorded"
        : classified.length ? "external_risks_recorded" : "passed",
    counts,
    acceptedApplicationFindings,
    findings: classified,
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [command, role, scope, reportFile, configFile, architecture] = process.argv.slice(2);
  if (command === "name") {
    console.log(imageSecurityPolicy);
  } else if (command === "runtime") {
    console.log(runtimeForRole(role) ?? "");
  } else if (command === "classify") {
    const report = JSON.parse(readFileSync(reportFile, "utf8"));
    const baseImageConfigs = configFile === "-" ? undefined : JSON.parse(readFileSync(configFile, "utf8"));
    console.log(JSON.stringify(classifyImageFindings({ role, scope, architecture, report, baseImageConfigs, releaseVersion: process.env.RELEASE_VERSION })));
  } else {
    throw new Error("Unknown release image policy command");
  }
}
