---
title: "竞技场API"
description: 学海题舟竞技场API解析
categories:
  - 技术解析
excerpt: 学海题舟竞技场API解析
badge:
  text: 示例
  variant: note
---
# 竞技场（PK / 对战 / 赛事）API 文档

> 本文档基于对逆向工程源码的静态分析整理，梳理了应用内"竞技场"（PK 对战 / 赛事竞赛）相关功能的全部网络 API 接口。
>
> **代码路径**：`sources/com/p039xh/abrustu/networkapi/`
>
> **说明**：竞技场在代码中被拆分为两大体系：
> 1. **PK 对战（即时对战/单人对战）** —— `PkApi` / `PkGameApi`（接口），对应实现 `PkHomeApiImpl` / `PkGameApiImpl`。
> 2. **赛事/竞赛（Cpt，如晋级赛、海选赛）** —— `CptGameApi`（接口），对应实现 `CptGameApiImpl`。

---

## 一、通用约定

### 1.1 请求封装机制

所有竞技场请求都继承自基类 `BaseBrushApiImpl`（文件：`BaseBrushApiImpl.java`），统一经由
`XHBaseRequestProxy`（OkHttp 封装）发送。核心方法：

| 方法 | HTTP 方法 | 说明 |
|------|-----------|------|
| `getRequest(serverType, url, Map<String,String> query, listener)` | GET | 带 query 参数的 GET 请求 |
| `getRequest(serverType, url, Object bean, listener)` | GET | 以对象字段作为 query 参数的 GET 请求 |
| `postRequest(serverType, url, Object body, listener)` | POST | JSON 请求体 POST |
| `postBooleanRequest(serverType, url, Object body, listener)` | POST | POST，成功时回调 `onSuccess(true)` |

- 所有接口都要求**用户已登录**（`checkUserNotEmpty()`），否则直接返回不发请求。
- 请求回调统一为 `AbstractOnApiListener<T>`：成功 `onSuccess(T)` / 失败 `onError(RequestFailBean)`。
- **服务类型码（serverType）**：竞技场全部使用 `"SA101010"`。
- 返回结构为通用响应体 `BaseResponseBeanHelper.BaseResponseBean`（即 `code/message/data` 包装）。

### 1.2 路径变量说明

- `{studentId}` / `{userId}`：当前登录学生 ID，来自 `UserManager.getInstance().getUserId()`（多数接口为字符串）。
- `{subjectId}`：学科 ID。
- `{matchId}`：赛事 ID。
- `{pkId}`：PK 对局 ID。
- `{season}`：赛季。

---

## 二、PK 对战 —— 首页 / 基础接口（`PkApi`）

**接口文件**：`PkApi.java`　**实现文件**：`PkHomeApiImpl.java`　**单例入口**：`PkHomeApiImpl.getPkApi()`

### 2.1 首页数据

| 项 | 值 |
|----|-----|
| 方法 | `homePage(listener)` |
| 说明 | 获取竞技场首页全部信息（赛季、段位、胜率、门票、头像、赛事等） |
| HTTP | GET |

**请求路径**：`/api/v1/pk/user/{studentId}/home/page`

**请求参数（Query）**

| 参数 | 类型 | 说明 |
|------|------|------|
| `pictureUpdateTime` | String | 图片更新时间，固定传 `"0"` |
| `studentId` | String | 学生 ID |

**响应体**：`PkHomeEntity`

| 字段 | 类型 | 说明 |
|------|------|------|
| `season` | int | 当前赛季 |
| `seasonName` | String | 赛季名称 |
| `startTime` / `endTime` | Long | 赛季起止时间 |
| `nextSeasonTime` | Long | 下一赛季时间 |
| `studentId` | Long | 学生 ID |
| `totalCount` / `victoryCount` | Integer | 总场数 / 胜场数 |
| `victoryRate` | String | 胜率 |
| `ticketTotal` / `ticketCount` | Integer | 门票总数 / 剩余门票 |
| `subjectIdList` | List\<Integer> | 可选学科 ID 列表 |
| `headImg` / `honorImg` | List\<String> | 头像 / 荣誉图集 |
| `seasonDtoList` | List\<SeasonDtoList> | 赛季列表（season/seasonName） |
| `studentDanLevelDto` | StudentDanLevelDto | 学生段位（danLevel/danLevelName/danCount/img） |
| `studentExperienceDto` | StudentExperienceDto | 学生经验（level/molecular/denominator） |
| `danLevelConfigDtoList` | List\<DanLevelConfigDtoListBean> | 段位配置列表 |
| `pictureConfigDtoList` | List\<PictureConfigDtoListBean> | 头像图片配置 |
| `titleLevelConfigDtoList` | List\<TitleBean> | 称号配置列表 |
| `pkMatchResponse` | PkMatchResponse | 进行中的赛事（matchId/matchType/name/roundNumber/startTime/totalRound） |

