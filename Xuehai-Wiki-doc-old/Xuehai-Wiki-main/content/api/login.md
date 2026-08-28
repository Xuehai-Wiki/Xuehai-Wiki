---
title: 登录
description: 学海登录API
order: 1
---

# 用户登录认证API

**`/api/v2/platform/login`** 是智通平台用于用户登录认证的RESTful API端点。该接口支持多种登录方式，包括账号密码、手机短信、第三方应用（如微信、天翼）等，并返回包含用户信息、认证令牌及设备绑定等数据的JSON响应。

---

## 端点信息

| 属性 | 值 |
|------|-----|
| 路径 | `/api/v2/platform/login` |
| HTTP方法 | `POST` |
| 功能 | 用户身份验证与登录会话建立 |
| 数据格式 | 请求体：`application/json`；响应体：`application/json` |

---

## 请求头（Header）

客户端可在请求头中传递以下可选参数：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `UserId` | Integer | 否 | 用户ID |
| `SchoolId` | Integer | 否 | 学校ID |
| `Tenant` | String | 否 | 租户代码 |
| `TenantCode` | String | 否 | 租户代码 |

---

## 请求体参数

请求体为JSON对象，参数如下（加粗表示条件必填）：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `userName` | String | 是 | 用户名或手机号 |
| `password` | String | 条件 | 密码，需经MD5哈希后转为大写；账号登录时必填 |
| `loginType` | int | 是 | 登录类型，取值见下方枚举 |
| `deviceId` | String | 是 | 设备唯一标识 |
| `osDisplay` | String | 是 | 系统显示信息（例如 `Build.DISPLAY`） |
| `imei` | String | 是 | 设备IMEI码 |
| `ap` | String | 是 | 网络类型（如Wi-Fi、蜂窝） |
| `mac` | String | 条件 | MAC地址；若设备支持则必填，否则传空字符串 |
| `isNew` | boolean | 是 | 是否新用户 |
| `activationCode` | String | 是 | 激活码 |
| `installTime` | long | 是 | 应用安装时间戳（毫秒） |
| `mdmVersionCode` | int | 是 | MDM客户端版本号 |
| `mdmVersionName` | String | 是 | MDM客户端版本名称 |
| `forceActivateBenefit` | Boolean | 否 | 是否强制激活权益 |
| `state` | String | 条件 | 状态值（天翼登录时需提供） |
| `smsCode` | String | 条件 | 短信验证码（手机短信登录时必填） |
| `code` | String | 条件 | 二维码凭证（二维码登录时必填） |
| `operatorId` | Long | 条件 | 操作员ID |
| `boundTenantAppCode` | String | 条件 | 绑定的租户应用代码 |
| `boundTenantCode` | String | 条件 | 绑定的租户代码 |

---

## 登录类型（`loginType`）

| 值 | 常量名 | 说明 |
|----|--------|------|
| 0 | `UN_KNOW` | 未知类型 |
| 1 | `ACCOUNT` | 账号密码登录 |
| 3 | `PHONE` | 手机号登录 |
| 4 | `PHONE_SMS` | 手机短信验证码登录 |
| 5 | `ACCOUNT_OR_PHONE` | 账号或手机号登录 |
| 6 | `WE_CHAT` | 微信登录 |
| 9 | `ZSCM` | 浙数登录 |
| 10 | `QR_XY` | 二维码登录 |
| 13 | `YUE_QING` | 越清登录 |
| 15 | `TIAN_YI` | 天翼登录 |
| 99 | `EDU_CLOUD` | 教育云登录 |

---

## 响应

成功响应返回一个JSON对象，映射为平台定义的 `Account` 数据结构。主要字段包括：

- **用户信息**：`userId`、`userName`、`userType` 等
- **认证令牌**：`accessToken`、`expiresIn` 等
- **学校信息**：`schoolId`、`schoolName` 等
- **设备绑定信息**
- **签名相关字段**（如 `uv`、`randomStr`）
- **时间戳对象**（`timestampDTO`），包含服务端时间

若登录过程中需要进一步绑定（如微信首次登录），响应中会设置特定标志，客户端需据此引导用户完成后续流程。

---

## 调用流程

典型调用链如下：

1. 客户端构建 `LoginRequest` 对象，可通过工厂方法指定登录方式（如 `passwordLogin`、`phoneSMSLogin`、`weChatLogin`）。
2. 调用 `AccountRepository.userLogin(loginRequest)`，该方法内部转交至 `AccountRemoteDataSource.userLogin()`。
3. 远程数据源构造HTTP请求，填充请求头和请求体，并发送至服务端。
4. 服务端返回响应，经 `AccountRepository.unifiedDealLoginResult()` 处理，解析 `Account` 对象，并执行后续操作：
   - 若响应中包含密钥（`uv`、`randomStr`），则写入本地文件。
   - 保存最近登录的账号、密码（可选）。
   - 更新系统时间（从 `timestampDTO` 中获取）。
   - 处理班级列表、租户代码等附加信息。
   - 触发消息客户端注册、签名状态更新等。
5. 最终返回 `Observable<Account>` 对象，供调用方订阅。

---

## 实现备注

- 密码字段在发送前强制进行MD5加密并转换为大写字母。
- MAC地址字段仅在设备支持时传递；否则置为空字符串。
- 登录成功后，客户端需处理服务端下发的密钥信息，这些信息可能用于后续加密通信。
- 响应解析失败或状态异常时，会抛出相应的异常（如 `ResponseException`、`WeChatLoginException`），调用方需妥善处理。

---

## 引用来源

- 实现源码：`AccountRemoteDataSource.java`
- 请求对象工厂：`LoginRequest.java`
- 登录类型常量：`LoginRequest.java`
- 响应处理逻辑：`AccountRepository.java`