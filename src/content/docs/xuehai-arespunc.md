---
title: "响应API"
description: 学海响应API解析
categories:
  - 技术解析
excerpt: 学海响应API解析
badge:
  text: 示例
  variant: note
---

> 本文档基于对 Android 应用 **com.xh.arespunc（混淆后包名 com.p021xh.arespunc）** 的反编译源码（JADX 输出）整理而成。
> 应用版本：v1.92.10.20260303（versionCode 9180，compileSdkVersion 31）。
---

## 1. 应用总览

| 项 | 值 |
|----|----|
| 应用标识（APPID） | CA107011（RequestUrl.APPID，同时是主微服务 ID SA107011） |
| 正式环境主域名 | https://response.yunzuoye.net（RequestUrl.baseUrlProduct） |
| 测试环境主域名 | http://response.xht.com |
| 开发环境主域名 | http://response.xh.com |
| 预发布（pre-announcement） | https://xuexiao-staging.yunzuoye.net |
| 微服务注册中心 | http://ms.yunzuoye.net |
| 文件服务 | https://filesoss.yunzuoye.net / http://files.yunzuoye.net |
| 主要角色类型 | 学生（USER_TYPE_STUDENT=1）、教师（USER_TYPE_TEACHER=4） |

### 环境切换
用户环境由 UserInfo.environmentType 决定：1=正式、2=测试、3=开发、4=预发布（见 AppConfig）。

---

## 2. HTTP 基础设施与协议框架

该 App 未直接使用 Retrofit，而是基于 OkHttp + 自研请求/响应封装（包 com.xh.xhcore.common.http、com.xh.common.http、com.xh.networkclient）。请求经微服务网关动态路由到具体后端服务。

### 2.1 请求（Request）封装

- 高层封装：com.xh.common.http.NetworkReqCompact（单例），暴露约 70+ 个业务方法。
- 底层代理：XHRequestProxy.createOkHttp() -> XHRequestOkHttpProxy（OkHttp 策略）；另有 STRATEGY_LIB_CURL 策略（native 库，见 com.xh.networkclient.HttpRequest，提供 JNI 的 HTTP/TCP 能力）。
- 统一请求入口：NetworkReqCompact.sendRequest(url, method, parameters, callback, isAsync, exChangeToMainThread, mapQuery, serverType)。
- 通用/旧接口：XHHttpBaseReq.requestWithObject(serverType, requestMethod, url, mBean, callback)。
- 上传/下载：XHHttpBaseUpload、XHHttpBaseDownload、XHUploadOkHttpProxy、XHDownloadOkHttpProxy。
- 业务回调：DataCallback<T>（onSuccess(T)、onError(int,String)、onError(String)）与 XHRequestCallBack.HttpCallBack<T>（success(T)、failed(int,String)）。

#### 通用请求 Body（表单编码）
POST/PUT/PATCH 请求体为 application/x-www-form-urlencoded; charset=UTF-8。业务参数对象（见 5.16 各请求 Bean，如 ChatMsgReqBean、AddFriendsReqBean 等）的字段被序列化为 JSON 后 URL 编码，放入 postData 字段的 K 值中（见 XhRequestObject）：

    { "postData": "K=<urlencoded JSON 业务对象>", "contentType": "application/x-www-form-urlencoded; charset=UTF-8" }

即：业务对象 JSON = 第 5.16 节各请求 Bean 的字段；HTTP body = 上述表单。

#### 公共请求基础字段（XhRequestBaseBean）
每个业务请求对象通常继承/包含以下公共字段：

| 字段 | 含义 |
|------|------|
| M | 用户 ID（userId） |
| S | 会话 ID（sessionId） |
| D | 设备唯一标识（UUID） |
| V | 版本名（versionName） |
| P | 包名（packageName） |
| C | 应用 ID（appId） |

### 2.2 响应（Response）封装

HttpConst.JSON_HTTP_RESPONSE_KEY = "httpResponse"。响应体 JSON 中 httpResponse 对象承载业务数据：

    { "httpResponse": { "D": "<业务数据 JSON 或 Base64+gzip 压缩字符串>", "I": "<冗余字段>", "M": "<提示消息>", "R": <业务返回码 int>, "Z": <0 或 1，1 表示 D 是 Base64+Deflate(gzip) 压缩数据> } }

- 解析逻辑见 XhJsonParse：parseDataDefault 等。当 Z=1 时，D 为 Base64(gzip(json))，需解压。
- 业务错误信息：NetworkReqCompact.FailMsg{traceId, code, msg}，通过 getBusinessError(httpResponse) 从 D 中解析。

### 2.3 请求头

- User-Agent：XueHaiNetworkClient/1.0（XH_USER_AGENT_VALUE）
- XHCore-Version：核心库版本
- 签名：sign（HTTP_SIGNATURE_KEY）
- 分布式链路：X-B3-TraceId、X-B3-SpanId
- 时间戳：t（TIMESTAMP_KEY）
- 文件哈希：XueHai-MD5（XH_HTTP_HEAD_MD5）
- 认证：Authorization

### 2.4 安全 / 签名 / HTTPS

- HTTPS 默认开启（HTTPS_ENABLE=true，HTTPS_ENVIRONMENT_TEST=false）。
- 上传/下载安全配置见 com.xh.xhcore.common.http.strategy.p036xh.security：SecurityType、SecuritySetApi、SecuritySetRequestBody、UploadSecurityUtil / DownloadSecurityUtil、ExchangeTempUrlRequest、MultiDownloadSecurityController、SingleDownloadSecurityController。
- Ak/Sk 加密上传：aksk/AkSkUtil、AesEncryptUtils、AesEncryptionAlgorithm。

### 2.5 DNS / HTTPDNS

com.xh.xhcore.common.http.dns：DNSManager、XhOkHttpDNS、OptimizeLocalDNS、BootstrapDNS；拦截器链 CacheDNSInterceptor -> HttpDNSInterceptor -> LocalDNSInterceptor；HTTPDNS 服务 HttpDNSInterceptor 请求 http://<SERVER_IP>/<ACCOUNT_ID>/d?host=<host>；重试 DNSStateRetryInterceptor、FollowUpMarkNetworkInterceptor。