### 2.2 全部可带头像

| 项 | 值 |
|----|-----|
| 方法 | `pictureAll(listener)` |
| 说明 | 获取全部可选（已获得）头像图 |
| HTTP | GET |

**请求路径**：`/api/v1/pk/picture/student/{studentId}/picture/all`

**请求参数（Query）**

| 参数 | 类型 | 说明 |
|------|------|------|
| `type` | String | 固定传 `"1"` |

**响应体**：泛型 `T`（调用处反序列化为 `SelectableBadgeData`，即可选头像徽章数据）

### 2.3 设置头像

| 项 | 值 |
|----|-----|
| 方法 | `headPortrait(season, id, listener)` |
| 说明 | 设置当前佩戴头像 |
| HTTP | GET |

**请求路径**：`/api/v1/pk/picture/student/{studentId}/add/head/portrait`

**请求参数（Query）**

| 参数 | 类型 | 说明 |
|------|------|------|
| `id` | String | 头像图片 ID |
| `season` | String | 赛季 |

**响应体**：`Boolean`

### 2.4 匹配检测（开始 PK 前检查）

| 项 | 值 |
|----|-----|
| 方法 | `matching(listener)` |
| 说明 | 检测当前是否处于匹配/对局状态，决定能否发起新对局 |
| HTTP | GET |

**请求路径**：`/api/v1/pk/check/student/{studentId}/matching`

**请求参数**：无

**响应体**：`MatchingEntity`（仅 `code` / `message`）

### 2.5 提交对战结果

| 项 | 值 |
|----|-----|
| 方法 | `submitGame(PkStudentGameBean, listener)` |
| 说明 | 提交一局 PK 对战结果 |
| HTTP | POST |

**请求路径**：`/api/v1/pk/game/student/{studentId}/game/result`

**请求体**：`PkStudentGameBean`（JSON），提交时会自动注入 `studentId`，并剔除 `tagDescription` 字段。主要字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `pkId` | String | 对局 ID |
| `kId` | Long | 场次 key ID |
| `pkPattern` | Integer | 对战模式 |
| `subjectId` | Integer | 学科 ID |
| `studentId` | Integer | 学生 ID（自动注入） |
| `robotPk` | Boolean | 是否机器人对战 |
| `status` | Integer | 对局状态 |
| `createTime` / `endTime` / `countTimer` | Long | 时间相关 |
| `rivalProgress` / `rivalQuestionTime` | Integer/Long | 对手进度/答题时间 |
| `robotRightCount` / `robotTimeConsuming` | Integer/Long | 机器人答对题数/耗时 |
| `users` | List\<PkUserBean> | 参与用户 |
| `questions` / `pkQuestionDtoList` | List\<PkQuestionBean> | 题目列表 |
| `robotQuestionRightList` | List\<Integer> | 机器人答对题目下标 |

**响应体**：`String`

### 2.6 获取对局服务器信息（Socket 房间）

| 项 | 值 |
|----|-----|
| 方法 | `serverId(listener)` |
| 说明 | 获取用于建立实时对战 Socket 连接的服务器信息（appId/roomId） |
| HTTP | GET |

**请求路径**：`/api/v1/pk/users/{studentId}/td`

**请求参数**：无

**响应体**：`ServerIdEntity`（`appId` / `roomId` / `userId`）

### 2.7 再来一局

| 项 | 值 |
|----|-----|
| 方法 | `again(subjectId, listener)` |
| 说明 | 申请同一学科再来一局 |
| HTTP | GET |

**请求路径**：`/api/v1/pk/check/student/{studentId}/again?subjectId={subjectId}`

**请求参数（Query）**：`subjectId`（学科 ID，拼入 URL）

