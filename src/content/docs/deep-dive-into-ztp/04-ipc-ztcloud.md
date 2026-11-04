---
title: "跨进程通信与推送长连接"
description: "智通平台的 ContentProvider IPC、Messenger 消息与推送 TCP 长连接"
categories:
  - 技术解析
excerpt: 通过反编译解析智通平台的 MyContentProvider 跨进程数据交换、IpcHelper Messenger 消息与自研推送长连接协议。
---

# 智通平台跨进程通信与推送长连接解析

## 前言

智通平台（ZTP）与学海系其他应用（智通云、题舟、云课堂等）通过 **ContentProvider / Messenger / TCP 长连接 / Intent** 四种通道进行跨进程通信。本文聚焦前三者（Intent 开放 SDK 见 `12-ipc-open-sdk.md`）。

涉及源码包：
- `com.xuehai.launcher.component.provider` — ContentProvider 与 DAO
- `com.xuehai.launcher.data.util` — ProviderUtil / IpcHelper
- `com.xuehai.message` — 推送长连接 SDK

---

## 一、ContentProvider 跨进程数据交换

### 1.1 MyContentProvider

`com.xuehai.launcher.component.provider.MyContentProvider` 的 authority 为 `com.xh.zhitongyun.provider`，定义 4 个 URI：

| URI | 表/虚拟表 | 用途 |
|-----|-----------|------|
| `content://com.xh.zhitongyun.provider/cache` | `cahce` | 键值缓存 |
| `content://com.xh.zhitongyun.provider/client` | 虚拟表 | 客户端自身信息 |
| `content://com.xh.zhitongyun.provider/control` | 虚拟表 | 管控策略查询 |
| `content://com.xh.zhitongyun.provider/appModelPermission` | 虚拟表 | 应用模块权限 |

所有 CRUD 转发给 `ContentProviderSQLite`，insert 后 `notifyChange` 通知观察者。`query/insert/delete/update` 都要求 `BaseApplication.INSTANCE.isCreated()` 为真。

```java
public static final Uri cacheUri = Uri.parse("content://com.xh.zhitongyun.provider/cache");
public static final Uri clientUri = Uri.parse("content://com.xh.zhitongyun.provider/client");
public static final Uri controlUri = Uri.parse("content://com.xh.zhitongyun.provider/control");
public static final Uri appModulePermissionUri = Uri.parse("content://com.xh.zhitongyun.provider/appModelPermission");
```

### 1.2 ContentProviderSQLite

数据库文件 `zaze_provider.db`，版本 10。单例持有 `Map<Uri, BaseDao>` 路由到对应 DAO。升级时逐个 `updateTable()`，降级时 `dropTable()` 后重建。

```java
private void initDAOs(SQLiteDatabase sQLiteDatabase) {
    if (this.daoMap.isEmpty()) {
        this.daoMap.put(MyContentProvider.cacheUri, new CacheDao(sQLiteDatabase));
        this.daoMap.put(MyContentProvider.clientUri, new ClientDao(sQLiteDatabase));
        this.daoMap.put(MyContentProvider.controlUri, new ControlDao(sQLiteDatabase));
        this.daoMap.put(MyContentProvider.appModulePermissionUri, new AppModulePermissionDao(sQLiteDatabase));
    }
}
```

### 1.3 DAO 实现

- **CacheDao**：真实表 `cahce(_id INTEGER PRIMARY KEY AUTOINCREMENT, _key VARCHAR, _value VARCHAR)`，`dropTable/updateTable` 为空实现（表永不删除）。
- **ClientDao**：**虚拟表**。`query` 时构造 `MatrixCursor`，返回 `ClientConfig` 的包名、版本名、版本码、客户端类型。
- **ControlDao**：**虚拟表**。根据 selection 的 `controlType`（`SCENE_CONTROL`/`LONG_TIME_CONTROL`/`MODULE_CONTROL`/`NIGHT_CONTROL`）与 `packageName`，从 `ControlModel` 实时计算管控结果，序列化为 JSON 返回。
- **AppModulePermissionDao**：**虚拟表**。根据 `packageName` 从 `AppModel.getAppModulePermissions()` 取模块权限，moduleKey 逗号拼接返回。
- **ObjectDao<T>**：泛型 DAO 基类，提供 `queryWhere/queryWhereList/insert/update`。

