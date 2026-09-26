# Vendored license text

`CPAL-1.0.txt` is the official text of the Common Public Attribution License
Version 1.0, byte-for-byte as published, with nothing of ours added. Our own
Exhibit A and Exhibit B are included in the repository's `LICENSE` — they are not in
this file.

`CPAL-1.0.txt.sha256` pins it. `scripts/license.test.mjs` checks the checksum and
confirms that `LICENSE` starts with this text.

## Why the text is vendored rather than downloaded

1. **Reproducibility.** The same commit must produce the same `LICENSE` on any
   machine, at any time. A build that downloads its own license text does not
   have that property.
2. **Restricted networks.** LinkSense is deployed on isolated networks, and CI
   often runs on one. A legal file should not be the reason a build fails.
3. **Silent corruption.** A site redesign, an error page returned with HTTP 200,
   or a truncated transfer would quietly contaminate a legal document. A
   checksum catches all three.

The license check runs locally and does not require network access.

## Refreshing it

Only if SPDX publishes a corrected text — the license itself is frozen.

```bash
curl -s https://spdx.org/licenses/CPAL-1.0.json \
  | python3 -c 'import json,sys; sys.stdout.write(json.load(sys.stdin)["licenseText"])' \
  > CPAL-1.0.txt
sha256sum CPAL-1.0.txt > CPAL-1.0.txt.sha256   # then commit both, and diff the old text
```

Never hand-edit either file. A one-word difference in a license can change its
meaning, and the checksum exists precisely to make hand-editing fail loudly.