---

## 3. 微服务发现（Microservice Discovery）与服务器类型

App 通过 RESTful 接口从注册中心获取"服务器类型->IP/域名列表"映射并动态路由。有 V1/V2/V3 三个版本（XHMicroServer、XHMicroServerV2、XHMicroServerV3），当前默认 V3。

| 版本 | 路径 |
|------|------|
| V1 | /api/v1/pub/microServer/（http://ms.yunzuoye.net/XhServerMg/GetXsList） |
| V2 | /api/v2/pub/microServer/list/ |
| V3 | /api/v3/pub/microServer/list/（默认） |

请求参数：XHMicroServiceReqBean{Desc, iSchoolId, iUpdateTime, iUserId, iVersion, microServiceUrls[], sServiceType, sUserType}。
响应：MicroServerResponse{serverType, updateTime, microServerDtoList[]}，每个 MicroServerDto{serverId, domainOrIp, port, dirLocation, schoolId, serverType, schList, mode, index}。
地址实体：BaseMicroServer.MicroServerEntityUnify{addressType(IP/DOMAIN/NONE), protocol(HTTP/HTTPS/TCP/WS/...), dirLocation, domainOrIp, port, index, schList, serverId, serverType, mode}。
缓存：BaseMicroServer.ServerUrlUnify 按 serverType[_classId] 缓存并轮询（nextMicro() 故障切换）。

### 已识别的服务器类型（Server Type）常量

| 常量 | 值 | 用途 |
|------|----|------|
| XY_SERVICE_ID | SA107011 | 主业务（用户/联系人/群/聊天/消息） |
| XY_QUIZ_SERVICE_ID | SA112001 | 提问/答疑（Quiz）服务 |
| XY_QUIZ2_SERVICE_ID | SA112003 | 提问/答疑 V2 服务 |
| PUBLICK_SERVICE_ID | SB103001 | 公共服务 |
| CONTROL_SERVICE_ID | SB103015 | 控制服务（https://control.yunzuoye.net） |
| LETTER_SERVICE_ID | SA101001 | 信笺/站内信服务 |
| SERVER_RESOURCE_CENTER | WEB002011 | 资源中心（/XHDataCenter/...） |
| 文件服务 | - | filesoss.yunzuoye.net / files.yunzuoye.net |

主域默认映射见 XHApplication.put("SB103015","https://control.yunzuoye.net") 等。

---

## 4. 主机（Host）汇总

| 用途 | 域名 |
|------|------|
| 业务主网关 | response.yunzuoye.net（正式）/ response.xht.com（测试）/ response.xh.com（开发） |
| 微服务注册中心 | ms.yunzuoye.net |
| 文件服务器（OSS） | filesoss.yunzuoye.net、files.yunzuoye.net、OSS 桶 xuehaifile.oss-cn-hangzhou.aliyuncs.com |
| 控制服务 | control.yunzuoye.net |
| 上传接入（Native 库） | http://files.yunzuoye.net/XHFileServer/file/... |
| 测试参考 | ztp.yunzuoye.net、fiction.yunzuoye.net、admin.yunzuoye.net（/api/track/saveTrack 埋点） |
| 业务统计埋点 | http://47.111.168.116:8089（Analysys）、http://121.41.123.196:8106/sa?project=default |

---

## 5. 业务 API 目录（按模块）

> 说明：路径中的 {userId} 为当前登录用户 ID，{sessionId} 为会话 ID，{groupId} 为群 ID，{schoolId} 为学校 ID。方法名来自 NetworkReqCompact / 各 Repository。以下均省略主域名。

### 5.1 认证与登录（Auth / QR 登录）

| 方法 / 用途 | 方法 | 路径 | 服务 | 请求 -> 响应 |
|---|---|---|---|---|
| 二维码确认登录 | POST | /api/v1/pub/auth/qrcode/confirm | XY_SERVICE | {authType, confirm, uuid} -> Object |
| 学生答疑鉴权 | GET | /api/v1/pub/auth?userId={userId} | - | -> 鉴权结果 |
| 鉴权批量（学生） | - | /api/v1/pub/{userId}/auth/batch | QUIZ | -> 结果 |

### 5.2 用户 / 资料 / 概览（User / Profile / Base Info）

| 方法 / 用途 | 方法 | 路径 | 服务 | 请求 -> 响应 |
|---|---|---|---|---|
| 拉取用户/通讯录 | POST | /api/v1/users/fetch | XY_SERVICE | {userId} -> List<ServerContact> |
| 用户基础信息/未读数 | GET | /api/v1/users/{userId}/base/info | XY_SERVICE | -> ContactInfoCountResBean{friendRequestCnt, unreadTransferRequestsCnt,...} |
| 保存备注名/资料 | - | /api/v1/users/{userId}/profile | XY_SERVICE | -> SaveRemark |
| 用户准备（特性开关） | GET | /api/v1/users/{userId}/prepare?features=AV_CHAT | XY_SERVICE | -> PrepareResBean{features[]} |
| 学科列表 | GET | /api/v1/subjects | XY_SERVICE | -> List<SubjectEntity> |
| 家长管控时间周 | GET | /api/v1/periods/weeks | XY_SERVICE | {userId} -> ControlTimes |
| 我的分组（全部群） | GET | /api/v1/pri/users/{userId}/my/groups?type=1 | XY_SERVICE | -> List<SessionGroup> |
| 会话未读数（推送同步） | GET | /api/v2/users/{userId}/messages/unread?version={v} | XY_SERVICE | -> ChatUnReadMsgListResBean |
| 通讯录 v2 | GET | /api/v2/users/{userId}/contacts/ | XY_SERVICE | ContactV2ReqBean -> ContactV2RespBean |

### 5.3 联系人 / 好友（Contacts / Friends）

