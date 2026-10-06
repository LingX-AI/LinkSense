import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const applicationImages = ["api", "web", "migrate", "runner", "worker"];
export const hardenedImages = {
  POSTGRES: "postgres", REDIS: "redis", MINIO_CLIENT: "minio-client",
  GATEWAY: "gateway", ELASTICSEARCH: "elasticsearch", DOCLING: "docling",
};
export const managedImages = [...applicationImages, ...Object.values(hardenedImages)];
const upstreamRoles = ["POSTGRES", "REDIS", "MINIO", "MINIO_CLIENT", "BUSYBOX", "GATEWAY", "ELASTICSEARCH", "DOCLING"];
const immutableReference = /^[a-z0-9./-]+@sha256:[0-9a-f]{64}$/u;

/** @param {string} imageDirectory @param {string} frozenInventory @returns {Record<string,string>} */
export function finalUpstreamImages(imageDirectory, frozenInventory) {
  const lines = readFileSync(frozenInventory, "utf8").trim().split("\n");
  const frozen = {};
  if (lines.length !== upstreamRoles.length) throw new Error("Incomplete frozen upstream inventory");
  for (const line of lines) {
    const match = /^IMAGE_([A-Z_]+)=(.+)$/u.exec(line);
    if (!match || !upstreamRoles.includes(match[1]) || Object.hasOwn(frozen, match[1]) || !immutableReference.test(match[2])) throw new Error("Invalid frozen upstream inventory");
    frozen[match[1]] = match[2];
  }
  return Object.fromEntries(upstreamRoles.map(role => {
    const reference = role in hardenedImages ? readFileSync(join(imageDirectory, hardenedImages[role]), "utf8").trim() : frozen[role];
    if (!immutableReference.test(reference)) throw new Error(`Missing immutable final image for ${role}`);
    return [role, reference];
  }));
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  if (process.argv[2] === "names") console.log(managedImages.join(" "));
  else if (process.argv[2] === "upstream-env") {
    const images = finalUpstreamImages(process.argv[3], process.argv[4]);
    console.log(Object.entries(images).map(([role, image]) => `IMAGE_${role}=${image}`).join("\n"));
  } else throw new Error("Unknown release image inventory command");
}
