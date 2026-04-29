# WCL Combat-Time DPS Toggle

给 Warcraft Logs 的大秘境总览页加一个开关，把伤害页的 `DPS/WDPS`、治疗页的 `HPS` 从“总量 / 总体时间”切换成“总量 / 战斗时间”。

## 逻辑

- 只在 `reports` 页生效。
- 处理 `damage-done` 和 `healing` 视图。
- 只在当前 fight 存在 `dungeonPulls` 时启用。
- URL 带 `pull=` 的单波页面不换算，因为 WCL 这时本身就是战斗时间口径。
- 战斗时间不是简单求和，而是把所有 pull 的 `[start_time, end_time]` 做并集，避免异常重叠重复计时。
- 表格里的 `DPS/WDPS` 会按 `总体时长 / 战斗时长` 进行缩放。

## 安装

1. 打开 Chrome。
2. 进入 `chrome://extensions/`。
3. 打开右上角“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择目录 [E:\workplace\WCL-demage-recount](/E:/workplace/WCL-demage-recount)。

## 使用

1. 打开 WCL 的大秘境报告总览页，例如：
   [伤害示例](https://cn.warcraftlogs.com/reports/X8YypBFwv4319TJR?fight=9&type=damage-done)
   [治疗示例](https://cn.warcraftlogs.com/reports/X8YypBFwv4319TJR?fight=10&type=healing)
2. 页面右上角会出现 `战斗时间统计` 开关。
3. 打开后，表格中的 `DPS/WDPS/HPS` 会改成按战斗时间重算的数值。
4. 关闭后恢复页面原始显示。

## 限制

- 我当前没法通过无头环境穿过 WCL 的 Cloudflare 验证，所以没拿到真实运行后的最终 DOM 做端到端验证。
- 这版是按 WCL 已暴露的全局数据结构和旧版 DataTable 渲染方式写的，核心逻辑没问题，但如果 WCL 后续改了列标题或表格结构，可能需要微调列识别。