| 方法 / 用途 | 方法 | 路径 | 服务 | 请求 -> 响应 |
|---|---|---|---|---|
| 全部联系人 | GET | /api/v1/users/{userId}/contacts/ | XY_SERVICE | 查询参数 -> ContactResponseBean |
| 通讯录 v2 | GET | /api/v2/users/{userId}/contacts/ | XY_SERVICE | ContactV2ReqBean -> ContactV2RespBean |
| 指定联系人列表 | POST | /api/v1/users/{userId}/contacts/specific | XY_SERVICE | Map -> List<ServerContact> |
| 搜索联系人/用户 | - | /api/v1/users/search | XY_SERVICE | -> SearchContactResponseBean |
| 搜索（v2 综合） | GET | /api/v1/users/{userId}/search2 | XY_SERVICE | SearchRequestParams -> SearchResponse |
| 判断是否好友 | - | /api/v1/users/{userId}/friends/{id}/judge | XY_SERVICE | -> 结果 |
| 删除好友 | - | /api/v1/users/{userId}/friends/{friendId} | XY_SERVICE | -> DeleteFriendBean |
| 小助手（Assist） | GET | /api/v1/users/{userId}/contacts/assist | XY_SERVICE | -> GetAssistGroupBean |
| 按群获取小助手 | GET | /api/v1/users/{userId}/contacts/assist/group | XY_SERVICE | 查询参数 -> 结果 |
| 导师分组 | GET | /api/v1/users/{userId}/instructor/student/group | XY_SERVICE | -> List<Group> |
| 我的关联（家长） | GET | /api/v1/users/{userId}/associations | XY_SERVICE | -> List<AssociatedParent> |

#### 好友申请（Friend Requests）

| 方法 / 用途 | 方法 | 路径 | 服务 | 请求 -> 响应 |
|---|---|---|---|---|
| 申请加好友 | POST | /api/v1/users/{userId}/friends/requests/ | XY_SERVICE | AddFriendsReqBean -> List<FriendsRequest> |
| 好友申请列表 | GET | /api/v1/users/{userId}/friends/requests/?lastTime={t} | XY_SERVICE | 查询参数 -> FriendRequestListResBean |
| 好友申请列表（同） | GET | /api/v1/users/{userId}/friends/requests/ | XY_SERVICE | -> FriendRequestListResBean |
| 批量申请（分页） | - | /api/v1/users/{userId}/friends/requests/ | XY_SERVICE | -> AddFriendLotSizeResBean |
| 同意单个申请 | PUT | /api/v1/users/{userId}/friends/requests/{id}/agree | XY_SERVICE | -> FriendsRequest |
| 拒绝单个申请 | PUT | /api/v1/users/{userId}/friends/requests/{id}/ignore | XY_SERVICE | -> RefuseFriendReqResBean |
| 全部同意 | POST | /api/v1/users/{userId}/friends/requests/agree | XY_SERVICE | List<requestId> -> Unit |
| 全部忽略 | POST | /api/v1/users/{userId}/friends/requests/ignore | XY_SERVICE | List<requestId> -> Unit |
| 删除好友申请 | DELETE | /api/v1/users/{userId}/friends/requests | XY_SERVICE | DeleteFriendsRequestReqBean -> Unit |
| 好友申请已读 | POST | /api/v1/users/{userId}/friends/requests/read | XY_SERVICE | Map<String,List<String>> -> String |

### 5.4 分组 / 班级群（Groups / Contacts Groups）

| 方法 / 用途 | 方法 | 路径 | 服务 | 请求 -> 响应 |
|---|---|---|---|---|
| 联系人分组列表 | GET | /api/v1/users/{userId}/contacts/groups/ | XY_SERVICE | Map -> GroupResponseBean |
| 创建分组 | POST | /api/v1/users/{userId}/contacts/groups/ | XY_SERVICE | -> GroupResponseBean |
| 更新分组 | PUT | /api/v1/users/{userId}/contacts/groups/{groupId} | XY_SERVICE | UpdateCustomGroupReq -> 结果 |
| 删除分组 | DELETE | /api/v1/users/{userId}/contacts/groups/{groupId} | XY_SERVICE | -> 结果 |
| 群信息列表 | POST | /api/v1/users/{userId}/groups/info | XY_SERVICE | GroupRequestBean -> GroupResponseBean（requestGroupListData/2） |
| 群列表（批量） | POST | /api/v2/users/{userId}/groups/batch | XY_SERVICE | GetChatGroupListReqBean -> ChatGroupListResBean[] |
| 创建群聊 | POST | /api/v1/users/{userId}/groups/ | XY_SERVICE | -> CreateChatGroupResBean |
| 更新群信息 | PUT | /api/v1/users/{userId}/groups/{groupId} | XY_SERVICE | ChatGroupUpdateReqBean -> 结果 |
| 退出群 | - | /api/v1/users/{userId}/groups/{groupId}/quit | XY_SERVICE | -> 结果 |
| 删除群 | DELETE | /api/v1/users/{userId}/groups/{groupId}?sync={bool} | XY_SERVICE | -> 结果 |
| 批量删除群 | DELETE | /api/v1/users/{userId}/groups/batch | XY_SERVICE | List<DeleteGroup> -> String |
| 群转让 | - | /api/v1/users/{userId}/groups/{groupId}/transfer | XY_SERVICE | -> 结果 |
| 群转让申请 | - | /api/v1/users/{userId}/groups/{groupId}/transfer/request | XY_SERVICE | -> 结果 |
| 群转让申请列表 | GET | /api/v1/users/{userId}/groups/transfer/requests | XY_SERVICE | -> GroupTransferListRes |
| 群状态 | GET | /api/v1/users/{userId}/groups/{groupId}/status | XY_SERVICE | -> GroupStatusInfo |
| 教师群状态 | GET | /api/v1/users/{userId}/groups/{groupId}/status/teacher | XY_SERVICE | -> 结果 |
| 群静默/禁言信息 | GET | /api/v1/users/{userId}/groups/{groupId}/silence | XY_SERVICE | -> GroupShieldInfo |
| 设置/取消群禁言 | PUT | /api/v1/users/{userId}/groups/{groupId}/silence | XY_SERVICE | GroupShieldReqBean -> Unit |
| 开启/关闭群禁言 | PATCH | /api/v1/users/{userId}/groups/{groupId}/silence/{setup|cancel} | XY_SERVICE | -> Unit |
| 群自动禁言 | PATCH | /api/v1/users/{userId}/groups/{groupId}/auto/silence?enable={1|0} | XY_SERVICE | -> Unit |
| 群打卡（拍照）状态开关 | POST | /api/v1/users/{userId}/groups/{groupId}/pic/{open|close} | XY_SERVICE | Map<String,Long> -> Unit |
| 查询打卡状态 | GET | /api/v1/users/{userId}/groups/{groupId}/pic/status | XY_SERVICE | -> GroupPicBean |
| 成员打卡屏蔽 | POST | /api/v1/users/{userId}/groups/{groupId}/pic/member/{open|close} | XY_SERVICE | GroupMemberCameraShieldReqBean -> Unit |
| 群笔记操作 | PATCH | /api/v1/users/{userId}/groups/{groupId}/note/operation | XY_SERVICE | Map -> Unit |
| 查询笔记状态 | GET | /api/v1/users/{userId}/groups/{groupId}/note/status | XY_SERVICE | -> GroupNoteBean |
| 笔记白名单 | PATCH | /api/v1/users/{userId}/groups/{groupId}/note/white/list | XY_SERVICE | GroupMemberNoteShieldReqBean -> Unit |
| 学校老师列表 | GET | /api/v1/schools/{schoolId}/teachers | XY_SERVICE | -> List<TeacherMsgModel> |
| 群成员已读回执 | GET | /api/v1/{userId}/group/{groupId}/acks | XY_SERVICE | -> GroupMembersAcks |
| 群公告/通知 | POST | /api/v1/users/{userId}/notices/ | XY_SERVICE | ShareGroupMsgReqBean -> ShareGroupMsgResBean |
| 群文件文件夹 | GET | /XHDataCenter/api/v1/users/{userId}/groupChats/folder | XY_SERVICE | -> 结果 |
| 群文件保存 | POST | /XHDataCenter/api/v1/groupChats/{groupId}/resources | XY_SERVICE | GroupResourceBean -> 结果 |

