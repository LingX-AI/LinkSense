"""Replace affected library bytecode with checksum-verified upstream patches.

Elasticsearch embeds expanded Jackson jars in IMPL-JARS in addition to ordinary
module jars. Preserve every unrelated entry and its provider listing.
"""

from __future__ import annotations

import argparse
from pathlib import Path
import shutil
import zipfile


PATCHES = {
    "jackson-core": ("2.21.6", "2.21.7", "com.fasterxml.jackson.core", "com/fasterxml/jackson/core/"),
    "jackson-databind": ("2.21.6", "2.21.7", "com.fasterxml.jackson.core", "com/fasterxml/jackson/databind/"),
    "jsoup": ("1.21.2", "1.23.2", "org.jsoup", "org/jsoup/"),
}


def metadata_path(group: str, artifact: str) -> str:
    return f"META-INF/maven/{group}/{artifact}/pom.properties"


def patch_archive(path: Path, artifact: str, replacement: Path) -> bool:
    old, new, group, classes = PATCHES[artifact]
    metadata = metadata_path(group, artifact)
    with zipfile.ZipFile(path) as source, zipfile.ZipFile(replacement) as patched:
        if f"version={new}" not in patched.read(metadata).decode():
            raise ValueError(f"Unexpected patch version for {artifact}")
        names = source.namelist()
        roots = [name.removesuffix(metadata) for name in names if name.endswith(metadata)]
        roots = [root for root in roots if f"version={old}" in source.read(root + metadata).decode()]
        if not roots:
            return False
        if any(name.startswith("META-INF/") and name.endswith((".SF", ".RSA", ".DSA")) for name in names):
            raise ValueError(f"Refusing to invalidate a signed archive: {path}")
        entries = {entry.filename: (entry, source.read(entry)) for entry in source.infolist()}
        for root in roots:
            target_root = root.replace(f"{artifact}-{old}.jar/", f"{artifact}-{new}.jar/")
            if root:
                entries = {name: item for name, item in entries.items() if not name.startswith(root)}
                for name, (entry, data) in list(entries.items()):
                    if name.endswith("LISTING.TXT"):
                        entries[name] = (entry, data.replace(f"{artifact}-{old}.jar".encode(), f"{artifact}-{new}.jar".encode()))
            else:
                # The SQL CLI embeds Jackson classes directly. Its own manifest
                # and licenses remain intact; replace the library, not the CLI.
                entries = {
                    name: item for name, item in entries.items()
                    if not name.startswith((classes, f"META-INF/maven/{group}/{artifact}/"))
                    and not (name.startswith("META-INF/versions/") and f"/{classes}" in name)
                }
            for entry in patched.infolist():
                name = entry.filename
                if not root and not (name.startswith((classes, f"META-INF/maven/{group}/{artifact}/")) or (name.startswith("META-INF/versions/") and f"/{classes}" in name) or name.startswith("META-INF/services/")):
                    continue
                if name.startswith("/") or ".." in Path(name).parts:
                    raise ValueError("Unsafe patch archive entry")
                entries[target_root + name] = (entry, patched.read(entry))
        temporary = path.with_suffix(".patched.tmp")
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED) as output:
            for name, (_, data) in entries.items():
                output.writestr(name, data)
        temporary.replace(path)
    return True


def patch_tree(root: Path, patches: Path) -> dict[str, int]:
    counts = dict.fromkeys(PATCHES, 0)
    for path in list(root.rglob("*.jar")):
        if path.is_symlink():
            raise ValueError("Refusing a symbolic-link archive")
        for artifact, (old, new, _, _) in PATCHES.items():
            replacement = patches / f"{artifact}-{new}.jar"
            if path.name == f"{artifact}-{old}.jar":
                # Verify replacement metadata before copying it into the image.
                with zipfile.ZipFile(replacement) as source:
                    if f"version={new}" not in source.read(metadata_path(PATCHES[artifact][2], artifact)).decode():
                        raise ValueError("Unexpected replacement artifact")
                destination = path.with_name(f"{artifact}-{new}.jar")
                shutil.copyfile(replacement, destination)
                path.unlink()
                counts[artifact] += 1
                break
            if patch_archive(path, artifact, replacement):
                counts[artifact] += 1
    if not all(counts.values()):
        raise ValueError(f"Incomplete Elasticsearch patch inventory: {counts}")
    return counts


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path)
    parser.add_argument("patches", type=Path)
    arguments = parser.parse_args()
    print(patch_tree(arguments.root, arguments.patches))
