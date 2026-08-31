import { registerHooks } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const publicProject = "/opt/linksense/runtime/node";
const userHome = process.env.HOME?.trim();
if (!userHome) {
  throw new Error("LinkSense Node.js runtime requires HOME");
}
const userProject =
  process.env.LINKSENSE_USER_NODE_PROJECT ||
  path.join(userHome, ".local", "share", "linksense", "node");

const fallbackParents = [...new Set([userProject, publicProject])].map(
  (project) => pathToFileURL(path.join(project, "__linksense_resolver__.mjs")).href,
);

function isBareSpecifier(specifier) {
  return (
    !specifier.startsWith(".") &&
    !specifier.startsWith("/") &&
    !specifier.startsWith("node:") &&
    !/^[a-zA-Z][a-zA-Z\d+.-]*:/u.test(specifier)
  );
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (originalError) {
      if (!isBareSpecifier(specifier)) throw originalError;

      for (const parentURL of fallbackParents) {
        try {
          return nextResolve(specifier, { ...context, parentURL });
        } catch {
          // Try the next managed package root before preserving the original error.
        }
      }
      throw originalError;
    }
  },
});