### 5.5 会话 / 聊天消息（Session & Messaging）

| 方法 / 用途 | 方法 | 路径 | 服务 | 请求 -> 响应 |
|---|---|---|---|---|
| 最近会话列表 | GET | /api/v2/users/{userId}/sessions/recent | XY_SERVICE | Map -> SessionListResBean |
| 特殊会话列表 | GET | /api/v1/service/session/list | XY_SERVICE | -> SpecialSessionResListBean |
| 获取消息列表 | GET | /api/v1/users/{userId}/sessions/{sessionId}/messages/ | XY_SERVICE | ChatMsgHistoryReqBean -> ChatMsgHistoryResBean[] |
| 历史消息 | GET | /api/v1/users/{userId}/sessions/{sessionId}/messages/history | XY_SERVICE | -> 历史消息 |
| 发送消息 | POST | /api/v1/users/{userId}/sessions/{sessionId}/messages/ | XY_SERVICE | ChatMsgReqBean -> ChatMsg |
| 删除会话 | DELETE | /api/v1/users/{userId}/sessions/{sessionId} | XY_SERVICE | Map -> String |
| 批量删除会话 | DELETE | /api/v1/users/{userId}/sessions | XY_SERVICE | DeleteSessionsReq -> String |
| 已读回执（单条） | - | /api/v1/users/{userId}/sessions/{sid}/messages/{mid}/readAck?sessionType={t} | XY_SERVICE | -> 结果 |
| 语音已读回执 | PATCH | /api/v1/users/{userId}/sessions/{sid}/messages/{mid}/voice/readAck?sessionType={t} | XY_SERVICE | -> Unit |
| 批量已读回执 | PATCH | /api/v1/users/{userId}/readAck | XY_SERVICE | BatchConfirmMsgReqBean -> Unit |
| 批量删除/标记消息 | PATCH | /api/v1/users/{userId}/sessions/{sid}/messages/status?sessionType={t} | XY_SERVICE | Map<String,List<Long>> -> Unit |
| 查询消息状态 | POST | /api/v1/users/{userId}/sessions/messages/sent | XY_SERVICE | CheckMessagesStatusReqBean -> List<ChatMsgHistoryResBean> |
| 单条消息状态 | POST | /api/v1/users/{userId}/sessions/{sid}/messages/status?sessionType={t} | XY_SERVICE | CheckMsgReadStatusReqBean -> CheckMsgReadStatus |
| 最大消息查询 | GET | /api/v1/users/{userId}/sessions/{sid}/messages/max?sessionType={t} | XY_SERVICE | -> CheckMsgMax |
| 撤销消息 | PATCH | /api/v1/users/{userId}/sessions/{sid}/messages/{mid}/revoke/{fromId}?sessionType={t}&resourceId={r} | XY_SERVICE | -> MsgRevokeResBean |
| 置顶消息 | GET | /api/v1/users/{userId}/group/{groupId}/message/{msgId}/sticky | XY_SERVICE | -> String |
| 置顶会话 | - | /api/v1/users/{userId}/sessions/{sid}/top?sessionType={t} | XY_SERVICE | ChatUp |
| 免打扰 | - | /api/v1/users/{userId}/sessions/{sid}/notifications | XY_SERVICE | ChatNoDisturbing |
| 会话状态 | - | /api/v1/users/{userId}/sessions/{sid}/state?sessionType={t}&state={s} | XY_SERVICE | 结果 |
| 转发消息 | POST | /api/v1/users/{userId}/forward | XY_SERVICE | BatchForwardMsgReqBean -> Unit |
| 转发结果查询 | POST | /api/v1/users/{userId}/forward/res | XY_SERVICE | ForwardResReqBean -> ForwardResResponse |
| 单条转发 | POST | /api/v2/users/{userId}/forward/single | XY_SERVICE | ForwardSingleReqBean -> ForwardSingleRespBean |
| 在线答疑开始 | POST | /api/v1/users/{userId}/sessions/{sid}/oa | XY_SERVICE | OnlineAnswerReqBean -> OnlineAnswerResBean |
| 在线答疑结束 | - | /api/v1/users/{userId}/sessions/{sid}/oa/{oaId} | XY_SERVICE | EndOnlineAnswerReqBean -> 结果 |
| 语音转文字 | GET | /api/v1/users/{userId}/sessions/{sid}/messages/audio/text?sessionType={t}&msgId={m}&url={u} | XY_SERVICE | -> String |
| 毕业生会话清理 | GET | /api/v1/users/{uid}/sessions/graduate/students/clean | XY_SERVICE | -> Object |
| 最近通话记录 | POST | /api/v1/users/{userId}/call/current | XY_SERVICE | -> RecentCallRecordResponse |