**响应体**：`BaseResponseBeanHelper.BaseResponseBean`

### 2.8 远程取题

| 项 | 值 |
|----|-----|
| 方法 | `getRemoteWord(tagCode, listener)` |
| 说明 | 根据知识点标签远程获取单个 PK 题目 |
| HTTP | GET |

**请求路径**：`/api/v1/question/question/users/{studentId}/tags/{tagCode}`

**请求参数**：`tagCode` 拼入路径

**响应体**：`PkQuestionBean`

### 2.9 激励弹窗列表

| 项 | 值 |
|----|-----|
| 方法 | `getPopupList(listener)` |
| 说明 | 获取竞技场激励/弹窗列表 |
| HTTP | GET |

**请求路径**：`/api/v1/match/student/{studentId}/popup/list`

**请求参数**：无

**响应体**：`List<MatchInspirePopupBean>`

### 2.10 激励弹窗修复

| 项 | 值 |
|----|-----|
| 方法 | `getPopupFix(matchId, oldImgUrl, newImgUrl, listener)` |
| 说明 | 上报弹窗图片加载失败并修复 |
| HTTP | GET |

**请求路径**：`/api/v1/match/student/{studentId}/popup/fix`

**请求参数（Query）**

| 参数 | 类型 | 说明 |
|------|------|------|
| `matchId` | String | 赛事 ID |
| `oldImgUrl` | String | 失败图片 URL |
| `newImgUrl` | String | 修复后图片 URL |

**响应体**：`String`

---

## 三、PK 对战 —— 对局数据接口（`PkGameApi`）

**接口文件**：`PkGameApi.java`　**实现文件**：`PkGameApiImpl.java`　**单例入口**：`PkGameApiImpl.getPkGameApi()`

### 3.1 检查是否有作业

| 项 | 值 |
|----|-----|
| 方法 | `checkHomeWork(listener)` |
| 说明 | 检查用户是否有未完成的作业 |
| HTTP | GET |

**请求路径**：`/api/v1/pk/check/student/{studentId}/homeWork`

**请求参数**：无　**响应体**：`BaseResponseBeanHelper.BaseResponseBean`

### 3.2 检查赛季封禁

| 项 | 值 |
|----|-----|
| 方法 | `checkSeasonBan(subjectId, listener)` |
| 说明 | 检查某学科在当前赛季是否被封禁 |
| HTTP | GET |

**请求路径**：`/api/v1/pk/check/student/{studentId}/season/ban?subjectId={subjectId}`

**请求参数（Query）**：`subjectId`　**响应体**：`BaseResponseBeanHelper.BaseResponseBean`

### 3.3 可对战学科列表

| 项 | 值 |
|----|-----|
| 方法 | `getPkSubjectData(listener)` |
| 说明 | 获取竞技场可选学科 |
| HTTP | GET |

**请求路径**：`/api/v1/pk/user/{studentId}/home/subject?studentId={studentId}`

**请求参数（Query）**：`studentId`

**响应体**：`List<ChooseSubjectBean>`

### 3.4 排名数据

| 项 | 值 |
|----|-----|
| 方法 | `getPkRankData(PkRankRequest, listener)` |
| 说明 | 获取 PK 排行榜 |
| HTTP | GET |

**请求路径**：`/api/v1/pk/rank/user/{studentId}`

**请求参数（Query，取自 `PkRankRequest` 对象）**

| 参数 | 类型 | 说明 |
|------|------|------|
| `classId` | String | 班级 ID |
| `season` | int | 赛季 |
| `rankType` | int | 榜单类型 |
| `rankKind` | int | 榜单细分类型 |

**响应体**：`PkRankRespBean`

| 字段 | 类型 | 说明 |
|------|------|------|
| `rankKind` | Integer | 榜单细分类型 |
| `rankType` | Integer | 榜单类型 |
| `pkRankStudentList` | List\<PkRankBean> | 榜单学生列表 |
| `studentSingInRank` | PkRankBean | 当前学生在榜信息 |

### 3.5 对局结果

| 项 | 值 |
|----|-----|
| 方法 | `getPkGameResultData(studentId, pkId, listener)` |
| 说明 | 获取一局 PK 对局的结算结果 |
| HTTP | GET |

**请求路径**：`/api/v1/pk/game/user/{studentId}/game/result`

