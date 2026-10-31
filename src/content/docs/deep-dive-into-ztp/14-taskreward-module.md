---
title: "任务奖励模块（TaskReward）"
description: "智通平台（学生端）内嵌的 TaskReward（com.p017xh.module.taskrewardstu）模块：任务奖励/每日任务/专注训练/倒计时/时钟/学习计划(Flutter)/打卡/质量标准任务/站内信/通知/每日推荐 H5/藏宝箱/成绩单，及其独立服务器 task-reward.yunzuoye.net 与全部 API。"
categories:
  - 子系统
excerpt: 智通平台（学生端 com.xh.zhitongyunstu）内嵌一个独立功能子系统 TaskReward（com.p017xh.module.taskrewardstu），独立服务器 task-reward.yunzuoye.net，涵盖任务奖励、每日任务、专注(番茄钟)、倒计时、时钟、学习计划(含 Flutter)、打卡、质量标准任务、站内信、通知、每日推荐、藏宝箱、成绩单、相机/相册、微信分享、推送。
---

# 任务奖励模块（TaskReward）

## 一句话定位

智通平台（学生端）在 `com.xuehai.launcher` 主工程之外，内嵌了一个**独立、自洽的功能子系统**——`com.p017xh.module.taskrewardstu`（构建 flavor `module_task_reward_stu_release`）。它不是简单几个页面，而是一整套"**任务奖励 + 学习工具**"生态：学生完成**每日任务**领取奖励、查看**成绩单/藏宝箱**、参与**专注训练（番茄钟）/倒计时/时钟**、加入**学习计划（含 Flutter 版本）**、按**打卡日历**打卡、填写**质量标准任务**、收发**站内信/通知**、浏览**每日推荐 H5**，并支持**相机拍照/相册选图**与**微信分享**。

该模块**有自己的后端服务器** `https://task-reward.yunzuoye.net`（由宿主 `com.xuehai.launcher.common.base.BaseApplication#serverTypeMap` 注册 `"SA101021"` 指向，模块经 `XHMicroServer.getInstance().getActualIp("SA101021", 0)` 取基址），与主平台 REST 域 `ztp.yunzuoye.net` 相互独立。

> 模块常量 `TaskRewardStuConst.KEY_BASE_URL = "task-reward-stu"` 用于覆写/标记该模块的服务地址。

## 1. 模块入口与初始化

### 1.1 单例入口 `TaskRewardStuManager`

- 静态单例：`TaskRewardStuManager.get()`。
- `init(Application application, boolean debug, boolean platform)`：仅在**主进程**执行——
  - `VirtualKeyUtil.getNavigationBarHeight()`（读取系统导航栏高度）
  - `this.platform = platform`（记录平台标记）
  - `ARouter.init(application)` + `ARouter.openDebug()/openLog()/printStackTrace()`（debug 时）
  - `MMKVHelper.init()`（本地 KV 存储初始化）
  - `HttpRequestHelper.INSTANCE.setPrintLog(true)`（debug 时打印 HTTP 日志）
  - `initPush(application)`（注册推送接收器）
  - `TaskRewardFlutterManager.get().init(application)`（初始化 Flutter 引擎，用于学习计划页）
- `getBaseUrl()`：`XHMicroServer.getInstance().getActualIp("SA101021", 0)` → 返回 `https://task-reward.yunzuoye.net`。
- `initWXShare(context, appId)`：初始化微信分享（`TaskRewardWXShareManager`，默认 `APP_ID_PLATFORM`）。

### 1.2 主 UI 与宿主桥

- **主页面**：`com.p017xh.module.taskrewardstu.modules.main.TaskRewardFragment`（任务奖励首页 UI），配合 `TaskRewardViewModel` / `TaskRewardModel` / `TaskListController` 展示每日任务列表。
- **宿主桥** `TaskRewardAppJumpManager`（单例 `get()`）：`bindPlatformListener(OnTaskRewardPlatformListener)` 由宿主注册回调；`checkAndLaunchApp(context, packageName, defAppName, success, error)` 用于**跨应用启动**——检查目标应用是否安装，安装则调用 `safeLaunchApp` 拉起，否则经 `OnTaskRewardPlatformListener.checkLaunchApp` 交给宿主决定（例如引导安装/跳转应用市场）。
- **ARouter 路由**（`com.p017xh.module.taskrewardstu.p060const.RoutePathConst`）：