### 5.6 屏蔽（Shields）

| 方法 / 用途 | 方法 | 路径 | 服务 | 请求 -> 响应 |
|---|---|---|---|---|
| 屏蔽联系人 | POST | /api/v1/users/{userId}/shields/ | XY_SERVICE | ShieldsContactReqBean -> Unit |
| 取消屏蔽 | PATCH | /api/v1/users/{userId}/shields/cancel | XY_SERVICE | ShieldsContactReqBean -> Unit |
| 屏蔽学生列表 | - | /api/v1/users/{userId}/shieldStudents/ | XY_SERVICE | -> 列表 |
| 屏蔽笔记 | - | /api/v1/users/{userId}/shieldNotes/、/shieldNotes/cancel、/shieldStudentNotes/ | XY_SERVICE | -> 列表 |

### 5.7 收藏（Favorites / Collections）

| 方法 / 用途 | 方法 | 路径 | 服务 | 请求 -> 响应 |
|---|---|---|---|---|
| 添加/处理收藏 | POST | /api/v1/pub/users/{userId}/favorite | XY_SERVICE | CollectionAddReqBean -> Object |
| 收藏列表 | - | /api/v1/pub/users/{userId}/favorites | XY_SERVICE | -> CollectionData |
| 删除收藏 | - | /api/v1/pub/users/{userId}/favorite/{favoriteId} | XY_SERVICE | -> 结果 |

### 5.8 笔记（Note / 手写笔记）

| 方法 / 用途 | 方法 | 路径 | 服务 | 请求 -> 响应 |
|---|---|---|---|---|
| 新增笔记 | - | /api/pub/v1/user/{userId}/note/add | XY_SERVICE | HandWritingNoteBean -> AddNoteResBean |
| 笔记历史 | GET | /api/pub/v1/user/{userId}/note/{noteId} | XY_SERVICE | -> NoteHistoryResBean |
| AI 追问答案 | GET | /api/pub/v1/user/{userId}/note/{noteId}/ai/answers | XY_SERVICE | -> 结果 |

### 5.9 资源中心 / 文件 / 上传下载（Resource Center / File Server）

| 方法 / 用途 | 方法 | 路径 | 服务 | 请求 -> 响应 |
|---|---|---|---|---|
| 收集资源 | POST | /XHDataCenter/api/v1/personResource/upload | - | -> PersonResourceRes |
| 创建手写笔记资源 | POST | /XHDataCenter/api/v1/personResource/upload | - | -> 结果 |
| 资源消息 | GET | /XHDataCenter/api/v3/resourceTwo/resources | - | -> 结果 |
| 更新资源 | - | /XHDataCenter/api/v3/resourceTwo/resources/{resourceId} | - | -> 结果 |
| 上传资源回执 | - | /XHDataCenter/api/v3/resourceTwo/resources/response | - | -> 结果 |
| 个人文件（资源中心） | GET | /XHDataCenter/api/v1/personResource/file?userId={userId} | XY_SERVICE | -> 结果 |
| 应用资源描述 | GET | /api/v1/resource/{userId}/app/descriptor{packageName} | XY_SERVICE | -> List<AppResourceInfo> |
| 文件上传（表单） | POST | http://filesoss.yunzuoye.net/XHFileServer/file/upload/{appId} | - | -> UploadFileRes |
| 文件上传（即时） | POST | http://filesoss.yunzuoye.net/XHFileServer/file/upload/instant/ | - | -> OSS 结果 |
| 文件上传（大文件） | POST | http://filesoss.yunzuoye.net/XHFileServer/file/upload/largefile/ | - | -> OSS 结果 |
| 文件批量上传 | POST | http://files.yunzuoye.net/XHFileServer/file/batch/upload/tmp | - | -> UploadFileRes |
| 压缩包上传 | POST | http://files.yunzuoye.net/XHFileServer/file/zip/upload/tmp | - | -> 结果 |
| 文件流下载 | GET | http://filesoss.yunzuoye.net/XHFileServer/file/stream?url={url} | - | -> 流 |
| 批量原始下载 | - | http://filesoss.yunzuoye.net/XHFileServer/file/batch/raw/download/ | - | -> 结果 |
| 批量临时下载 | - | http://files.yunzuoye.net/XHFileServer/file/batch/download/tmp | - | -> 结果 |
| 上传版本 | POST | /api/v1/users/{userId}/clients/ | XY_SERVICE | UploadVersionReqBean -> UploadVersionResBean |

### 5.10 提问 / 答疑（Quiz / Q&A）—— 学生端

> 服务：多为 XY_QUIZ_SERVICE_ID (SA112001) 或 XY_QUIZ2_SERVICE_ID (SA112003)。

