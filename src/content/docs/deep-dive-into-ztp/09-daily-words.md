---
title: "每日一言功能"

description: "智通平台每日一言（励志名言）的获取、展示、历史与收藏功能，及对应 API"

categories:
  - 技术解析
excerpt: 智通平台每日一言功能：HomeViewModel.getDayWords 拉取当日名言并在主页展示，DayWordsHistory/Favorites/Search 三个历史/收藏/搜索页，以及 /api/v1/pub/platform/quotations/* 系列接口。
---

# 每日一言功能

## 一、概述

智通平台每天在主页（HomeActivity）显示一句励志名言（每日一言）。该功能在登录后于 HomeViewModel 初始化时拉取当日名言，并支持历史查看、收藏、搜索。

## 二、数据实体（DayWords）

`com.xuehai.launcher.common.data.entity.DayWords`：

| 字段 | 说明 |
|------|------|
| `content` | 名言内容（`List<String>`，多行，`getDayWordsContent()` 拼接换行） |
| `source` | 名言出处/来源 |
| `date` | 日期 |
| `updateTime` | 更新时间 |
| `id` | 名言 ID |
| `collected` | 是否已收藏 |
| `collectionId` | 收藏 ID |

`DayWordsHistory`：历史列表实体（含 `number` 页号、`last` 是否最后一页）。

## 三、每日拉取（HomeViewModel.getDayWords）

`HomeViewModel` 构造函数定义 `dayWords` 流（`distinctUntilChanged`，内容变化才通知）：

```kotlin
this._dayWords = MutableStateFlow(null)
this.dayWords = lazy {
    _dayWords.distinctUntilChanged { a, b -> b != null && b.sameContent(a) }
}
```

`HomeActivity.initViewModel()` 订阅 `getDayWords()`：名言变化时调用 `loadAppPages()` 刷新页面；主页顶部 `HomeTopFragment`/`HomeDayWordHolder`/`HomeDayWordItemBinding` 渲染名言卡片。

**触发拉取**：`HomeViewModel.loadData()`（HomeActivity.init() 调用）执行 `requestDayWords()`，向服务器请求当日名言并写入 `_dayWords`。

## 四、API 端点

名言相关接口位于 `com.xuehai.launcher.message.data.MessageRemoteDataSource`：

| API | 方法 | 说明 |
|-----|------|------|
| `GET /api/v1/pub/platform/quotations/today` | GET | 拉取**当日名言**（首页展示） |
| `GET /api/v1/pub/platform/quotations/history` | GET | 拉取名言历史（分页，`MessageModel.reqDayWordsHistory`） |
| `GET /api/v1/pub/platform/quotations/collection` | GET | 拉取收藏名言列表 |
| `POST /api/v1/pub/platform/quotations/collection` | POST | 收藏名言（body 含名言 id） |
| `DELETE /api/v1/pub/platform/quotations/collection/{collectionId}` | DELETE | 取消收藏 |
| `GET /api/v1/pub/notice/{userId}` | GET | 拉取通知公告（同数据源） |

## 五、历史 / 收藏 / 搜索页面

### 5.1 DayWordsHistoryActivity

`com.xuehai.launcher.user.DayWordsHistoryActivity` + `DayWordsHistoryViewModel`：
- `initData()` → `reqDayWordsHistory(selectedYear, page, reset, needProgress)` → `MessageModel.reqDayWordsHistory(year, page, 0, 10)`（每年，每页 10 条）
- `updateSelectedYear()` — 切换年份（2022 至今年）
- `reqLoadMore()` — 分页加载（`last==false` 时继续）
- 收藏/取消收藏：`reqDayWordsCollection(id)` / `reqDayWordsDeleteCollection(collectionId)`

### 5.2 DayWordsFavoritesActivity

`DayWordsFavoritesActivity` + `DayWordsFavoritesViewModel`：
- `refreshFavoritesData()` → `reqDayWordsFavorites(page, reset)` → `MessageModel.reqDayWordsFavorites(page, 0, 5)`（每页 5 条）
- 展示收藏的名言列表

### 5.3 DayWordsSearchActivity

`DayWordsSearchActivity` + `DayWordsSearchViewModel`：搜索历史名言。

## 六、关键类清单

| 类 | 位置 | 作用 |
|----|------|------|
| `DayWords` / `DayWordsHistory` | `com.xuehai.launcher.common.data.entity` | 名言/历史实体 |
| `HomeViewModel` | `com.xuehai.launcher.home` | 每日拉取 + 桌面展示 |
| `HomeDayWordHolder` / `HomeDayWordItemBinding` | `com.xuehai.launcher.home` | 首页名言卡片渲染 |
| `DayWordsHistoryActivity` / `DayWordsFavoritesActivity` / `DayWordsSearchActivity` | `com.xuehai.launcher.user` | 历史/收藏/搜索页 |
| 对应 ViewModel | `com.xuehai.launcher.user.p035vm` | 各页面数据请求 |
| `MessageRemoteDataSource` | `com.xuehai.launcher.message.data` | 名言 API 实现 |
| `MessageModel` | `com.xuehai.launcher.common.model` | 名言请求接口（reqDayWords*） |
