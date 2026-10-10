import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const applicationImages = ["api", "web", "migrate", "runner", "worker"];
export const managedImages = applicationImages;
export const upstreamRoles = ["POSTGRES", "REDIS", "MINIO", "MINIO_CLIENT", "BUSYBOX", "GATEWAY", "ELASTICSEARCH", "DOCLING"];
const immutableReference = /^[a-z0-9./-]+@sha256:[0-9a-f]{64}$/u;

/** @param {string} frozenInventory @returns {Record<string,string>} */
export function finalUpstreamImages(frozenInventory) {
  const lines = readFileSync(frozenInventory, "utf8").trim().split("\n");
  const frozen = {};
  if (lines.length !== upstreamRoles.length) throw new Error("Incomplete frozen upstream inventory");
  for (const line of lines) {
    const match = /^IMAGE_([A-Z_]+)=(.+)$/u.exec(line);
    if (!match || !upstreamRoles.includes(match[1]) || Object.hasOwn(frozen, match[1]) || !immutableReference.test(match[2])) throw new Error("Invalid frozen upstream inventory");
    frozen[match[1]] = match[2];
  }
  return frozen;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  if (process.argv[2] === "names") console.log(managedImages.join(" "));
  else if (process.argv[2] === "upstream-env") {
    const images = finalUpstreamImages(process.argv[3]);
    console.log(Object.entries(images).map(([role, image]) => `IMAGE_${role}=${image}`).join("\n"));
  } else throw new Error("Unknown release image inventory command");
}
