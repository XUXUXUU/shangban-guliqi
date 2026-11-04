# 已确认 Logo 文件说明

- `approved-original.png`：用户已批准的原始生成图（1254×1254，RGB，带白色外边背景）。
- `app-icon-1024.png`：从**同一已确认图形**生成的 RGBA 主图（1024×1024，外围透明），作为 Tauri CLI 的输入图。不是另一个设计方案。
- `icon.ico`：多层 Windows ICO（包含16/24/32/48/64/256）。
- `icon.icns`：macOS ICNS 文件；已通过 Pillow 的 ICNS 解码打开校验，但仍需 Mac 实机检查显示。
- `app-icon-*.png`：图标多个尺寸的预先导出文件。
- `tray-dark-*` / `tray-light-*`：从已确认图形提取 ¥ 与箭头的单色轮廓，可按 macOS 菜单栏 template/light/dark 显示情况选择；细节以 16/20/22px 实机检查。
- `icon-size-preview.png`：不同尺寸辨识度的参考图。

**工程集成：**优先使用 `npm run tauri icon -- assets/logo/app-icon-1024.png` 或按实际脚本使用 `npx tauri icon assets/logo/app-icon-1024.png`，由官方工具生成 `src-tauri/icons/` 标准资源。可将现成 ICO/ICNS 作为备用及结果对比。Windows 小尺寸图标要验证 16px；Mac 菜单栏用无底的单色 ¥，不能直接把 1024px 奶油方块缩小硬塞进去。

这个图标是**生成式位图**，并非矢量源文件，不能将 PNG 改名为 SVG 或声称可无损无限缩放。
