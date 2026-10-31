---
title: 深入浅出智通平台
description: 智通平台（ztp）与 MDM 代理（zty）的逆向分析系列总目录：基于反编译源码的 19 篇分册，覆盖架构、网络、签名、文件、IPC、日志、管控、后门与自写 ztp 指南。
categories:
  - 架构总览
excerpt: 深入浅出智通平台系列总目录——按"架构 → 子系统 → 专项"组织的智通平台完整逆向规格书。
sidebar:
  label: 深入浅出智通平台
---

# 深入浅出智通平台

> 基于反编译源码（JADX）的逆向系列，分析对象：
>
> - **ztp**（智通平台，学生端 `com.xh.zhitongyunstu`，v3.125.04）——登录 + 图标墙桌面 + 应用管理 + 管控策略消费端；
> - **zty**（MDM 代理，学生端 `com.xuehai.launcher`，v1.21.06）——系统桌面（HOME）+ 设备管理员 + Knox/HEM 特权载体 + 看门狗。
>
> ⚠️ 命名交叉：zty 源码里反过来把 ztp 叫 "ZTY 客户端 / 智通云客户端"。

## 分册目录

| # | 分册 | 内容 |
|---|------|------|
| 00 | [总体架构](/docs/deep-dive-into-ztp/00-overview) | 包名/服务器/入口点/初始化链/Welcome-Home-Login 路由与子系统索引 |
| 01 | [网络子系统](/docs/deep-dive-into-ztp/01-network-api) | LRequest 抽象层、OkHttp 拦截器链、微服务 IP 下发、自研 DNS、HTTPS 加固 |
| 02 | [请求签名](/docs/deep-dive-into-ztp/02-signing) | xhcore JNI 签名算法确认与展开 |
| 03 | [本地文件与存储层](/docs/deep-dive-into-ztp/03-file-io) | SD 卡文件布局、Room/GreenDAO、内存缓存、SharedPreferences |
| 04 | [跨进程通信与推送长连接](/docs/deep-dive-into-ztp/04-ipc-ztcloud) | MyContentProvider、Messenger、自研 TCP 推送协议 |
| 05 | [日志与埋点体系](/docs/deep-dive-into-ztp/05-logging) | LogService 调度、logcat 抓取、埋点统计、XCrash 崩溃上报、用户反馈 |
| 06 | [初始化流程](/docs/deep-dive-into-ztp/06-initialization) | Application 继承链、Welcome 路由、首装/全新平板行为 |
| 07 | [应用管理子系统](/docs/deep-dive-into-ztp/07-app-management) | 应用拉取/下载/安装/更新/卸载流水线与 API |
| 08 | [夜间禁用与管控时段](/docs/deep-dive-into-ztp/08-control-night-ban) | 夜禁/考试禁用的执行引擎与时间规则 |
| 09 | [每日一言](/docs/deep-dive-into-ztp/09-daily-words) | 每日一言功能与 API |
| 10 | [远程协助](/docs/deep-dive-into-ztp/10-remote-assist) | 老师远程控制：任务轮询、ZAZE DSL 指令集、隐藏协助 |
| 11 | [后门与隐藏能力](/docs/deep-dive-into-ztp/11-backdoors) | 开发者模式、安全模式、自卸载、动态码、隐藏协助、MDM 后门 |
| 12 | [开放 SDK（Intent IPC）](/docs/deep-dive-into-ztp/12-ipc-open-sdk) | 学海系应用间分享/跳转协议与媒体对象序列化 |
| 13 | [Tinker 热修复](/docs/deep-dive-into-ztp/13-tinker-hotfix) | 补丁下发/下载/加载/回滚/上报与卸载重装行为 |
| 14 | [任务奖励模块](/docs/deep-dive-into-ztp/14-taskreward-module) | 内嵌 TaskReward 子系统入口与 API |
| 15 | [zty 与 ztp 的启动关系、看门狗与安装器](/docs/deep-dive-into-ztp/15-zty-mdm-startup) | 相互启动、文件锁看门狗、健康心跳、内置安装器、自启真相 |
| 16 | [权限分层与设备身份](/docs/deep-dive-into-ztp/16-permissions-device-identity) | 四层权限模型、AIDL/MdmService 机制、deviceId 链、登记表模型、离线动态码 |
| 17 | [一键还原、卸载重装与自写 ztp](/docs/deep-dive-into-ztp/17-reinstall-and-rewrite) | unLock 全清单、重装场景推演、数据去留、自写兼容面 |
| 99 | [入口点索引](/docs/deep-dive-into-ztp/99-entry-points-index) | Application/Activity/Service/Receiver/Provider/路由/IPC 总索引 |

## 延伸阅读

- 全量管控报告：[[ztp-control-report]]（ztp 管控策略）、[[zty-control-report]]（zty MDM 管控体系）
- 专项协议：[[xuehai-sign]]（请求签名）、[[xuehai-login-api]]（登录 API）、[[xuehai-brushcode]]（动态码/刷机码）