**请求参数（Query）**

| 参数 | 类型 | 说明 |
|------|------|------|
| `studentId` | String | 学生 ID |
| `pkId` | String | 对局 ID |

**响应体**：`PkGameResultBean`（段位变化 `danChange/danLevel/danName`、经验变化 `experienceChange/experienceLevel`、结果 `result`、答对题数 `rightCount`、双方题目结果列表、`timeConsuming`、`title`、`passiveContest`、`rivalStudentHeaderInfoList`、`hideScore` 等）

### 3.6 对战历史

| 项 | 值 |
|----|-----|
| 方法 | `getPkGameHistoryData(subjectId, page, size, 未用参数, listener)` |
| 说明 | 获取对战历史列表（分页） |
| HTTP | GET |

**请求路径**：`/api/v1/pk/game/user/{studentId}/game/history`

**请求参数（Query）**

| 参数 | 类型 | 说明 |
|------|------|------|
| `studentId` | int | 学生 ID |
| `subjectId` | int | 学科 ID |
| `page` | int | 页码 |
| `size` | int | 每页条数 |

**响应体**：`List<FightHistoryBean>`

> 注：方法签名为 `getPkGameHistoryData(String, int, int, int, listener)`，其中第一个 String 参数在实现中未使用。

### 3.7 对局题目列表

| 项 | 值 |
|----|-----|
| 方法 | `getPkQuestionListData(gameId, listener)` |
| 说明 | 根据对局 ID 获取题目列表及知识点标签 |
| HTTP | GET |

**请求路径**：`/api/v1/pk/game/user/{studentId}/game/question`

**请求参数（Query）**

| 参数 | 类型 | 说明 |
|------|------|------|
| `gameId` | String | 对局 ID |

**响应体**：`PkQuestionListBean`（`pkQuestionInfoDtoList`：题目列表；`tagDtoList`：知识点标签列表）

### 3.8 数据恢复（断线重连）

| 项 | 值 |
|----|-----|
| 方法 | `recoverData(pkId, listener)` |
| 说明 | 断线后恢复 PK 对局进度 |
| HTTP | GET |

**请求路径**：`/api/v1/pk/student/{studentId}/date/restoration?pkId={pkId}`

**请求参数（Query）**：`pkId`

**响应体**：`PkStudentGameBean`

### 3.9 连接检测

| 项 | 值 |
|----|-----|
| 方法 | `connectionCheck(pkId, listener)` |
| 说明 | 对局开始前做连接检测 |
| HTTP | GET |

**请求路径**：`/api/v1/pk/student/{studentId}/connection/check?pkId={pkId}`

**请求参数（Query）**：`pkId`

**响应体**：`ConnectionCheckResponse`

---

## 四、赛事 / 竞赛接口（`CptGameApi`）

**接口文件**：`CptGameApi.java`　**实现文件**：`CptGameApiImpl.java`　**单例入口**：`CptGameApiImpl.getCptGameApi()`

### 4.1 晋级排名

| 项 | 值 |
|----|-----|
| 方法 | `getMatchRank(CptMatchRankRequest, listener)` |
| 说明 | 获取赛事某轮晋级排名 |
| HTTP | GET |

**请求路径**：`/api/v1/match/user/{studentId}/match/promotion/rank`

**请求参数（Query，取自 `CptMatchRankRequest`）**

| 参数 | 类型 | 说明 |
|------|------|------|
| `studentId` | long | 学生 ID |
| `matchId` | String | 赛事 ID |
| `roundNumber` | int | 轮次 |

**响应体**：`RoundRankResponse`

### 4.2 决赛排名

| 项 | 值 |
|----|-----|
| 方法 | `getMatchFinalRank(matchId, listener)` |
| 说明 | 获取赛事最终（决赛）排名 |
| HTTP | GET |

**请求路径**：`/api/v1/match/user/{studentId}/match/final/rank`

**请求参数（Query）**

| 参数 | 类型 | 说明 |
|------|------|------|
| `studentId` | String | 学生 ID |
| `matchId` | String | 赛事 ID |

**响应体**：`RoundRankResponse`

### 4.3 提交赛事对局结果

| 项 | 值 |
|----|-----|
| 方法 | `updateCptGame(CompetitionGameBean, listener)` |
| 说明 | 提交一局赛事对局结果 |
| HTTP | POST |