> 关键点：`client`、`control`、`appModelPermission` 三个 URI 是**计算型虚拟表**，数据实时来自内存模型，其他进程查询到的是最新策略。

### 1.4 ProviderUtil 封装

`com.xuehai.launcher.data.util.ProviderUtil` 封装上层调用（底层是 `com.xuehai.provider.core` 的 CPVD* 跨进程存储）：

- `saveUser/loadUser` → `CPVDUserData`（跨进程用户数据，含 loginStatus）
- `getMessageUnReadCount/readAllMessage` → `MessageCache`/`CPVDMessageData`
- `updateApp/getAppInfo` → `CPVDAppData`（按 userId 隔离）
- `getOrganization/updateOrganization` → `CPVDOrganizationData`
- `getControlApp/updateControlApp` → `CPVDControlAppManager`
- `updateRemoteConfig` → `CPVDRemoteConfig` + 最小存储空间缓存
- `exit/markLoginOut` → 清空 accessToken、置 `loginStatus=2`、发 `com.xuehai.third.exit` 广播
- `onClearData` → 发 `BroadcastAction.APPLICATION_EXIT` 定向广播

```java
public static final void markLoginOut() {
    SessionData.INSTANCE.markAutoLogin(false);
    Account latelyAccount = ModelFactory.getAccountModel().getLatelyAccount();
    if (latelyAccount != null) {
        String accessToken = latelyAccount.getAccessToken();
        if (!(accessToken == null || accessToken.length() == 0)) {
            latelyAccount.setAccessToken("");
            accountModel.saveLatelyAccount(latelyAccount);
        }
    }
    CPVDUser cPVDUserLoadUser = loadUser(BaseApplication.INSTANCE.getInstance());
    if (cPVDUserLoadUser != null && cPVDUserLoadUser.getLoginStatus() != 2) {
        cPVDUserLoadUser.setLoginStatus(2);
        saveUser(cPVDUserLoadUser);
    }
    SessionData.INSTANCE.clearCache();
}
```

---

## 二、Messenger IPC

`IpcHelper` 使用 `android.os.Messenger` 做轻量级进程间消息：

| 常量 | 值 | 含义 |
|------|-----|------|
| `BC_ASSIST` | 2000001 | 发送辅助消息（携带 `message_key`） |
| `BC_GETSTATUS` | 2000002 | 查询状态 |
| `BR_LOOP` | 1000001 | 循环消息 |

```java
public static void sendAssistMessage(Messenger messenger, String str) throws RemoteException {
    Message messageObtain = Message.obtain();
    Bundle bundle = new Bundle();
    bundle.putString(MESSAGE_KEY, str);
    messageObtain.setData(bundle);
    messageObtain.what = BC_ASSIST;
    sendIPC(messenger, messageObtain);
}
```

---

## 三、推送长连接（TCP Socket IPC）

`com.xuehai.message.sdk` 是智通平台自研推送 SDK，通过 TCP 长连接与推送服务器通信，是**最重要的 IPC 通道**。

### 3.1 连接生命周期

```
PushApi.initialize(config)
  └─ PushTaskExecutor.execute(CMD_INITIALIZE=1)
       └─ PushCore.initialize()
            ├─ 注册 PushAlarmReceiver / PushScreenReceiver / NetworkObserver
            └─ new PushClient(config, walkman).connect()
                 ├─ TcpClient.connect()  // 阻塞建连，timeOut 默认 10s
                 └─ onEvent(CONNECT_OK=0)
                      ├─ 创建 IDManager
                      ├─ auth()  // 发送 Authorization 报文
                      └─ 定时心跳 scheduleAtFixedRate(heartbeatTask, 1s, heartbeatPeriod)
```

断线后 `onEvent` 走 `RetryRuleV1` 退避重连（默认 3s 起步，每 5 次递增，上限 600s），并通过 `AlarmWalkman` 设置精确闹钟兜底唤醒。

### 3.2 报文协议（PacketEncoder / PacketDecoder）

**包头（4 字节）**：

