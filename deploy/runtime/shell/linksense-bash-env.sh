# This file is sourced by non-interactive Bash through BASH_ENV. Codex should
# use non-login shells, but the pinned app-server currently has an execution
# path that can still start `bash -lc`. A login shell rewrites PATH from
# /etc/profile, so restore the immutable worker PATH after all login profiles
# have run. Keep this value aligned with Dockerfile.runner and user-runtime.ts.
PATH=/opt/linksense/bin:/home/linksense/.local/share/linksense/python/.venv/bin:/home/linksense/.local/share/linksense/node/node_modules/.bin:/home/linksense/.local/share/linksense/pnpm-home:/opt/linksense/runtime/node/node_modules/.bin:/opt/linksense/runtime/python/bin:/pnpm:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH
