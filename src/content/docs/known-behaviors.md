---
title: 已知行为记录
description: 记录一些已知的"怪行为"，供排查与参考。
badge:
  text: 示例
  variant: caution
---

> 本文是**示例内容**，用于展示文档站能力，后续由站主替换为正式内容。

这里按编号记录一些已知的"怪行为"。它们不一定都是 bug，有些是隐藏特性，有些是待确认的问题。详细追踪见 [Xuehai Feature Tracker](/tracker/)。

## 记录列表

1. **正则搜索可搜全部文件** —— 云课堂搜索框输入 `.` 会列出全部上课文件，属于隐藏的正则支持。详见 [XHPE-1001](/tracker/XHPE-1001)。

2. **作业图片偶尔加载失败** —— 智通云作业详情里图片偶发加载不出来，重进页面可恢复。详见 [XHPE-1002](/tracker/XHPE-1002)。

3. **后台切回后数据刷新延迟** —— 应用在后台挂一段时间再切回前台，部分列表数据可能短暂显示旧内容，稍等或下拉刷新即可。

## 说明

- 每条记录对应 tracker 里的一个条目，编号一致，方便对照。
- 状态以 tracker 为准（MIGHT / PARTLY VALID / VALID / CHANGED / FIXED）。
- 如果你也遇到类似情况，欢迎到 [Xuehai Feature Tracker](/tracker/) 提交新条目。