| 常量 | 路径 |
|------|------|
| `PATH_TASK_REWARD_BASE` | `/taskRewardStu` |
| `PATH_TASK_DETAIL` | `/taskRewardStu/task/detail` |
| `PATH_QUALITY_TASK_EDIT` | `/taskRewardStu/quality/edit/task` |
| `PATH_DAILY_RECOMMEND_DETAIL` | `/taskRewardStu/app/dailyRecommend` |
| `PATH_DAILY_RECOMMEND_LINK_DETAIL` | `/taskRewardStu/app/dailyRecommendLink` |
| `PATH_STUDY_PLAN_WEB` | `/taskRewardStu/app/web/studyPlan` |
| `PATH_TASK_TREASURE` | `/taskRewardStu/app/treasure` |
| `PATH_IMAGE_PREVIEW` | `/taskRewardStu/image/imagePreview` |

- **Flutter 集成**（`TaskRewardFlutterManager` / `FlutterPlanAct`）：学习计划页以 Flutter 渲染，路由 `/study-plan`（详情 `/plan/reader/detail`）、每日推荐 `/dailyRecommend`（列表 `/dailyCommend/list/stu`）。

### 1.3 推送

- `initPush` 调用 `PlatformPushBroadcastReceiver.registerPushReceiver(application, PlatformPushReceiverEventImpl.PUSH_ACTION, new PlatformPushReceiverEventImpl())`。
- `PlatformPushReceiverEventImpl` 把平台推送广播转成模块内事件，用于**打开通知列表页 / 跳转具体任务页**（例：收到新通知→拉起 `NotificationListActivity`）。

## 2. 模块功能清单（`modules/` 子模块 → 用户功能）

| 子模块 | 用户功能 | 关键类 |
|--------|---------|--------|
| `modules/main` | **任务奖励首页**（每日任务墙） | `TaskRewardFragment`, `TaskRewardViewModel`, `TaskRewardModel`, `TaskListController` |
| `modules/taskwards` | **每日任务列表 / 详情 / 成绩单 / 藏宝箱** | `TaskRewardListModel`, `TaskDetailAct`, `TranscriptsActivity`, `TaskRewardAppJumpManager` |
| `modules/usertask` | **自定义任务 / 标准任务库** | `UserTaskActivity`, `StandardTaskLibActivity`, 大量 `dialog` |
| `modules/quality` | **质量标准任务**（目录式任务） | `QualityModel`, `QualityTaskEditIAct`, `QualityTaskTipHelper`, `CatalogModel` |
| `modules/focus` | **专注训练（番茄钟）** | `FocusActivity`, `FocusEndActivity`, `StopDialog`, `FocusModel` |
| `modules/stopwatch` | **倒计时** | `StopwatchActivity` |
| `modules/clock` | **时钟** | `ClockFullActivity` |
| `modules/plan` | **学习计划**（含 Flutter） | `MyStudyPlanAct`, `StudyPlanDownHelper`, `MyStudyPlanModel`, `FlutterPlanAct` |
| `calendar` | **打卡日历**（月/年视图） | `CalendarView`, `widget/calendar`, `calendar/month`, `calendar/year` |
| `modules/message` | **站内信** | `MessageModel`, `CreateMessageReq`, `message/model`, `message/view` |
| `modules/notification` | **通知** | `NotificationListActivity`, `NotificationModel` |
| `modules/webview` | **每日推荐 / 藏宝箱 / 学习计划 H5** | `WebViewActivity`, `DailyRecommendDetailAct`, `DailyRecommendLinkDetailAct`, `StudyPlanWebAct`, `TreasureAct` |
| `camera` / `photo` | **相机拍照 / 相册选图 / 图片预览** | `GLSurfaceCameraActivity`, `ImagePreviewActivity`, `camera/dao`（本地缓存） |
| `modules/operate` | **任务操作弹窗（新增/编辑/删除）** | `OperateTaskRewardActivity`, `EditTaskRewardAct`, `operate/dialog` |
| `modules/test` | **测试计划** | `TestPlanAct` |
| `manager` | 跨应用启动、微信分享、用户管理 | `TaskRewardAppJumpManager`, `TaskRewardWXShareManager`, `UserManager`, `EventManager` |
| `guide` / `helper` / `utils` / `widget` / `base` / `ext` / `mmkv` / `pop` | 引导、业务辅助、通用工具/控件、本地存储 | `ProgressUtilsKt`, `MMKVHelper`, `SmartRefreshLayoutExtKt` 等 |

