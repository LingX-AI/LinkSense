import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

// An isolated test CA, never installed in the machine trust store. OpenSSL is
// already a development-image prerequisite; no machine certificates are read.
export function createDevelopmentTlsFixture() {
  const root = mkdtempSync(resolve(tmpdir(), "linksense-test-tls-"));
  const directory = resolve(root, "tls");
  mkdirSync(directory);
  const run = (args) => execFileSync("openssl", args, { cwd: root, stdio: "pipe", timeout: 10_000 });
  run(["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes", "-keyout", "rootCA-key.pem", "-out", "rootCA.pem", "-days", "3650", "-subj", "/CN=LinkSense isolated test CA"]);
  run(["req", "-new", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes", "-keyout", "tls/key.pem", "-out", "leaf.csr", "-subj", "/CN=localhost"]);
  writeFileSync(resolve(root, "extensions.cnf"), "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1\n");
  run(["x509", "-req", "-in", "leaf.csr", "-CA", "rootCA.pem", "-CAkey", "rootCA-key.pem", "-CAcreateserial", "-out", "tls/cert.pem", "-days", "365", "-extfile", "extensions.cnf"]);
  return { root, directory };
}