| 偏移 | 字段 | 说明 |
|------|------|------|
| 0 | MAGIC | 固定 `0x09` |
| 1 | version | 协议版本（Authorization/Heartbeat 为 3） |
| 2 | cmd | 命令字 |
| 3 | length 首字节 | 高 2 位为长度字节数-1，低 6 位为长度高位 |

长度字段是变长编码：`lenOfBytes = (byte3 >> 6) & 3`，随后读取 `lenOfBytes` 个字节拼出 body 长度（`bodyLength = value - 3`，即去掉 4 字节头中的 3 字节）。`MAX_PACKET_LENGTH = 10MB`。

```java
public final ByteBuffer encode(Proto proto) {
    ByteBuffer byteBufferAllocate = proto.allocate();
    byteBufferAllocate.clear();
    byteBufferAllocate.put((byte) 9);          // MAGIC
    byteBufferAllocate.put(proto.getVersion()); // version
    byteBufferAllocate.put(proto.getCMD());     // cmd
    writeLength(byteBufferAllocate, proto.getLength());
    proto.encodeContent(byteBufferAllocate);
    byteBufferAllocate.flip();
    return byteBufferAllocate;
}
```

**命令字表（MessageCmd）**：

| 命令 | 值 | 方向 | 说明 |
|------|-----|------|------|
| HEART_BEAT_CMD | 1 | C→S | 心跳，内容 1 字节（亮屏=1/灭屏=0） |
| AUTHORIZATION_CMD | 2 | C→S | 认证 |
| MESSAGE_CMD | 3 | S→C | 推送消息 |
| PULL_CMD | 5 | C→S | 拉取离线消息（start/end 两个 int） |
| ECHO_CMD | 50 | 双向 | 连接探测（ack 奇偶判断 ask） |
| AUTHORIZATION_FB_CMD | -126 (0x82) | S→C | 认证回执 |
| MESSAGE_FB_CMD | -125 (0x83) | C→S | 消息回执 |
| ERROR_FB_CMD | -117 (0x8B) | S→C | 错误回执 |

### 3.3 认证流程（Authorization）

`PushClient.auth()` 构造认证报文：

```java
String signature = Signer.computeSignature(config.getSecurityKey(), config.getDeviceId());
// = Base64( HMAC-SHA256( securityKey, deviceId ) )
Authorization auth = new Authorization(
    accessKey,          // 应用 accessKey
    deviceId,           // 设备号
    clientId,           // 上次保存的 clientId（可为空）
    signature,          // HMAC-SHA256 签名
    "",                 // token（预留）
    String.valueOf(userId),
    userId + "," + schoolId   // tags
);
```

服务器回 `Authorization.Feedback(clientId, token, code)`，`code` 语义见 `ReturnCodes`：

| code | 含义 |
|------|------|
| 100 | 认证通过 |
| 101 | 认证通过，但 clientId 不对，需保存新 clientId |
| 201 | 签名校验错误 |
| 202 | token 校验错误 |

认证结果通过 `PushActionHelper` 以本地广播 `com.xuehai.message.sdk.ACTION_AUTH` 发出，携带 `KEY_CODE` 与 `KEY_CLIENT_ID`。

### 3.4 消息去重（IDManager）

`IDManager` 用 `HashSet<Long>` 记录已处理过的 `msgId`。收到 `MESSAGE_CMD` 后，对每个 entry 检查 `idManager.exists(msgId)`，未处理过的才回调 `PushActionHelper.onReceiverMessage(json)`，并回发 `MessageFeedback`（每个 entry 9 字节：8 字节 msgId + 1 字节 state）。

```java
private final void dealMessage(Message message) {
    ArrayList arrayList = new ArrayList();
    MessageFeedback messageFeedback = new MessageFeedback();
    List<Message.Entry> entries = message.getEntries();
    if (entries != null) {
        for (Message.Entry entry : entries) {
            messageFeedback.addEntry(entry.getMsgId());
            IDManager iDManager = this.idManager;
            if (iDManager == null || !iDManager.exists(entry.getMsgId())) {
                arrayList.add(entry);
            }
        }
    }
    boolean zSend = send(messageFeedback);
    if ((!arrayList.isEmpty()) && zSend) {
        for (MessageFeedback.Entry entry2 : messageFeedback.getEntries()) {
            this.idManager.add(entry2.getMsgId());
        }
        PushActionHelper.INSTANCE.onReceiverMessage(PushJsonUtil.objToJson(arrayList));
    }
}
```