**请求路径**：`/api/v1/match/student/{studentId}/game/result`

**请求体**：`CompetitionGameBean`（JSON），自动注入 `studentId`。主要字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `kId` | Long | 场次 key ID |
| `matchId` | String | 赛事 ID |
| `pkId` | String | 对局 ID |
| `userId` / `studentId` | Integer/Long | 用户/学生 ID |
| `userName` / `schoolName` | String | 用户名 / 学校名 |
| `users` | List\<PkUserBean> | 参与用户 |
| `pattern`(pkPattern) | Integer | 模式 |
| `status` | Integer | 对局状态 |
| `totalRight` | Integer | 总答对数 |
| `totalScore` | Double | 总分 |
| `userProgress`(rivalInfoDtoList) | List\<PkUserProgressBean> | 对手进度 |
| `questions` | List\<CompetitionQuestionBean> | 题目列表 |
| `portraitUrl` | String | 头像 URL |

**响应体**：`Boolean`

### 4.4 放弃比赛

| 项 | 值 |
|----|-----|
| 方法 | `giveUpMatch(matchId, pkId, listener)` |
| 说明 | 放弃当前赛事对局 |
| HTTP | GET |

**请求路径**：`/api/v1/match/student/{studentId}/match/give/up`

**请求参数（Query）**

| 参数 | 类型 | 说明 |
|------|------|------|
| `matchId` | String | 赛事 ID |
| `pkId` | String | 对局 ID |

**响应体**：`String`

### 4.5 赛事数据恢复（断线重连）

| 项 | 值 |
|----|-----|
| 方法 | `recoverData(pkId, matchId, listener)` |
| 说明 | 断线后恢复赛事对局进度 |
| HTTP | GET |

**请求路径**：`/api/v1/match/student/{studentId}/date/restoration`

**请求参数（Query）**

| 参数 | 类型 | 说明 |
|------|------|------|
| `pkId` | String | 对局 ID |
| `matchId` | String | 赛事 ID |

**响应体**：`MatchDataRestorationResponse`

### 4.6 赛事连接检测

| 项 | 值 |
|----|-----|
| 方法 | `connectionCheck(matchId, pkId, listener)` |
| 说明 | 赛事对局开始前连接检测 |
| HTTP | GET |

**请求路径**：`/api/v1/match/student/{studentId}/race/connection/check`

**请求参数（Query）**

| 参数 | 类型 | 说明 |
|------|------|------|
| `matchId` | String | 赛事 ID |
| `pkId` | String | 对局 ID |

**响应体**：`MatchConnectionCheckResponse`

### 4.7 赛事题目与结果

| 项 | 值 |
|----|-----|
| 方法 | `getMatchQuestionListData(CptMatchQuestionRequest, listener)` |
| 说明 | 获取赛事某轮题目/作答结果信息 |
| HTTP | GET |

**请求路径**：`/api/v2/match/user/{studentId}/game/result/info`（注意为 **v2**）

**请求参数（Query，取自 `CptMatchQuestionRequest`）**

| 参数 | 类型 | 说明 |
|------|------|------|
| `studentId` | long | 学生 ID |
| `matchId` | String | 赛事 ID |
| `round` | int | 轮次 |
| `scene` | int | 场景 |

**响应体**：`List<MatchResultInfoResponse>`

### 4.8 最近赛事

| 项 | 值 |
|----|-----|
| 方法 | `checkRecentMatch(listener)` |
| 说明 | 检查用户是否有进行中的赛事 |
| HTTP | GET |

**请求路径**：`/api/v1/match/student/{studentId}/recent/match`

**请求参数（Query）**

| 参数 | 类型 | 说明 |
|------|------|------|
| `time` | String | 时间窗口，固定传 `"300000"`（毫秒，即 5 分钟） |

**响应体**：`PkHomeEntity.PkMatchResponse`

### 4.9 奖励体力

| 项 | 值 |
|----|-----|
| 方法 | `rewardHp(matchId, listener)` |
| 说明 | 赛事中领取奖励体力 |
| HTTP | GET |

**请求路径**：`/api/v1/match/{matchId}/student/{studentId}/reward/hp`

**请求参数**：`matchId` 拼入路径

**响应体**：`Integer`（体力值）

