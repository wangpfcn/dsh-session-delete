# Changelog

## 0.2.0 - 2026-08-29

- 新增恢复归档会话功能。
- 会话行菜单增加“恢复全部已归档会话”。
- 工作区行菜单增加“恢复归档会话”。
- 恢复时自动放回原工作区；如果原工作区注册已删除，按会话 cwd 自动重建工作区。
- Host 新增 `POST /dsh-session-delete/restore` 与 `POST /dsh-session-delete/restore-all`。

## 0.1.0 - 2026-08-26

- 从 [vtxf/dsh-session-delete](https://github.com/vtxf/dsh-session-delete) fork 到 `wenhao4126/dsh-session-delete`。
- 保留完整功能：侧边栏单会话删除、工作区级归档全部 / 删除全部。
- 补齐 MIT LICENSE，并标注 fork 来源。
- 增加 screenshots / 基础测试 / 维护文档。
