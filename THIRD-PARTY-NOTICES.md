# Third-party deployment components

LinkSense-owned source code is licensed under [CPAL-1.0](./LICENSE). The
standalone images below are developed by third parties and retain their own
licenses. LinkSense does not relicense them under CPAL-1.0. The release installer
pulls the upstream server and BusyBox images and the LinkSense-hardened
derivatives of the other components; the immutable image digests
in each release manifest identify the exact images installed. The tags below
describe the versions selected in `scripts/prepare-release-inputs.sh`.

| Component | Release image tag | Profile | Upstream license |
| --- | --- | --- | --- |
| PostgreSQL | `docker.io/library/postgres:16-alpine` | Core and Full | [PostgreSQL License](https://www.postgresql.org/about/licence/) |
| Redis Community Edition | `docker.io/library/redis:7.4-alpine` | Core and Full | [RSALv2 or SSPLv1](https://redis.io/legal/licenses/) |
| MinIO-compatible SILO server | `docker.io/pgsty/silo:RELEASE.2026-09-16T00-00-00Z-distroless` | Core and Full | [AGPLv3](https://github.com/pgsty/silo/blob/RELEASE.2026-09-16T00-00-00Z/LICENSE) |
| SILO `mcli` client | `docker.io/pgsty/silo:RELEASE.2026-09-16T00-00-00Z` | Core and Full, setup | [AGPLv3](https://github.com/pgsty/mc/blob/master/LICENSE) |
| BusyBox | `docker.io/library/busybox:1.37.0` | Core and Full, setup | [GPLv2](https://www.busybox.net/license.html) |
| nginx | `docker.io/library/nginx:1.30-alpine` | Core and Full | [BSD 2-Clause](https://nginx.org/LICENSE) |
| Elasticsearch official distribution | `docker.elastic.co/elasticsearch/elasticsearch-wolfi:8.19.22` | Full | [Elastic License 2.0](https://www.elastic.co/licensing/elastic-license) |
| Docling Serve | `quay.io/docling-project/docling-serve:v1.36.0` | Full | [MIT](https://github.com/docling-project/docling-serve/blob/v1.36.0/LICENSE) |

Redis 7.4 is source-available under RSALv2 or SSPLv1, rather than an
OSI-approved open-source license. The AGPLv3 option added to some Elasticsearch
**source code** does not change the license of the official distribution used
here: Elastic states that its default distribution remains under ELv2. MinIO
server and `mc` are separate AGPLv3 programs. Their licenses do not, solely by
being run as separate services, change the license of LinkSense-owned source.

The Full release also downloads the Qwen3-Embedding-4B tokenizer files pinned
in the repository's `deploy/release/tokenizer.lock.json`, which records an
Apache-2.0 license and the exact upstream revision.

Object storage uses the maintained [PGSTY SILO fork](https://github.com/pgsty/silo).
It retains the MinIO S3 protocol, configuration variables and on-disk data format.
The distroless server uses its native health check; initialization uses a separate
Alpine image containing the vendor's `mcli` binary. This is a third-party fork.

LinkSense publishes six patched derivative images under its GHCR namespace.
Its migration and Worker distributions also curate pnpm/npm bundled libraries
from integrity-locked upstream packages: http-cache-semantics 4.3.0,
brace-expansion 5.0.11 (with balanced-match 4.0.4), and undici 6.28.1.
Complete code and upstream licenses are retained; the base CLI versions are
unchanged. The reproducible build inputs are in `deploy/runtime/tooling-security`.
Their Dockerfiles are in `deploy/hardened/`: system packages receive vendor
security updates, PostgreSQL's gosu 1.19 is rebuilt with Go 1.27.1, Elasticsearch
8.19.22 receives checksum-pinned Jackson 2.21.7 and jsoup 1.23.2 bytecode, and
Docling Serve keeps the RQ backend without the unused optional Ray engine.
Original component licenses and notices remain in the images. The modified
Elasticsearch binaries retain ELv2 terms. No application data or database
migration is altered by these packaging changes.

This list covers the top-level third-party images selected by the release
scripts, not every package inside those images or the LinkSense images. Review
the upstream terms for your distribution and deployment model, especially if
you modify or redistribute an upstream image or provide one of its services
directly to others. The release manifest and the software inside each image
remain the authority for the exact installed version and its notices.
