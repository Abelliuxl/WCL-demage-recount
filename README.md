# WCL Combat-Time DPS Toggle

Switch DPS/HPS in Warcraft Logs Mythic+ report pages from overall-time baseline to combat-time baseline.  
将 Warcraft Logs 大秘境报告中的 DPS/HPS 统计口径从总体时长切换为战斗时长。

## 中文说明

### 插件功能

这个扩展会在 Warcraft Logs 报告页面（`/reports/*`）注入一个悬浮开关。  
开启后，它会把：
- 伤害页的 `DPS/WDPS`
- 治疗页的 `HPS`

按战斗时长重算并显示，便于更准确评估每波战斗期间的实际表现。

### 核心逻辑

- 仅在 `reports` 页面生效。
- 仅处理 `damage-done` 与 `healing` 视图。
- 仅在当前 fight 存在 `dungeonPulls` 时可用。
- 如果 URL 带 `pull=`（单波详情），不进行换算，因为该场景本身已是战斗时长口径。
- 战斗时长不是简单相加，而是对所有 pull 的 `[start_time, end_time]` 做区间并集，避免重叠重复计时。
- 换算倍率为：`总体时长 / 战斗时长`，用于缩放 `DPS/WDPS/HPS` 列。

### 安装方式（Chrome）

1. 打开 `chrome://extensions/`。
2. 打开右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本项目目录。

### 使用方法

1. 打开 WCL 大秘境报告总览页，例如：
   - [伤害示例](https://cn.warcraftlogs.com/reports/X8YypBFwv4319TJR?fight=9&type=damage-done)
   - [治疗示例](https://cn.warcraftlogs.com/reports/X8YypBFwv4319TJR?fight=10&type=healing)
2. 页面右上角会显示“战斗时间统计”开关。
3. 开启后，表格中的 `DPS/WDPS/HPS` 将切换为战斗时长重算值。
4. 关闭后，恢复 Warcraft Logs 原始显示。

### 权限与隐私

- 权限：仅使用 `storage`，用于保存开关状态和悬浮面板位置。
- 语言：悬浮框文案会按浏览器 UI 语言自动识别（`zh*` 显示中文，其它显示英文）。
- 配置：在 `manifest.json` 使用 `default_locale`，并提供 `_locales/en/messages.json` 与 `_locales/zh_CN/messages.json`。
- 不采集个人信息，不上传报告数据到第三方服务。
- 详见隐私政策：[PRIVACY_POLICY.md](./PRIVACY_POLICY.md)

### 已知限制

- 由于 Cloudflare 验证限制，当前未在无头环境完成端到端 DOM 验证。
- 该实现依赖 WCL 当前暴露的数据结构与表格渲染方式；如果 WCL 后续改动列标题或 DOM 结构，可能需要调整列识别逻辑。

## English Guide

### What This Extension Does

This extension injects a floating toggle into Warcraft Logs report pages (`/reports/*`).  
When enabled, it recalculates:
- `DPS/WDPS` on damage views
- `HPS` on healing views

using combat-time baseline, so Mythic+ performance is measured by active combat time instead of total run time.

### Core Logic

- Active only on report pages.
- Supports `damage-done` and `healing` views.
- Enabled only when the selected fight contains `dungeonPulls`.
- Skips conversion when `pull=` is present in URL (single pull pages already use combat-time style context).
- Combat duration is computed by interval union of all pull `[start_time, end_time]`, not naive summation.
- Scale factor is: `overall duration / combat duration`, applied to `DPS/WDPS/HPS` columns.

### Installation (Chrome)

1. Open `chrome://extensions/`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this project folder.

### Usage

1. Open a WCL Mythic+ report overview page, for example:
   - [Damage example](https://cn.warcraftlogs.com/reports/X8YypBFwv4319TJR?fight=9&type=damage-done)
   - [Healing example](https://cn.warcraftlogs.com/reports/X8YypBFwv4319TJR?fight=10&type=healing)
2. Find the **Combat-Time Stats** toggle at the top-right.
3. Turn it on to switch `DPS/WDPS/HPS` to combat-time recalculated values.
4. Turn it off to restore original Warcraft Logs values.

### Permissions & Privacy

- Permission used: `storage` only (toggle state and widget position persistence).
- Language: floating widget text is auto-selected by browser UI language (`zh*` => Chinese, otherwise English).
- Config: localization is declared via `default_locale` in `manifest.json` with `_locales/en/messages.json` and `_locales/zh_CN/messages.json`.
- No personal data collection and no third-party data transmission.
- See full policy: [PRIVACY_POLICY.md](./PRIVACY_POLICY.md)

### Known Limitations

- End-to-end DOM validation could not be completed in headless environment due to Cloudflare verification.
- The implementation depends on current WCL-exposed globals and table structure; future WCL UI/DOM changes may require selector/header matching updates.
