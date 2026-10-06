import importlib.util
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location("patcher", Path(__file__).with_name("patch-elasticsearch-jars.py"))
patcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(patcher)


class PatchTests(unittest.TestCase):
    def test_replaces_embedded_bytecode_and_provider_listing_without_losing_host_code(self):
        with tempfile.TemporaryDirectory() as directory:
            host = Path(directory) / "host.jar"
            patch = Path(directory) / "patch.jar"
            metadata = patcher.metadata_path("com.fasterxml.jackson.core", "jackson-core")
            prefix = "IMPL-JARS/x-content/jackson-core-2.21.6.jar/"
            with zipfile.ZipFile(host, "w") as archive:
                archive.writestr(prefix + metadata, "version=2.21.6\n")
                archive.writestr(prefix + "com/fasterxml/jackson/core/Old.class", b"old-bytecode")
                archive.writestr("IMPL-JARS/x-content/LISTING.TXT", "jackson-core-2.21.6.jar\nother.jar\n")
                archive.writestr("org/elasticsearch/Host.class", b"host-bytecode")
            with zipfile.ZipFile(patch, "w") as archive:
                archive.writestr(metadata, "version=2.21.7\n")
                archive.writestr("com/fasterxml/jackson/core/New.class", b"patched-bytecode")
            self.assertTrue(patcher.patch_archive(host, "jackson-core", patch))
            with zipfile.ZipFile(host) as archive:
                self.assertFalse(any(name.startswith(prefix) for name in archive.namelist()))
                self.assertEqual(archive.read("IMPL-JARS/x-content/jackson-core-2.21.7.jar/com/fasterxml/jackson/core/New.class"), b"patched-bytecode")
                self.assertEqual(archive.read("org/elasticsearch/Host.class"), b"host-bytecode")
                self.assertEqual(archive.read("IMPL-JARS/x-content/LISTING.TXT"), b"jackson-core-2.21.7.jar\nother.jar\n")

    def test_direct_embedding_preserves_main_manifest_and_rejects_wrong_patch(self):
        with tempfile.TemporaryDirectory() as directory:
            host = Path(directory) / "host.jar"
            patch = Path(directory) / "patch.jar"
            metadata = patcher.metadata_path("com.fasterxml.jackson.core", "jackson-core")
            with zipfile.ZipFile(host, "w") as archive:
                archive.writestr(metadata, "version=2.21.6\n")
                archive.writestr("com/fasterxml/jackson/core/Old.class", b"old")
                archive.writestr("META-INF/MANIFEST.MF", "Main-Class: Host\n")
            with zipfile.ZipFile(patch, "w") as archive:
                archive.writestr(metadata, "version=2.21.7\n")
                archive.writestr("com/fasterxml/jackson/core/New.class", b"new")
                archive.writestr("META-INF/MANIFEST.MF", "Main-Class: Library\n")
            patcher.patch_archive(host, "jackson-core", patch)
            with zipfile.ZipFile(host) as archive:
                self.assertEqual(archive.read("META-INF/MANIFEST.MF"), b"Main-Class: Host\n")
                self.assertNotIn("com/fasterxml/jackson/core/Old.class", archive.namelist())
            with zipfile.ZipFile(patch, "w") as archive:
                archive.writestr(metadata, "version=2.21.6\n")
            with self.assertRaises(ValueError):
                patcher.patch_archive(host, "jackson-core", patch)

    def test_signed_archive_cannot_be_silently_rewritten(self):
        with tempfile.TemporaryDirectory() as directory:
            host = Path(directory) / "host.jar"
            patch = Path(directory) / "patch.jar"
            metadata = patcher.metadata_path("com.fasterxml.jackson.core", "jackson-core")
            with zipfile.ZipFile(host, "w") as archive:
                archive.writestr(metadata, "version=2.21.6\n")
                archive.writestr("META-INF/vendor.SF", "signature")
            with zipfile.ZipFile(patch, "w") as archive:
                archive.writestr(metadata, "version=2.21.7\n")
            with self.assertRaises(ValueError):
                patcher.patch_archive(host, "jackson-core", patch)


if __name__ == "__main__":
    unittest.main()
