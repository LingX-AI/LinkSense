import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getCACertificates, setDefaultCACertificates } from "node:tls";
import test, { after, before } from "node:test";
import { developmentCertificateHosts, developmentCertificateIsCurrent, prepareDevelopmentTls, trustDevelopmentCertificate } from "./dev-tls.mjs";
import { createDevelopmentTlsFixture } from "./fixtures/dev-tls-fixture.mjs";

let fixture;
before(() => { fixture = createDevelopmentTlsFixture(); });
after(() => rmSync(fixture.root, { recursive: true, force: true }));

function environment(directory = fixture.directory) {
  return { LINKSENSE_DEV_WEB_HTTPS_ORIGIN: "https://localhost:18173", LINKSENSE_DEV_WEB_BIND_ADDRESS: "127.0.0.1", LINKSENSE_DEV_TLS_DIR: directory };
}

test("development certificate covers configured hosts and loopback probe addresses", () => {
  assert.deepEqual(developmentCertificateHosts(environment()), ["localhost", "127.0.0.1", "::1"]);
  assert.deepEqual(developmentCertificateHosts({ ...environment(), LINKSENSE_DEV_WEB_HTTPS_ORIGIN: "https://dev.example.test:19173", LINKSENSE_DEV_WEB_BIND_ADDRESS: "0.0.0.0" }), ["localhost", "127.0.0.1", "::1", "dev.example.test"]);
  assert.deepEqual(developmentCertificateHosts({ ...environment(), LINKSENSE_DEV_WEB_HTTPS_ORIGIN: "https://[::1]:18173", LINKSENSE_DEV_WEB_BIND_ADDRESS: "::" }), ["localhost", "127.0.0.1", "::1"]);
});

test("certificate reuse checks dates, host coverage, issuing CA and private key", () => {
  const ca = readFileSync(resolve(fixture.root, "rootCA.pem"));
  const leaf = new X509Certificate(readFileSync(resolve(fixture.directory, "cert.pem")));
  const hosts = developmentCertificateHosts(environment());
  assert.equal(developmentCertificateIsCurrent(fixture.directory, hosts, ca), true);
  assert.equal(developmentCertificateIsCurrent(fixture.directory, [...hosts, "other.test"], ca), false);
  assert.equal(developmentCertificateIsCurrent(fixture.directory, hosts, ca, Date.parse(leaf.validFrom) - 1), false);
  assert.equal(developmentCertificateIsCurrent(fixture.directory, hosts, ca, Date.parse(leaf.validTo) - 29 * 86_400_000), false);
  assert.equal(developmentCertificateIsCurrent(fixture.directory, hosts, "invalid CA"), false);
  const broken = resolve(fixture.root, "broken");
  mkdirSync(broken);
  copyFileSync(resolve(fixture.directory, "cert.pem"), resolve(broken, "cert.pem"));
  copyFileSync(resolve(fixture.root, "rootCA-key.pem"), resolve(broken, "key.pem"));
  assert.equal(developmentCertificateIsCurrent(broken, hosts, ca), false);
  assert.equal(developmentCertificateIsCurrent(resolve(fixture.root, "missing"), hosts, ca), false);
});

test("preparation generates missing leaf files, protects the host directory and reuses valid certificates", () => {
  const directory = resolve(fixture.root, "prepared");
  const calls = [];
  const execute = (command, args, options) => {
    assert.equal(command, "mkcert");
    assert.ok(options.timeout > 0 && options.timeout <= 60_000);
    calls.push(args);
    if (args[0] === "-CAROOT") return { status: 0, stdout: fixture.root };
    if (args[0] === "-cert-file") {
      copyFileSync(resolve(fixture.directory, "cert.pem"), args[1]);
      copyFileSync(resolve(fixture.directory, "key.pem"), args[3]);
    }
    return { status: 0 };
  };
  prepareDevelopmentTls(environment(directory), { execute });
  assert.deepEqual(calls.map((args) => args[0]), ["-CAROOT", "-install", "-cert-file"]);
  assert.deepEqual(calls[2].slice(4), ["localhost", "127.0.0.1", "::1"]);
  assert.deepEqual(readdirSync(directory).sort(), ["ca.pem", "cert.pem", "key.pem"]);
  assert.equal(statSync(directory).mode & 0o777, 0o700);
  assert.equal(statSync(resolve(directory, "key.pem")).mode & 0o777, 0o600);
  const modified = statSync(resolve(directory, "cert.pem")).mtimeMs;
  prepareDevelopmentTls(environment(directory), { execute });
  assert.equal(calls.filter((args) => args[0] === "-cert-file").length, 1);
  assert.equal(statSync(resolve(directory, "cert.pem")).mtimeMs, modified);
  writeFileSync(resolve(directory, "key.pem"), "broken key");
  prepareDevelopmentTls(environment(directory), { execute });
  assert.equal(calls.filter((args) => args[0] === "-cert-file").length, 2);
});

test("missing mkcert and failed CA trust stop setup with an actionable error", () => {
  assert.throws(() => prepareDevelopmentTls(environment(), { execute: () => ({ error: { code: "ENOENT" } }) }), /requires mkcert/u);
  assert.throws(() => prepareDevelopmentTls(environment(), { execute: (_command, args) => args[0] === "-CAROOT" ? { status: 0, stdout: fixture.root } : { status: 1 } }), /mkcert -install/u);
});

test("launcher trust adds the development CA without discarding existing roots", (context) => {
  const roots = getCACertificates("default");
  context.after(() => setDefaultCACertificates(roots));
  copyFileSync(resolve(fixture.root, "rootCA.pem"), resolve(fixture.directory, "ca.pem"));
  trustDevelopmentCertificate(environment());
  const current = getCACertificates("default");
  const fingerprints = new Set(current.map((cert) => new X509Certificate(cert).fingerprint256));
  for (const root of roots) assert.ok(fingerprints.has(new X509Certificate(root).fingerprint256));
  const expected = new X509Certificate(readFileSync(resolve(fixture.directory, "ca.pem"))).fingerprint256;
  assert.ok(current.some((cert) => new X509Certificate(cert).fingerprint256 === expected));
  trustDevelopmentCertificate({ LINKSENSE_PUBLIC_BASE_URL: "http://localhost:5273" });
  assert.deepEqual(getCACertificates("default"), current);
});