### 4.10 海选列表（排名）

| 项 | 值 |
|----|-----|
| 方法 | `auditionList(matchId, listener)` |
| 说明 | 获取某赛事海选排名列表 |
| HTTP | GET |

**请求路径**：`/api/v1/match/{matchId}/user/{studentId}/audition/list`

**请求参数**：`matchId` 拼入路径

**响应体**：`MatchAuditionRankResponse`

### 4.11 海选历史

| 项 | 值 |
|----|-----|
| 方法 | `auditionHistory(matchId, pageNum, pageSize, listener)` |
| 说明 | 获取赛事海选详情/历史（分页） |
| HTTP | GET |

**请求路径**：`/api/v1/match/user/{studentId}/match/audition/detail/info`

**请求参数（Query）**

| 参数 | 类型 | 说明 |
|------|------|------|
| `matchId` | String | 赛事 ID |
| `pageNum` | String | 页码 |
| `pageSize` | String | 每页条数 |

**响应体**：`String`

### 4.12 保存承诺书（Commitment）

| 项 | 值 |
|----|-----|
| 方法 | `saveCommitment(matchId, roundNumber, url, listener)` |
| 说明 | 提交某轮承诺书（含音频 URL） |
| HTTP | POST |

**请求路径**：`/api/v1/match/{matchId}/student/{studentId}/save/commitment`

**请求体**：`CptCommitmentRequest`（JSON）

| 字段 | 类型 | 说明 |
|------|------|------|
| `commitmentList` | List\<CommitmentListRequest> | 承诺书列表 |
| └ `roundNumber` | Integer | 轮次 |
| └ `url` | String | 承诺书文件 URL |

**响应体**：`Boolean`

### 4.13 查询承诺书

| 项 | 值 |
|----|-----|
| 方法 | `findCommitment(matchId, roundNumber, listener)` |
| 说明 | 查询某轮承诺书信息 |
| HTTP | GET |

**请求路径**：`/api/v1/match/user/{studentId}/commitment`

**请求参数（Query）**

| 参数 | 类型 | 说明 |
|------|------|------|
| `studentId` | String | 学生 ID |
| `matchId` | String | 赛事 ID |
| `roundNumber` | String | 轮次 |

**响应体**：`CptCommitmentResponse`

### 4.14 海选状态

| 项 | 值 |
|----|-----|
| 方法 | `auditionStatus(matchId, listener)` |
| 说明 | 查询用户是否已报名海选 |
| HTTP | GET |

**请求路径**：`/api/v1/match/{matchId}/popups/student/{studentId}/audition/status`

**请求参数**：`matchId` 拼入路径

**响应体**：`Boolean`

### 4.15 海选排名弹窗

| 项 | 值 |
|----|-----|
| 方法 | `auditionRank(listener)` |
| 说明 | 获取海选排名（用于弹窗展示） |
| HTTP | GET |

**请求路径**：`/api/v1/match/popups/student/{studentId}/audition/rank`

**请求参数**：无

**响应体**：`AuditionPopUpsResponse`

### 4.16 学生赛事游戏记录（成绩单）

| 项 | 值 |
|----|-----|
| 方法 | `requestStudentGame(gameId, listener)` |
| 说明 | 查询学生某场赛事的成绩单/对战记录 |
| HTTP | GET |

**请求路径**：`/api/v1/grouping/task/{studentId}/Transcript`（注意大小写）

**请求参数（Query）**

| 参数 | 类型 | 说明 |
|------|------|------|
| `gameId` | String | 赛事对局 ID |

**响应体**：`StudentGameBean`

---

## 五、实时对战 Socket（配合 PK 使用）

竞技场对战过程通过 Socket 实时传输答题进度，与 HTTP API 配合使用。

**接口文件**：`sources/com/p039xh/common/socketv2/api/SocketApi.java`
**实现/控制器**：`sources/com/p039xh/abrustu/p053pk/controller/PkSocketController.java`

### 5.1 接口方法（`SocketApi`）

| 方法 | 说明 |
|------|------|
| `pk(PkSocketMsgRequest)` | 发送 PK 对战实时消息 |
| `cpt(int, SocketMsgRequest)` | 发送赛事对战实时消息 |
| `heart()` | 心跳 |
| `reconnect(String)` | 重连 |
| `finish(String)` | 结束 |

