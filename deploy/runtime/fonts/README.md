# Worker fonts / Worker 字体

Worker 镜像安装微软雅黑、宋体（SimSun）、黑体（SimHei）、楷体（KaiTi）、Arial、Times New Roman 和 Calibri。微软雅黑包含常规、粗体、细体；英文字体包含常规、粗体、斜体、粗斜体，Calibri 还包含细体及细斜体。原有开源字体继续保留。

`downloads.sha256` 记录下载文件、固定 Git 提交的 HTTPS 地址及 SHA-256。字体来自第三方 Windows 字体镜像，文件内的字体名称和厂商信息已核验，但这不等同于微软官方来源认证，也不授予额外的使用或再分发许可。字体文件不存入 Git。

`install.sh` 使用 curl 下载并验证全部文件后才安装。`verify.sh` 根据 `families.tsv` 检查每个字体与字形实际匹配的文件，拒绝静默替代字体。两个 worker 构建目标均在构建时以任务用户执行检查；开发与生产部署指纹均包含本目录。

字体下载位于独立的 `font-runtime-build` 阶段，不依赖应用源码。BuildKit 的 `linksense-microsoft-fonts` 缓存按 SHA-256 和文件名保存已验证文件及 `.part` 下载进度，失败后重新构建可断点续传，源码变更无需重新下载。缓存命中仍会校验文件，损坏文件不会被安装。首次构建或清除 Docker 构建缓存后仍需联网下载。下载日志显示当前字体名称。

The worker installs Microsoft YaHei, SimSun, SimHei, KaiTi, Arial, Times New Roman and Calibri. YaHei includes regular, bold and light; the Latin families include regular, bold, italic and bold italic, with light and light italic also included for Calibri. Existing open-source fonts remain installed.

`downloads.sha256` pins each HTTPS download to a Git commit and SHA-256 checksum. Downloads come from third-party Windows font mirrors. Font names and vendor metadata have been checked; this is not official Microsoft provenance certification and grants no additional usage or redistribution rights. Font binaries are not stored in Git.

`install.sh` downloads with curl and verifies every file before installation. `verify.sh` checks each family, style and resolved file against `families.tsv`, rejecting font substitution. Both worker build targets run verification as the task user. Development and production image fingerprints include this directory.

Downloads run in the independent `font-runtime-build` stage, without application source dependencies. The `linksense-microsoft-fonts` BuildKit cache stores verified files and partial downloads by SHA-256 and filename. Rebuilding after a failure resumes `.part` files; source changes do not trigger downloads. Cached files are checked again before installation. The first build, or a build after clearing Docker's build cache, still needs network access. Download logs identify the current font.

Verification / 验证：

```sh
pnpm exec node --test scripts/worker-fonts.test.mjs
docker exec --user 1001:1000 <worker-container> sh /opt/linksense/runtime/fonts/verify.sh
```