| 方法 / 用途 | 方法 | 路径 | 服务 | 请求 -> 响应 |
|---|---|---|---|---|
| 提问圈子 | - | /api/v1/pub/{userId}/circle | QUIZ | -> 结果 |
| 圈子配置 | - | /api/v1/pub/{userId}/circle/config | QUIZ | -> 结果 |
| 学生提问 | POST | /api/v1/pub/student/{userId}/question | QUIZ | -> 结果 |
| 提问（圈子） | POST | /api/v1/pub/circle/{userId}/question | QUIZ | -> 结果 |
| 提问详情 | - | /api/v1/qzone/users/{userId}/question/detail | QUIZ | -> 结果 |
| 圈子内问题列表 | GET | /api/v1/pub/circle/{userId}/question/{circleId} | QUIZ | -> 结果 |
| 圈子问题状态 | - | /api/v1/pub/circle/{userId}/question/status | QUIZ | -> 结果 |
| 删除问题 | - | /api/v1/pub/circle/{userId}/question/delete | QUIZ | -> 结果 |
| 推荐题目列表 | GET | /api/v1/pub/rec/question | QUIZ | -> QuizQuestionListModel |
| 已删除题目 | GET | /api/v1/pub/delete/question | QUIZ2 | -> QuizQuestionListModel |
| 回复（答卷） | - | /api/v1/qzone/users/{userId}/reply | QUIZ | -> 结果 |
| 回复列表 | - | /api/v1/qzone/users/{userId}/replies | QUIZ | -> 结果 |
| 回复置顶 | - | /api/v1/qzone/users/{userId}/reply/top | QUIZ | -> 结果 |
| 收藏/去收藏 | - | /api/v1/pub/{userId}/collect | QUIZ | -> 结果 |
| 老师信息 | - | /api/v1/pub/teacher/{userId}/teach/info | QUIZ | -> 结果 |
| 老师/学生群题目列表 | GET | /api/v1/qzone/users/{userId}/question/teacher?pageNo=&pageSize=&teacherId= | QUIZ | -> 结果 |
| 未答题（NA）列表 | GET | /api/v1/qzone/users/{userId}/question/na?pageNo=&pageSize=&teacherId= | QUIZ | -> 结果 |
| 答题开关 | - | /api/v1/qzone/users/{userId}/question/party/{partyId}/reply/toggle?value={bool} | QUIZ | -> 结果 |
| 班级公开 | - | /api/v1/qzone/users/{userId}/question/grade/public | QUIZ | -> 结果 |
| 公开申请 | - | /api/v1/qzone/users/{userId}/question/apply/grade/public | QUIZ | -> 结果 |
| 公开申请列表 | GET | /api/v1/qzone/users/{userId}/question/apply/public?pageNo=&pageSize= | QUIZ | -> 结果 |
| 已关闭题目 | - | /api/v1/qzone/users/{userId}/questionon/closed | QUIZ | -> 结果 |
| 难度等级 | - | /api/v1/qzone/users/{userId}/question/difficulty | QUIZ | -> 结果 |
| 问题类型字典 | - | /api/v1/qzone/users/{userId}/personal/dicts | QUIZ | -> 结果 |
| 点赞 | - | /api/v1/qzone/users/{userId}/interactive/like | QUIZ | -> 结果 |
| 提问基础权限 | - | /api/v1/qzone/users/{userId}/prepare | QUIZ | -> 结果 |
| 校验答题次数 | - | /api/v1/qzone/users/{userId}/question/party/verify/limit | QUIZ | -> 结果 |
| 删除题目 | - | /api/v1/qzone/users/{userId}/questions/deleted | QUIZ | -> 结果 |
| 群成员（按群） | - | /api/v1/qzone/users/{userId}/classes/member | QUIZ | -> 结果 |

### 5.11 提问 / 答疑 —— 小队（Team）模块

| 方法 / 用途 | 方法 | 路径 | 服务 | 请求 -> 响应 |
|---|---|---|---|---|
| 小队列表 | GET | /api/v1/qzone/users/{userId}/teams | QUIZ | -> 结果 |
| 添加小队 | POST | /api/v1/qzone/users/{userId}/team | QUIZ | -> 结果 |
| 编辑小队 | PUT | /api/v1/qzone/users/{userId}/team/{teamId} | QUIZ | -> 结果 |
| 删除小队 | DELETE | /api/v1/qzone/users/{userId}/team/{teamId} | QUIZ | -> 结果 |
| 小队成员 | GET | /api/v1/qzone/users/{userId}/team/{teamId}/members | QUIZ | -> 结果 |
| 搜索成员 | GET | /api/v1/qzone/users/{userId}/team/{teamId}/members | QUIZ | -> 结果 |
| 成员特性 | - | /api/v1/qzone/users/{userId}/team/{teamId}/member/feature | QUIZ | -> 结果 |
| 删除成员 | DELETE | /api/v1/qzone/users/{userId}/team/{teamId}/member | QUIZ | -> 结果 |
| 转移成员 | - | /api/v1/qzone/users/{userId}/team/{teamId}/member/move | QUIZ | -> 结果 |
| 学生管理状态 | - | /api/v1/qzone/users/{userId}/student/management、/student/management/set | QUIZ | -> 结果 |

### 5.12 提问管理（教师端，Quiz Time Manager / Quiz2）

> 服务：XY_QUIZ2_SERVICE_ID (SA112003)。

| 方法 / 用途 | 方法 | 路径 | 服务 | 请求 -> 响应 |
|---|---|---|---|---|
| 题目时间列表 | GET | /api/v1/qzone/users/{userId}/question/parties（query: page,size） | QUIZ2 | -> QuizPageModel<QuizQuestionPartyModel> |
| 题目时间配置 | GET | /api/v1/qzone/users/{userId}/question/party/config | QUIZ2 | -> 结果 |
| 题目时间配置（保存） | POST | /api/v1/qzone/users/{userId}/question/party/config（query: daysInAdvance） | QUIZ2 | -> 结果 |
| 全天设置 | POST | /api/v1/qzone/users/{userId}/question/party/na（query: enabled） | QUIZ2 | -> 结果 |
| 题目时间列表（日期区间） | GET | /api/v1/qzone/users/{userId}/question/party/list（query: startDate,endDate） | QUIZ2 | -> List<QuizQuestionPartyModel> |
| 小队列表 | GET | /api/v1/qzone/users/{userId}/teams | QUIZ2 | -> 结果 |
| 新建题目场次 | POST | /api/v1/qzone/users/{userId}/question/party | QUIZ2 | -> QuizQuestionPartyModel |
| 删除题目场次 | DELETE | /api/v1/qzone/users/{userId}/question/party | QUIZ2 | -> String |
| 答题开关 | POST | /api/v1/qzone/users/{userId}/question/party/{id}/reply/toggle（query: value） | QUIZ2 | -> String |
| 学生科目 | GET | /api/v1/qzone/users/{userId}/subjects | QUIZ2 | -> 结果 |
| 材料列表 | - | /api/v1/qzone/users/{userId}/material(s)、/materials/deleted | QUIZ2 | -> 结果 |