### 5.2 Socket 消息请求体

**PK 消息**：`PkSocketMsgRequest`（继承 `SocketMsgRequest`）
- 额外字段：`sendMsgTime` / `receivedMsgTime`

**通用消息**：`SocketMsgRequest`（继承 `BaseSocketMsgRequest`）
- 字段：`tagCode`、`tagName`、`totalLetters`、`selectedLetters`、`answer`、`score`、`homeExit`

**基础消息**：`BaseSocketMsgRequest`

| 字段 | 类型 | 说明 |
|------|------|------|
| `pkId` | String | 对局 ID |
| `matchId` | String | 赛事 ID |
| `userId` | Long | 用户 ID |
| `createTime` | Long | 创建时间 |
| `index` | Integer | 题目序号 |
| `result` | Integer | 作答结果 |
| `time` | Long | 用时 |
| `questionId` | String | 题目 ID |
| `systemJudge` | Boolean | 是否系统判题 |
| `questionCount` | Integer | 题目总数 |

> Socket 服务器信息由 `PkApi.serverId()` 接口（`/api/v1/pk/users/{id}/td`）下发（appId / roomId / userId）。

---

## 六、竞技场接口清单速查表

| # | 功能 | HTTP | 路径 | 服务码 |
|---|------|------|------|--------|
| 1 | 首页数据 | GET | `/api/v1/pk/user/{id}/home/page` | SA101010 |
| 2 | 全部可带头像 | GET | `/api/v1/pk/picture/student/{id}/picture/all` | SA101010 |
| 3 | 设置头像 | GET | `/api/v1/pk/picture/student/{id}/add/head/portrait` | SA101010 |
| 4 | 匹配检测 | GET | `/api/v1/pk/check/student/{id}/matching` | SA101010 |
| 5 | 提交对战结果 | POST | `/api/v1/pk/game/student/{id}/game/result` | SA101010 |
| 6 | 服务器信息 | GET | `/api/v1/pk/users/{id}/td` | SA101010 |
| 7 | 再来一局 | GET | `/api/v1/pk/check/student/{id}/again?subjectId=` | SA101010 |
| 8 | 远程取题 | GET | `/api/v1/question/question/users/{id}/tags/{tag}` | SA101010 |
| 9 | 弹窗列表 | GET | `/api/v1/match/student/{id}/popup/list` | SA101010 |
| 10 | 弹窗修复 | GET | `/api/v1/match/student/{id}/popup/fix` | SA101010 |
| 11 | 检查作业 | GET | `/api/v1/pk/check/student/{id}/homeWork` | SA101010 |
| 12 | 赛季封禁检查 | GET | `/api/v1/pk/check/student/{id}/season/ban?subjectId=` | SA101010 |
| 13 | 可对战学科 | GET | `/api/v1/pk/user/{id}/home/subject?studentId=` | SA101010 |
| 14 | 排名数据 | GET | `/api/v1/pk/rank/user/{id}` | SA101010 |
| 15 | 对局结果 | GET | `/api/v1/pk/game/user/{id}/game/result` | SA101010 |
| 16 | 对战历史 | GET | `/api/v1/pk/game/user/{id}/game/history` | SA101010 |
| 17 | 对局题目 | GET | `/api/v1/pk/game/user/{id}/game/question` | SA101010 |
| 18 | PK 数据恢复 | GET | `/api/v1/pk/student/{id}/date/restoration?pkId=` | SA101010 |
| 19 | PK 连接检测 | GET | `/api/v1/pk/student/{id}/connection/check?pkId=` | SA101010 |
| 20 | 晋级排名 | GET | `/api/v1/match/user/{id}/match/promotion/rank` | SA101010 |
| 21 | 决赛排名 | GET | `/api/v1/match/user/{id}/match/final/rank` | SA101010 |
| 22 | 提交赛事结果 | POST | `/api/v1/match/student/{id}/game/result` | SA101010 |
| 23 | 放弃比赛 | GET | `/api/v1/match/student/{id}/match/give/up` | SA101010 |
| 24 | 赛事数据恢复 | GET | `/api/v1/match/student/{id}/date/restoration` | SA101010 |
| 25 | 赛事连接检测 | GET | `/api/v1/match/student/{id}/race/connection/check` | SA101010 |
| 26 | 赛事题目/结果 | GET | `/api/v2/match/user/{id}/game/result/info` | SA101010 |
| 27 | 最近赛事 | GET | `/api/v1/match/student/{id}/recent/match` | SA101010 |
| 28 | 奖励体力 | GET | `/api/v1/match/{matchId}/student/{id}/reward/hp` | SA101010 |
| 29 | 海选列表 | GET | `/api/v1/match/{matchId}/user/{id}/audition/list` | SA101010 |
| 30 | 海选历史 | GET | `/api/v1/match/user/{id}/match/audition/detail/info` | SA101010 |
| 31 | 保存承诺书 | POST | `/api/v1/match/{matchId}/student/{id}/save/commitment` | SA101010 |
| 32 | 查询承诺书 | GET | `/api/v1/match/user/{id}/commitment` | SA101010 |
| 33 | 海选状态 | GET | `/api/v1/match/{matchId}/popups/student/{id}/audition/status` | SA101010 |
| 34 | 海选排名弹窗 | GET | `/api/v1/match/popups/student/{id}/audition/rank` | SA101010 |
| 35 | 学生赛事成绩单 | GET | `/api/v1/grouping/task/{id}/Transcript` | SA101010 |

