import { spawnSync } from "node:child_process";
import { createPrivateKey, X509Certificate } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { resolve } from "node:path";
import { getCACertificates, setDefaultCACertificates } from "node:tls";

export function developmentTlsDirectory(rootDirectory) {
  return resolve(rootDirectory, ".data/dev/tls");
}

export function developmentCertificateHosts(environment) {
  const hostname = new URL(environment.LINKSENSE_DEV_WEB_HTTPS_ORIGIN).hostname.replace(/^\[|\]$/gu, "");
  const bind = environment.LINKSENSE_DEV_WEB_BIND_ADDRESS?.replace(/^\[|\]$/gu, "");
  return [...new Set(["localhost", "127.0.0.1", "::1", hostname,
    ...(bind && bind !== "0.0.0.0" && bind !== "::" ? [bind] : []),
  ])];
}

export function developmentCertificateIsCurrent(directory, hosts, ca, now = Date.now()) {
  try {
    const certificate = new X509Certificate(readFileSync(resolve(directory, "cert.pem")));
    const authority = new X509Certificate(ca);
    const privateKey = createPrivateKey(readFileSync(resolve(directory, "key.pem")));
    const renewBefore = now + 30 * 24 * 60 * 60 * 1_000;
    return Date.parse(certificate.validFrom) <= now &&
      Date.parse(certificate.validTo) > renewBefore &&
      Date.parse(authority.validFrom) <= now && Date.parse(authority.validTo) > renewBefore &&
      certificate.checkPrivateKey(privateKey) && certificate.checkIssued(authority) &&
      certificate.verify(authority.publicKey) &&
      hosts.every((host) => Boolean(isIP(host) ? certificate.checkIP(host) : certificate.checkHost(host)));
  } catch {
    return false;
  }
}

export function prepareDevelopmentTls(environment, options = {}) {
  const execute = options.execute ?? spawnSync;
  const directory = environment.LINKSENSE_DEV_TLS_DIR;
  if (!directory) throw new Error("LINKSENSE_DEV_TLS_DIR is required for HTTPS development");
  const mkcert = (args, interactive = false) => {
    const result = execute("mkcert", args, {
      env: environment,
      encoding: "utf8",
      stdio: interactive ? "inherit" : ["ignore", "pipe", "pipe"],
      timeout: interactive ? 60_000 : 15_000,
    });
    if (result.error?.code === "ENOENT") {
      throw new Error("HTTPS development requires mkcert on the host. Install it from https://github.com/FiloSottile/mkcert, then run pnpm dev again.");
    }
    if (result.error || result.status !== 0) {
      throw new Error("Development certificate setup failed. Run mkcert -install on the host, complete the system trust prompt, and run pnpm dev again.");
    }
    return result.stdout?.trim() ?? "";
  };

  const authorityDirectory = mkcert(["-CAROOT"]);
  if (!authorityDirectory) throw new Error("mkcert did not return its certificate authority directory");
  mkcert(["-install"], true);
  const ca = readFileSync(resolve(authorityDirectory, "rootCA.pem"));
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const hosts = developmentCertificateHosts(environment);
  if (!developmentCertificateIsCurrent(directory, hosts, ca)) {
    mkcert(["-cert-file", resolve(directory, "cert.pem"), "-key-file", resolve(directory, "key.pem"), ...hosts]);
    if (!developmentCertificateIsCurrent(directory, hosts, ca)) {
      throw new Error("mkcert generated an invalid or mismatched development certificate");
    }
  }
  const caFile = resolve(directory, "ca.pem");
  if (!existsSync(caFile) || !readFileSync(caFile).equals(ca)) writeFileSync(caFile, ca);
  // Nginx's master reads the leaf key before dropping worker privileges.
  // Never mount mkcert's CA private key into a container.
  chmodSync(resolve(directory, "key.pem"), 0o600);
  for (const name of ["cert.pem", "ca.pem"]) chmodSync(resolve(directory, name), 0o644);
}

export function trustDevelopmentCertificate(environment) {
  if (!environment.LINKSENSE_DEV_WEB_HTTPS_ORIGIN) return;
  const ca = readFileSync(resolve(environment.LINKSENSE_DEV_TLS_DIR, "ca.pem"), "utf8");
  // Scope trust to the launcher/watch process; keep all existing trusted roots
  // and certificate verification. No global OS or TLS-verification bypass.
  setDefaultCACertificates([...getCACertificates("default"), ca]);
}
