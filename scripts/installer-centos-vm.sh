#!/bin/bash
set -euo pipefail

edition=${1:?usage: installer-centos-vm.sh core\|full reports}
case "$edition" in core|full) ;; *) exit 64 ;; esac
[[ "${GITHUB_SHA:-}" =~ ^[0-9a-f]{40}$ ]]
reports=$(realpath -m "${2:?report directory required}")
mkdir -p "$reports"
test "$(uname -s):$(uname -m)" = Linux:x86_64
test "${RUNNER_ENVIRONMENT:-}" = github-hosted
test -c /dev/kvm || { echo 'This experimental VM requires KVM on its disposable GitHub-hosted runner.' >&2; exit 1; }
vm=$(mktemp -d)
pid=
# shellcheck disable=SC2329 # Invoked by the EXIT trap.
cleanup() {
  if [ -n "$pid" ]; then kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; fi
  rm -rf "$vm"
}
trap cleanup EXIT

image=CentOS-Stream-GenericCloud-9-20261013.0.x86_64.qcow2
curl --proto '=https' --tlsv1.2 --fail --location --retry 3 --connect-timeout 15 --max-time 600 \
  "https://cloud.centos.org/centos/9-stream/x86_64/images/$image" -o "$vm/base.qcow2"
printf '%s  %s\n' 6178901e812a08e1c36e5adac2992be65a409dfb61812a6b630b2488fc0644b3 "$vm/base.qcow2" | sha256sum -c -
qemu-img create -f qcow2 -F qcow2 -b "$vm/base.qcow2" "$vm/disk.qcow2" 70G
ssh-keygen -q -t ed25519 -N '' -f "$vm/key"
cat > "$vm/user-data" <<EOF
#cloud-config
users:
  - default
  - name: linksense-ci
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    ssh_authorized_keys:
      - $(cat "$vm/key.pub")
ssh_pwauth: false
growpart:
  mode: auto
  devices: ['/']
resize_rootfs: true
EOF
printf 'instance-id: linksense-installer-ci\nlocal-hostname: linksense-installer-ci\n' > "$vm/meta-data"
cloud-localds "$vm/seed.img" "$vm/user-data" "$vm/meta-data"
sudo chown "$(id -u):$(id -g)" /dev/kvm
qemu-system-x86_64 -enable-kvm -cpu host -smp 4 -m 12288 -display none -no-reboot \
  -drive "file=$vm/disk.qcow2,if=virtio,format=qcow2" \
  -drive "file=$vm/seed.img,format=raw,if=virtio" \
  -netdev user,id=net0,hostfwd=tcp:127.0.0.1:2222-:22 -device virtio-net-pci,netdev=net0 \
  -serial "file:$reports/vm-boot.log" > "$reports/qemu.log" 2>&1 &
pid=$!
ssh_options=(-i "$vm/key" -o BatchMode=yes -o ConnectTimeout=5 -o ServerAliveInterval=15 -o ServerAliveCountMax=4 -o StrictHostKeyChecking=accept-new -o "UserKnownHostsFile=$vm/known_hosts" -p 2222)
# shellcheck disable=SC2029 # Callers intentionally construct the guest command.
guest() { ssh "${ssh_options[@]}" linksense-ci@127.0.0.1 "$@"; }
ready=false
for ((attempt=0; attempt<90; attempt++)); do
  kill -0 "$pid"
  if guest true 2>/dev/null; then ready=true; break; fi
  sleep 5
done
test "$ready" = true
guest 'timeout 600 sudo cloud-init status --wait && sudo mkdir -p /opt/linksense-ci && sudo chown linksense-ci:linksense-ci /opt/linksense-ci'
tar -cf - --exclude=.git --exclude=node_modules --exclude=apps --exclude=packages --exclude=installation-reports \
  scripts deploy install-core.sh install-full.sh repair-core.sh repair-full.sh upgrade.sh release-assets previous-release-assets \
  | guest 'tar -xf - -C /opt/linksense-ci'
tar -cf - -C "$(dirname "$(command -v node)")" node | guest 'sudo tar -xf - -C /usr/local/bin'
guest 'sudo bash -se' <<'GUEST'
dnf install -y dnf-plugins-core openssl ca-certificates diffutils
command -v curl >/dev/null 2>&1 || dnf install -y curl
dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
sysctl -w vm.max_map_count=262144
getenforce
GUEST
status=0
guest "cd /opt/linksense-ci && sudo env PATH=/usr/local/bin:/usr/bin:/bin GITHUB_SHA='$GITHUB_SHA' /usr/local/bin/node scripts/release-installation-smoke.mjs release-assets '$edition' reports previous-release-assets" || status=$?
guest 'sudo tar -cf - -C /opt/linksense-ci/reports .' | tar -xf - -C "$reports"
exit "$status"