### 3.5 心跳与保活

- 心跳周期默认 90s（`PushConstants.HEART_DELAY`），`Heartbeat` 报文内容 1 字节（亮屏=1/灭屏=0）。
- `PushAlarmReceiver` 每 2 个心跳周期设置一次精确闹钟（`AlarmWalkman`，API 23+ 用 `setExactAndAllowWhileIdle`），闹钟触发时若断线立即重连，否则 `checkConnectStatus()` 发 Echo 探测。
- `PushScreenReceiver` 监听亮灭屏，亮屏时立即心跳。
- `NetworkObserver` 监听网络变化，恢复时 `restoreConnect()`。

### 3.6 推送状态文件（PnServer / PnStatus）

连接状态写入外部存储 `/xuehai/config/pn-message/status.txt`（JSON `{"isEnable":true/false}`），`PnServer` 用 `FileObserver` 监听该文件，其他进程（如智通云）通过读该文件感知推送服务是否存活；`status.lock` 用 `FileLock` 做互斥。

```java
public static void startWatching(PnObserver pnObserver2) {
    pnObserver = pnObserver2;
    if (fileObserver == null) {
        if (Utils.recreateFile(filePath)) {
            FileObserver fileObserver2 = new FileObserver(filePath) {
                @Override
                public void onEvent(int i, String str) {
                    int i2 = i & UnixStat.PERM_MASK;
                    if (i2 == 8) {   // MODIFY
                        PnServer.pnObserver.onPnStatusChanged(PnServer.getPnStatus());
                    } else if (i2 == 1024) {  // DELETE_SELF
                        PnServer.fileObserver.stopWatching();
                        PnServer.fileObserver = null;
                        PnServer.startWatching(PnServer.pnObserver);
                    }
                }
            };
            fileObserver = fileObserver2;
            fileObserver2.startWatching();
        }
    }
}
```

---

## 四、令牌层

### 4.1 REST API 令牌（accessToken）

- 登录成功后 `Account.accessToken` 保存到本地（`AccountModel.saveLatelyAccount`）。
- 所有 REST 请求经 `BaseRemoteDataSource` 自动附加 `Authorization: Bearer <accessToken>` 头（配合 `UserId`、`Tenant`、`AppCode` 头，再叠加 URL 签名，见 `xuehai-sign.md`）。
- 登出时 `ProviderUtil.markLoginOut()` 把 `accessToken` 置空并保存，同时把 `CPVDUser.loginStatus` 置为 2。
- `SessionData.getAccessToken()` 是全局取令牌入口。

### 4.2 推送令牌（PushConfig）

推送连接需要 4 个凭据：

| 字段 | 来源 | 说明 |
|------|------|------|
| accessKey | `PushMetaData.PUSH_APP_ID` | 应用 ID |
| securityKey | `PushMetaData.PUSH_APP_SECRET` | 应用密钥，用于 HMAC-SHA256 签名 |
| deviceId | 设备号 | 与 REST 层一致 |
| clientId | `PushSharedPrefUtil` 的 `sp_client_id` | 服务器签发，认证回执 code=101 时更新 |

`LauncherSPUtil` 的 `launcher_push_client_id_<userId>` 也保存 clientId，`isClientChanged` 用于检测 clientId 是否变化。

### 4.3 加密工具

- **EncryptUtils**：XOR 加密。密钥为 `XH_SIGNATURE_KEY = "eptim]q34imt5b]-q04i5q=fdkfjfsadlkjfasdfrt573df4pltoy]-pn965498d"`（与 `xuehai-sign.md` 中的签名密钥相同），逐字节异或后 Base64。
- **PasswordEncryptor**：`Random(seed=当前毫秒时间戳)` 生成伪随机流逐字节异或，末尾追加 8 字节时间戳，Base64 输出。解密时取末 8 字节还原种子。
- **StringEncryptUtils**：混淆 Base64。96 字符的置换表 + 校验码（`9 - (sum % 10)`）+ 13 位时间戳，**解密有效期 5 分钟**。
- **SecretUtil**：随机字符串生成器（`createRandomText`），用于动态码等场景。
- **Signer**：HMAC-SHA256 + Base64，用于推送认证签名。

