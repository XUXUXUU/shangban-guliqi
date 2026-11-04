# 上班鼓励器

一个本地桌面应用。按税后月薪、固定工作日和排班计算今日收入、本月累计与赚钱速度。支持暂停、午休、提成、按月满勤奖金、托盘驻留和窗口置顶。首次启动的工资为空，保存有效工资后才开始计算。

![主界面，使用隔离的验收数据](docs/screenshots/main.png)

## 下载

请从本仓库的 [Releases](../../releases) 获取已公开的正式版本。

| 平台 | 文件后缀 |
| --- | --- |
| Windows x64 | `windows-x64-setup.exe` |
| macOS Apple Silicon | `macos-arm64.dmg` |
| macOS Intel | `macos-x64.dmg` |

没有 Authenticode 发布者签名的 Windows 安装包属于未签名测试版，可能出现 SmartScreen 提示。SHA-256 用于核对文件是否一致，不能证明软件安全。macOS 使用临时签名，未做 Apple 公证，Gatekeeper 可能提示无法验证开发者。请核对来源和 Release 提供的 SHA-256。

## 从源码构建

需要 Node.js 24、npm、稳定版 Rust 和 [Tauri 2 系统依赖](https://v2.tauri.app/start/prerequisites/)。Windows 使用 MSVC 工具链和 WebView2，macOS 使用 Xcode 命令行工具。

```sh
npm ci
npm run check
npm run lint
npm test
node --test reference/earnings.test.mjs
npm run build
cargo test --locked --manifest-path src-tauri/Cargo.toml
npm run tauri dev
```

在 Windows x64 执行 `npm run tauri build -- --target x86_64-pc-windows-msvc --bundles nsis`。在 macOS 将 `--target` 设为 `aarch64-apple-darwin` 或 `x86_64-apple-darwin`，并使用 `--bundles dmg`。交叉构建前用 `rustup target add` 安装对应目标。

推送与应用版本一致的 `vX.Y.Z` 标签，Actions 在所有构建通过后生成 Draft Release。下载并核验三份安装包、完成实机验收后，再从 GitHub 发布草稿。

## 数据与许可

工资、排班、提成、满勤和暂停记录存放在系统应用数据目录的 SQLite 数据库中。升级沿用同一应用标识。先退出应用再备份数据库；安装包不含用户数据库和初始工资。

自有源码采用 [MIT 许可证](LICENSE)。正式 Logo、托盘图标及其在 `assets/logo/`、`src-tauri/icons/` 中的衍生素材保留权利，MIT 不授予这些品牌素材的再使用权。第三方依赖沿用各自许可证。