---

## 七、涉及的实体类清单

以下实体类位于 `sources/com/p039xh/abrustu/networkapi/entity/`（部分在 `common` 包），用于各接口的请求/响应体。

**请求体（Bean）**
- `PkStudentGameBean`（`common/p063pk`）—— 提交 PK 对局结果
- `CompetitionGameBean`（`common/p063pk`）—— 提交赛事对局结果
- `PkRankRequest` —— PK 排名查询参数
- `CptMatchRankRequest` —— 晋级排名参数
- `CptMatchQuestionRequest` —— 赛事题目查询参数
- `CptCommitmentRequest` / `CptCommitmentRequest.CommitmentListRequest` —— 承诺书提交

**响应体（Response）**
- `PkHomeEntity`（含多个内部类）—— 首页
- `MatchingEntity` —— 匹配检测
- `ServerIdEntity` —— Socket 服务器信息
- `PkQuestionBean` —— 题目
- `MatchInspirePopupBean` —— 激励弹窗
- `ChooseSubjectBean` —— 学科
- `PkRankRespBean` / `PkRankBean` —— 排名
- `PkGameResultBean` / `PkQuestionResultDto` —— 对局结果
- `FightHistoryBean` —— 对战历史
- `PkQuestionListBean` / `PkQuestionInfoBean` / `TagBean` —— 对局题目
- `ConnectionCheckResponse` —— PK 连接检测
- `RoundRankResponse` —— 赛事排名
- `MatchDataRestorationResponse` —— 赛事数据恢复
- `MatchConnectionCheckResponse` —— 赛事连接检测
- `MatchResultInfoResponse` —— 赛事题目结果
- `MatchAuditionRankResponse` —— 海选排名
- `AuditionPopUpsResponse` —— 海选排名弹窗
- `CptCommitmentResponse` —— 承诺书查询
- `StudentGameBean`（`common/p061db/tableBean`）—— 学生赛事成绩单

**Socket 相关**
- `SocketApi`（`common/socketv2/api`）
- `PkSocketMsgRequest` / `SocketMsgRequest` / `BaseSocketMsgRequest`（`common/socketv2/request`）

---

## 八、注意事项

1. **登录前置**：所有接口均需用户登录，未登录时请求被拦截（不发送）。
2. **服务码**：竞技场全部接口固定使用服务码 `"SA101010"`，指向后端竞技场微服务。
3. **版本差异**：接口 26（赛事题目/结果）使用 `/api/v2/`，其余均为 `/api/v1/`。
4. **路径大小写**：接口 35（学生赛事成绩单）路径含大写 `Transcript`，需注意。
5. **GET 携带请求体**：多数"查询"接口使用 GET 且将对象字段作为 Query 参数提交（如排名、题目等）。
6. **URL 拼接**：部分参数（`subjectId`、`pkId`、`matchId`、`tagCode`）直接以查询串或路径片段形式拼入 URL，并非 JSON 请求体。
7. **实时对战**：PK 对战的实时答题过程走 Socket，`serverId` 接口负责下发 Socket 房间信息，二者配套使用。