# Third-party deployment components

LinkSense-owned source code is licensed under [CPAL-1.0](./LICENSE). The
standalone images below are developed by third parties and retain their own
licenses. LinkSense does not relicense them under CPAL-1.0. The release installer
pulls these images from their upstream registries; the immutable image digests
in each release manifest identify the exact images installed. The tags below
describe the versions selected in `scripts/prepare-release-inputs.sh`.

| Component | Release image tag | Profile | Upstream license |
| --- | --- | --- | --- |
| PostgreSQL | `docker.io/library/postgres:16.10-alpine3.22` | Core and Full | [PostgreSQL License](https://www.postgresql.org/about/licence/) |
| Redis Community Edition | `docker.io/library/redis:7.4.5-alpine3.21` | Core and Full | [RSALv2 or SSPLv1](https://redis.io/legal/licenses/) |
| MinIO server | `quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z` | Core and Full | [AGPLv3](https://github.com/minio/minio/blob/RELEASE.2025-09-07T16-13-09Z/LICENSE) |
| MinIO client (`mc`) | `quay.io/minio/mc:RELEASE.2025-08-13T08-35-41Z` | Core and Full, setup | [AGPLv3](https://github.com/minio/mc/blob/master/LICENSE) |
| BusyBox | `docker.io/library/busybox:1.37.0` | Core and Full, setup | [GPLv2](https://www.busybox.net/license.html) |
| nginx | `docker.io/library/nginx:1.28.0-alpine3.21` | Core and Full | [BSD 2-Clause](https://nginx.org/LICENSE) |
| Elasticsearch official distribution | `docker.elastic.co/elasticsearch/elasticsearch:8.19.2` | Full | [Elastic License 2.0](https://www.elastic.co/licensing/elastic-license) |
| Docling Serve | `quay.io/docling-project/docling-serve:v1.27.0` | Full | [MIT](https://github.com/docling-project/docling-serve/blob/v1.27.0/LICENSE) |

Redis 7.4 is source-available under RSALv2 or SSPLv1, rather than an
OSI-approved open-source license. The AGPLv3 option added to some Elasticsearch
**source code** does not change the license of the official distribution used
here: Elastic states that its default distribution remains under ELv2. MinIO
server and `mc` are separate AGPLv3 programs. Their licenses do not, solely by
being run as separate services, change the license of LinkSense-owned source.

The Full release also downloads the Qwen3-Embedding-4B tokenizer files pinned
in the repository's `deploy/release/tokenizer.lock.json`, which records an
Apache-2.0 license and the exact upstream revision.

This list covers the top-level third-party images selected by the release
scripts, not every package inside those images or the LinkSense images. Review
the upstream terms for your distribution and deployment model, especially if
you modify or redistribute an upstream image or provide one of its services
directly to others. The release manifest and the software inside each image
remain the authority for the exact installed version and its notices.