## 3. Manifest 注册的 Activity（23 个）

| Activity | 功能 |
|----------|------|
| `modules.operate.OperateTaskRewardActivity` | 任务奖励操作（新增/编辑弹窗宿主） |
| `modules.operate.EditTaskRewardAct` | 编辑任务 |
| `modules.usertask.ui.UserTaskActivity` | 我的（自定义）任务 |
| `modules.usertask.ui.StandardTaskLibActivity` | 标准任务库 |
| `modules.taskwards.TaskDetailAct` | 任务详情 |
| `modules.taskwards.TranscriptsActivity` | 成绩单 |
| `modules.quality.ui.QualityTaskEditIAct` | 质量标准任务编辑 |
| `modules.focus.FocusActivity` | 专注训练（番茄钟）主界面 |
| `modules.focus.FocusEndActivity` | 专注结束页 |
| `modules.focus.StopDialog` | 专注暂停/停止弹窗 |
| `modules.stopwatch.StopwatchActivity` | 倒计时 |
| `modules.clock.ClockFullActivity` | 全屏时钟 |
| `modules.plan.ui.MyStudyPlanAct` | 我的学习计划 |
| `modules.test.TestPlanAct` | 测试计划 |
| `flutter.ui.FlutterPlanAct` | Flutter 学习计划 |
| `modules.notification.NotificationListActivity` | 通知列表 |
| `modules.webview.WebViewActivity` | 通用 H5 容器 |
| `modules.webview.DailyRecommendDetailAct` | 每日推荐详情 |
| `modules.webview.DailyRecommendLinkDetailAct` | 每日推荐（链接）详情 |
| `modules.webview.StudyPlanWebAct` | 学习计划 H5 |
| `modules.webview.TreasureAct` | 藏宝箱 H5 |
| `camera.GLSurfaceCameraActivity` | 相机拍照 |
| `photo.ImagePreviewActivity` | 图片预览 |

> 这些 Activity 均为模块内部页面，由 ARouter 路径或 Intent 显式拉起；部分（如 `NotificationListActivity`）由推送事件或 `TaskRewardFragment` 直接 `startActivity` 打开。

## 4. HTTP 层与 API

### 4.1 请求构造

各 `*Model` 通过公共帮助方法 `getRequest(HttpRequestMethod, path)`（内部调用 `com.yzy.http.HttpRequestHelper` + `XHMicroServer` 基址）发起请求，支持 `GET/POST/PUT/DELETE`，并统一 `addParams` 附加 `studentId` / `userId` / `dayTime` / `startDateTime` 等参数。

### 4.2 端点清单（按功能分组，均以 `https://task-reward.yunzuoye.net` 为基址）

**每日任务 / 任务奖励**
- `GET  /api/v1/task/users/{studentId}/detail`（任务详情，参数 `startDateTime`、`studentTaskId`）
- `GET  /api/v3/daily/task/users/{studentId}/list`（每日任务列表，参数 `dayTime`）
- `POST /api/v2/daily/task/users/{studentId}/create`（创建每日任务）
- `POST /api/v1/daily/tasks/users/{studentId}/create`（创建每日任务）
- `PUT  /api/v2/daily/tasks/{studentTaskId}/edit/batch`（批量编辑每日任务）
- `DELETE /api/v1/daily/tasks/{studentTaskId}/delete/batch`（批量删除，参数 `deleteType`、`dayTime`、`taskId`、`userId`）
- 配套请求对象：`DailyTaskCreateRequest` / `DailyTaskEditRequest` / `DailyTaskDeleteRequest` / `DailyTaskCopyRequest` / `DailyTaskImportantRequest`（标记重要）/ `DailyTaskSelfCommentRequest`（自我点评）/ `RepeatCheckReq`（重复检查）