### 5.13 AI 答疑对话（Chat / Completion）

> 服务：XY_SERVICE_ID (SA107011)，见 com.xh.arespunc.qadetail.model.BaseAiQADetailViewModel。

| 方法 / 用途 | 方法 | 路径 | 请求 -> 响应 |
|---|---|---|---|
| 创建 AI 会话 | POST | /api/v1/chat/create | -> 结果 |
| AI 会话详情 | GET | /api/v1/chat/chatId/{chatId} | -> 结果 |
| AI 对话补全 | POST | /api/v1/chat/completions | -> 结果 |

### 5.14 通知 / 权限（Notification / Permission / Settings）

| 方法 / 用途 | 方法 | 路径 | 服务 | 请求 -> 响应 |
|---|---|---|---|---|
| 老师特性权限 | - | /api/v1/users/{userId}/teacher/{teacherId}/user/feature/authority | XY_SERVICE | -> List<String>（getShowReadPermission） |
| 在线答疑权限 | - | /api/v1/users/{userId}/feature/authority/ | XY_SERVICE | -> OnlineAnswerPermissionRepository |
| 设置权限 | - | /api/v1/users/{userId}/authority/set | XY_SERVICE | -> 结果 |
| 学生权限 | - | /api/v1/users/{userId}/authority/ | XY_SERVICE | -> 结果 |
| 批量权限 | GET | /api/v1/users/{userId}/user/feature/authority/batch | XY_SERVICE | -> 结果 |
| 权限操作 | - | /api/v1/users/{userId}/user/feature/authority/operate | XY_SERVICE | -> 结果 |
| 设置消息通知权限 | POST | /api/v1/user/{userId}/feature/authority/{key} | XY_SERVICE | -> MessageNotifyModel |
| 反馈审核列表 | GET | /api/v1/pub/{userId}/reply/review | QUIZ | {timestamp,size} -> ReplyAuditListModel |
| 反馈批量操作 | POST | /api/v1/pub/{userId}/reply/review/batch | QUIZ | ReplyBatchOpParam -> Unit |
| 反馈列表 | GET | /api/v1/pub/{userId}/replies | QUIZ | -> QuizQuestionListModel |
| 信笺 H5 地址 | GET | /api/v1/configure/users/{userId}/h5/url | LETTER | -> LetterDetailUrl |
| 订阅 AI 权限 | GET | /api/v1/pri/subscriptions/users/{userId}/specify | - | -> 结果 |
| 教师授课次数统计 | GET | /api/v1/statistics/cloudwork/users/{userId}/lecture/times | - | -> LectureTimesBean |
| 节假日开关 | GET | /api/v2/holiday/off | XY_SERVICE | -> HolidayModel |
| 学校静默信息 | GET | /api/v1/feature/school/silence | XY_SERVICE | -> SilenceModel |

### 5.15 其他 / 平台（Misc / Platform）

| 方法 / 用途 | 方法 | 路径 | 服务 | 请求 -> 响应 |
|---|---|---|---|---|
| 平台时间 | GET | /api/v1/platform/dateTime（测试：ztp.yunzuoye.net） | - | -> 时间 |
| 埋点上报 | POST | https://admin.yunzuoye.net/api/track/saveTrack | - | -> 结果 |
| 圈子标签 | - | /api/v1/pub/circle/{userId}/tag、/api/v1/pub/circle/{userId}/tag/{circleId} | QUIZ | -> 结果 |
| 圈子权限（目标） | - | /api/v1/pub/circle/{userId}/authority/{targetId} | QUIZ | -> 结果 |

---

### 5.16 POST 请求体参数详解

> 说明：以下所有 POST/PUT/PATCH 请求的"业务参数"均为请求 Bean 的 JSON 字段。传输时这些字段被序列化为 JSON 后 URL 编码，放进表单字段 postData=K=<urlencoded JSON>（见 XhRequestObject）。请求对象还会携带公共基础字段（M 用户ID、S 会话ID、D 设备ID、V 版本、P 包名、C 应用ID，见 XhRequestBaseBean）。

#### 5.16.1 好友 / 联系人

| 接口 | 请求 Bean | 业务字段（Body 内 K 的 JSON 结构） |
|---|---|---|
| 申请加好友 POST /friends/requests/ | AddFriendsReqBean | { friendIds: List<Integer> }（要添加的好友ID列表） |
| 删除好友申请 DELETE /friends/requests | DeleteFriendsRequestReqBean | { sourceIds: String }（逗号分隔的申请记录ID） |
| 屏蔽联系人 POST /shields/ | ShieldsContactReqBean | { peerIds: List<Long> } |
| 取消屏蔽 PATCH /shields/cancel | ShieldsContactReqBean | { peerIds: List<Long> } |
| 通讯录 v2 GET /contacts/（query） | ContactV2ReqBean | query: { gVersion, mVersion, rVersion, oVersion: Long }（各分组版本号，-1 全量） |
| 搜索 GET /search2（query） | SearchRequestParams | query: { size(默认20), page(默认0), schoolId, excludeReviewingSchool }；响应分页 SearchResponse{ content[], numberOfElements, number, first, last, size, sort, totalElements, totalPages } |
| 群信息列表 POST /groups/info | GroupRequestBean | 群查询条件（含分页/筛选） |

#### 5.16.2 群组（Group）

