# Worker fonts / Worker 字体

Worker 镜像用开源字体替代此前打包的 Windows 字体：Liberation Sans、Liberation Serif、Carlito、Noto Sans CJK SC、Noto Serif CJK SC 和 AR PL UKai CN。它们分别用于替代 Arial、Times New Roman、Calibri、微软雅黑/黑体、宋体和楷体。Liberation、Carlito 和 Noto 使用 SIL Open Font License 1.1；AR PL UKai 使用 Arphic Public License。Ubuntu 软件包会随镜像保留各自的版权与许可文件。

所有字体均由 Ubuntu 24.04 软件仓库的软件包安装，不再从第三方 Windows 字体镜像下载。`Dockerfile.runner` 在两个 worker 目标中安装相同的软件包。`families.tsv` 记录必须存在的字体文件、家族和字重；`replacements.conf` 将文档中原有的中文字体名称映射到相应开源字体，拉丁字体由 Ubuntu 字体包映射。`verify.sh` 通过 fontconfig 校验文件和全部七项名称映射，防止字体缺失后被静默替代。

Liberation Sans、Liberation Serif 与 Carlito 分别与对应的英文字体字宽兼容；中文字体没有同等的版式兼容保证。预览已有文档时仍可能出现换行、分页和字形差异，应使用代表性文档核验。开发与生产部署指纹均包含本目录。

The worker replaces the previously bundled Windows fonts with open-source fonts: Liberation Sans, Liberation Serif, Carlito, Noto Sans CJK SC, Noto Serif CJK SC, and AR PL UKai CN. They replace Arial, Times New Roman, Calibri, Microsoft YaHei/SimHei, SimSun, and KaiTi, respectively. Liberation, Carlito, and Noto use the SIL Open Font License 1.1; AR PL UKai uses the Arphic Public License. Ubuntu package copyright and license files remain in the image.

All fonts come from Ubuntu 24.04 packages. The worker no longer downloads font binaries from third-party Windows font mirrors. Both worker targets install the same packages. `families.tsv` records required files, families, and styles. `replacements.conf` maps existing CJK font names in documents to the open-source families; Ubuntu font packages map the Latin names. `verify.sh` uses fontconfig to verify the font files and all seven name mappings, rejecting silent substitution.

Liberation Sans, Liberation Serif, and Carlito aim for metric compatibility with their Latin counterparts. The CJK replacements do not guarantee identical layout. Validate representative documents for line breaks, pagination, and glyph differences. Development and production image fingerprints include this directory.

Verification / 验证：

```sh
pnpm exec node --test scripts/worker-fonts.test.mjs
docker exec --user 1001:1000 <worker-container> sh /opt/linksense/runtime/fonts/verify.sh
```