**专注训练（番茄钟）**
- `POST /api/v1/absorbed/studentId/{studentId}/save`（上报专注时长，body=`AbsorbedSaveRequest{duration, endTime, startDateTime, startTime, userTaskId, taskName, type, localId}`）

**质量标准任务**
- `GET  /api/v1/quality/task/info`（质量标准任务信息）
- `POST /api/v1/quality/task/users/{studentId}/create`（创建质量标准任务）
- `GET  /api/v2/quality/catalog/list`（质量标准目录列表）
- `GET  /api/v1/configure/users/{studentId}/service/code`（服务码）

**学习计划**
- `GET  /study-plan/api/v1/plans/brief/join`（已加入学习计划，参数 `studentId`、`clientType=2`）
- `GET  /api/v1/plans/students/{studentId}/finish`（计划完成，参数 `qualityId`、`childPlanId`、`startDateTime`）

**打卡日历**
- 日历数据由任务详情/每日任务列表接口返回；本地 `calendar/` 组件渲染月/年视图。

**站内信**
- `POST   /api/v1/message/users/{studentId}/create`（发站内信，body=`CreateMessageReq{UuidUtil.createLocalId(), from, to, content}`）
- `GET    /api/v1/message/users/{studentId}/list`（站内信列表，参数 `dayTime`、`studentId`、`userId`）
- `GET    /api/v1/message/users/{studentId}/read`（已读，参数 `startDateTime`、`updateTime`）
- `DELETE /api/v1/message/{msgId}/users/{studentId}/delete`（删除）

**通知**
- `GET  /api/v1/notifications/student`（通知列表，参数 `studentId`、`page`、`size=20`）
- `GET  /api/v1/notifications/students/{studentId}/unread`（未读数量）
- `PUT  /api/v1/notifications/students/{studentId}/read`（全部标记已读）

**H5 / 藏宝箱 / 成绩单**
- `GET /api/v1/configure/users/{studentId}/h5/url`（获取 H5 页面 URL，用于藏宝箱/成绩单）

**用户关系**
- `GET /api/v1/userId/{studentId}/relation`（用户关系，参数 `studentId`、`userId`）

> 数据模型：请求 POJO 见 `modules/taskwards/bean`、`modules/usertask/bean`、`modules/quality/bean|model`、`modules/plan/model`、`http/request`、`http/response`（如 `PlanDownResponse`）；本地缓存走 `MMKVHelper` 与 `camera/dao`（GreenDAO 风格 DAO）。

## 5. 跨应用启动与分享

- **跨应用拉起**：`TaskRewardAppJumpManager.checkAndLaunchApp(context, packageName, defAppName, ...)` 判断目标 App 是否安装（`checkInstalled`），已安装则 `safeLaunchApp` 直接启动，否则回退宿主 `OnTaskRewardPlatformListener.checkLaunchApp` 处理（引导安装）。这使任务奖励模块可作为**独立 App 的启动器/桥**。
- **微信分享**：`TaskRewardWXShareManager`（`initWXShare`）分享 H5 页面，默认 `APP_ID_PLATFORM`。

## 6. 安全与依赖说明

- 该模块是**宿主包内嵌**的独立命名空间（`com.p017xh.module.taskrewardstu`），非独立 APK；资源（`taskrewardstu_*`）直接编入主工程 `R`。
- 依赖 Flutter 引擎（`TaskRewardFlutterManager`）渲染学习计划，存在 `flutter/channel` 原生-JS 桥；H5 页面经 `WebViewActivity` 打开，可加载 `task-reward.yunzuoye.net` 返回的远程 URL。
- 所有写操作（创建/编辑/删除任务、发消息）均以 `studentId`/`userId` 为参数，需登录态；模块通过宿主 `XHMicroServer` 与统一签名层接入（详见 `02-signing.md`）。

> 本文档由专项分析员基于学生端（`ztps/`）反编译源码撰写。该 `com.p017xh.module.taskrewardstu` 模块在教师端（`com.xh.zhitongyuntch`，`ztp/`）中也存在且代码相同——`stu` 指该模块管理的学生端任务奖励应用，而非宿主构建变体；教师端仅通过 `serverTypeMap["SA101021"]` 指向同一 `task-reward.yunzuoye.net`。教师树另有 `com.p017xh.module.taskrewardpar`（仅含 `QualityRangeSelectView` 一个辅助控件）。