| 接口 | 请求 Bean | 业务字段（Body 内 K 的 JSON 结构） |
|---|---|---|
| 群列表（批量）POST /groups/batch | GetChatGroupListReqBean | { groupVersionList: [{ groupId:int, version:int, all:bool, detail:bool }] }（增量拉取群信息） |
| 更新群信息 PUT /groups/{groupId} | ChatGroupUpdateReqBean | { avatar, name, joinedMembers:List<Integer>, removedMembers:List<Integer> } |
| 设置/取消群禁言 PUT /groups/{groupId}/silence | GroupShieldReqBean | { adds:List<Integer>, removes:List<Integer> }（禁言成员ID） |
| 成员打卡屏蔽 POST /groups/{gid}/pic/member/{open|close} | GroupMemberCameraShieldReqBean | { memberIds: List<Integer> } |
| 笔记白名单 PATCH /groups/{gid}/note/white/list | GroupMemberNoteShieldReqBean | 继承 Camera：{ memberIds:List<Integer>, type:bool } |
| 群转让申请编辑 | GroupTransferEditReq（ArrayList） | 元素为 GroupTransferEditReqItem 的列表 |
| 群公告/通知 POST /notices/ | ShareGroupMsgReqBean | { content, createTime:long, members:List<Integer>, msgType, resourceId, tags:[{key,value}], title } |

#### 5.16.3 会话 / 聊天消息（Message）

| 接口 | 请求 Bean | 业务字段（Body 内 K 的 JSON 结构） |
|---|---|---|
| 发送消息 POST /sessions/{sessionId}/messages/ | ChatMsgReqBean | { createTime:long, msgContent, msgId:long, msgType, quote, resourceId, retry:bool, sessionType:int, token } |
| 获取消息列表 GET /sessions/{sid}/messages/（query） | ChatMsgHistoryReqBean | query: { msgCount:int, msgIdBegin:int, sessionType } |
| 批量已读回执 PATCH /readAck | BatchConfirmMsgReqBean | { list: [{ msgId:long, sessionId:int, sessionType }] } |
| 批量转发 POST /forward | BatchForwardMsgReqBean | { messages: [{ msgType, msgContent }], sessions: [{ sessionType, sessionId:long, token:List<String>, updateSession:bool }] }（ForwardMessages/ForwardTarget） |
| 转发结果查询 POST /forward/res | ForwardResReqBean | { queries: [{ sessionId:long, sessionType, tokens:Set<String> }] }（ForwardRes） |
| 单条转发 POST /forward/single | ForwardSingleReqBean | { messages:{ msgContent, msgType }, sessions:[{ sessionType, sessionId, createNoticeGroup:bool, token }], noticeGroup:{ tags[], token, title }, async:bool } |
| 查询消息状态 POST /sessions/messages/sent | CheckMessagesStatusReqBean | { sessions: [{ sessionId, sessionType:int, tokens:List<String> }] } |
| 单条消息状态 POST /sessions/{sid}/messages/status | CheckMsgReadStatusReqBean | 含消息ID/状态变更信息 |
| 在线答疑开始 POST /sessions/{sid}/oa | OnlineAnswerReqBean | { answerType(AUDIO), imageUrls:List<String>, sessionType, token } |
| 在线答疑结束 POST/DELETE /sessions/{sid}/oa/{oaId} | EndOnlineAnswerReqBean | { duration:int, status(SUCCESS|BUSY|TIMEOUT|REFUSED|CANCELED) } |

#### 5.16.4 笔记 / 资源

| 接口 | 请求 Bean | 业务字段（Body 内 K 的 JSON 结构） |
|---|---|---|
| 新增笔记 POST /user/{userId}/note/add | HandWritingNoteBean | { handUrl, imageBean: HandWritingNoteExtend }；HandWritingNoteExtend 继承 UpdateNoteExtend{mDensity:float, screenWidth, screenHeight, leftMargin, topMargin, width, height:int} 并增加 imageUrl |
| 上传版本 POST /users/{userId}/clients/ | UploadVersionReqBean | { clientId, deviceId, versionCode:int, versionName } |

#### 5.16.5 其它常见 POST 请求体（Map/Json 结构）

| 接口 | 请求体结构 |
|---|---|
| 二维码确认 POST /auth/qrcode/confirm | { authType, confirm:Boolean, uuid }（LinkedHashMap） |
| 群打卡状态 POST /groups/{gid}/pic/{open|close} | Map<String,Long>（成员ID->时间戳） |
| 群笔记操作 PATCH /groups/{gid}/note/operation | Map<String,Object> |
| 批量删除群 DELETE /groups/batch | List<DeleteGroup> |
| 批量删除会话 DELETE /sessions | DeleteSessionsReq |
| 反馈批量操作 POST /reply/review/batch | ReplyBatchOpParam（批次操作参数） |
| 通讯录指定 POST /contacts/specific | Map<String,String> |

---
## 6. 常用字段 / 枚举 / 常量

- 消息类型：FileType、TargetType、ForwardTarget、ModeMsgStyle1/2/3、ShareChatMsgBase（作业 ShareMsgHomeWorkBean、课程 ShareMsgCourseBean、考试 ShareMsgExamLinkBean）。
- 会话分组：Session、SessionsBean、Group、SessionGroup。
- 分页：Pageable、QuizPageModel<T>。
- 通用响应基类：BaseResponseBean、BaseRequestBean.HttpRespone。

---

## 7. 常见错误处理

- 网络失败统一走 XHErrorCodeUtil（XH_PARSE_RESULT_NULL_FAIL、XH_PARSE_TYPE_FAIL、XH_FS_MULTI_DOWNLOAD_EXIST_FAIL_FILE 等）。
- 业务错误从 httpResponse 解析为 FailMsg{traceId, code, msg}。
- 失败提示模板：当前网络不佳，请重试。错误信息：{msg}（getRealNetFailMsg）。
- HTTP 状态码描述表：HttpConst.httpCodeToDescription（100~504）。

---

## 8. 说明与免责

本 API 文档由静态反编译逆向整理，路径、字段、枚举均为推断值；混淆后类名/字段名（如 C39561、f2287D、p035v3、p036xh）不影响业务语义。仅供安全研究、兼容性分析或教学使用，请勿用于任何违规用途。