### 4.4 设备授权与签名状态

- **DeviceLicense**：`id/key/type/status`，`LicenseStatus`：`BIND=0`、`ACTIVED=1`、`UNBIND=3`；`LicenseType.COMMON=0`。随 `CheckDataEntity.sdkLicenses` 下发。
- **SignatureInfo**：`deviceStatus/signInStatus/protocolStatus/partsStatus`，`SignatureStatus`：`NO_STATUS=1`、`NOT_SIGNATURE=2`、`NEEDLESS_SIGNATURE=3`、`FINISH_SIGNATURE=4`。`isOfflineLoginEnable()` 在签名完成或无需签名时允许离线登录。
- **SystemRemoteDataSource** 相关接口：
  - `checkDevice` → `GET /api/v1/pub/platform/check/device`（deviceId/imei/tocPlatform/verifyRegistrationAble/additionalAuthorization）
  - `registerDevice` → `POST /api/v1/users/<userId>/devices`（deviceId/model/os/mac/imei/root）
  - `activeLicense` → `PATCH /api/v1/pri/devices/license/activate`（allocationId）
  - `deviceIdentify` → `POST /api/v1/admin/platform/user/identifyDemo`（authCode/devNumber/devType/mac/imei）

### 4.5 会话状态

- `SessionData.sessionState` 是 `StateFlow<SessionState>`，`isSessionEnable()` 判断会话是否可用。
- `SessionData.isLogin()` 依赖 `CPVDUser.loginStatus == 1`（跨进程登录态）。
- `canAutoLogin()` = 已登录 且 `autoLoginVersion` SP 值 ≥ `ClientConfig.autoLoginVersion()`。

---

## 五、关键结论

1. **ContentProvider 是跨进程数据交换主通道**：真实表（cache）+ 计算型虚拟表（client/control/appModulePermission）。
2. **推送长连接是自研二进制协议**：MAGIC=0x09 + version + cmd + 变长 length，命令字覆盖心跳/认证/消息/回执/拉取/探测。
3. **认证用 HMAC-SHA256**：`Base64(HMAC-SHA256(securityKey, deviceId))`，服务器签发 clientId。
4. **消息按 msgId 去重并回执**：`IDManager` 的 HashSet 保证不重复处理。
5. **推送状态通过文件共享**：`/xuehai/config/pn-message/status.txt` + FileObserver，跨进程感知推送存活。

## 附：关键文件索引

| 文件 | 作用 |
|------|------|
| `launcher/component/provider/MyContentProvider.java` | ContentProvider 入口 |
| `launcher/component/provider/ContentProviderSQLite.java` | 数据库 + DAO 路由 |
| `launcher/component/provider/BaseDao.java` | DAO 基类 |
| `launcher/component/provider/CacheDao.java` | 缓存表 |
| `launcher/component/provider/ClientDao.java` | 客户端虚拟表 |
| `launcher/component/provider/ControlDao.java` | 管控虚拟表 |
| `launcher/component/provider/AppModulePermissionDao.java` | 模块权限虚拟表 |
| `launcher/data/util/ProviderUtil.java` | CPVD 跨进程封装 |
| `launcher/data/util/IpcHelper.java` | Messenger IPC |
| `message/sdk/PushCore.java` | 推送核心 |
| `message/sdk/client/PushClient.java` | 推送客户端状态机 |
| `message/sdk/TcpClient.java` | TCP 长连接 |
| `message/sdk/proto/PacketEncoder.java` | 报文编码 |
| `message/sdk/decode/PacketDecoder.java` | 报文解码 |
| `message/sdk/proto/Authorization.java` | 认证报文 |
| `message/sdk/security/Signer.java` | HMAC-SHA256 签名 |
| `message/sdk/IDManager.java` | 消息去重 |
| `message/oberver/PnServer.java` | 推送状态文件监听 |