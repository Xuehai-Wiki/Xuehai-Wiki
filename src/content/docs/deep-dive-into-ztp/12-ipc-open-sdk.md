---
title: "开放 SDK（Intent IPC）"
description: "学海系应用间的分享/跳转开放 SDK"
categories:
  - 技术解析
excerpt: 通过反编译解析 com.xuehai.open 开放 SDK 的入口发现、请求/响应流程与媒体对象序列化。
---

# 智通平台开放 SDK 解析

## 前言

`com.xuehai.open` 是学海系应用间的分享/跳转 SDK（类似微信开放平台），基于 **Intent + Bundle** 通信，不依赖 ContentProvider 或 Binder。本文梳理其入口发现、请求/响应流程与媒体对象序列化。

涉及源码包：
- `com.xuehai.open` — 入口管理、初始化、工具
- `com.xuehai.open.api` — API 接口与事件分发
- `com.xuehai.open.base` — 请求/响应基类
- `com.xuehai.open.msg` — 媒体消息对象
- `com.xuehai.open.constants` — 常量

---

## 一、入口发现（EntryManager）

### 1.1 初始化

`InitProvider.onCreate` 注册 `PackageReceiver`（监听 PACKAGE_ADDED/REPLACED/REMOVED），后台线程扫描所有非系统应用，读取每个应用 assets 里的 `share.json`，解析为 `EntryItem` 注册到 `entryItemMap`。

```java
@Override
public boolean onCreate() {
    try {
        Context context = getContext();
        if (context != null) {
            context.registerReceiver(new PackageReceiver(), PackageReceiver.INSTANCE.createIntentFilter());
        }
        Log.v(TAG, "sdkVersion : 3");
        new Thread(new Runnable() {
            @Override
            public final void run() {
                Context context2 = InitProvider.this.getContext();
                if (context2 != null) {
                    EntryManager.INSTANCE.getAllEntries(context2);
                }
            }
        }).start();
        return true;
    } catch (Throwable unused) {
        return true;
    }
}
```

### 1.2 EntryItem 结构

`share.json` 反序列化为 `EntryItem`：

```java
public class EntryItem {
    private String action;      // 目标 Activity 的 action
    private String packageName; // 目标包名
    private List<Scene> scenes; // 场景列表
    // Scene: type/name/icon/medias
    // Media: type
}
```

`tryToAddEntry` 读取目标应用的 `share.json`，校验 action 非空后注册；`removeEntry` 在应用卸载时移除并重建 `supportMedias` 集合。

### 1.3 查找入口

`findEntry` 优先返回 `com.xh.zhitongyunstu` / `com.xh.zhitongyuntch` 的入口，否则按 targetPkg 查找。

```java
public final synchronized EntryItem findEntry(Context context, String scene, String targetPkg) {
    if (Intrinsics.areEqual(SendMessageToXH.Req.XHSceneAll, scene)) {
        Map<String, EntryItem> allEntries = getAllEntries(context);
        EntryItem entryItem = allEntries.get("com.xh.zhitongyunstu");
        if (entryItem == null) {
            entryItem = allEntries.get("com.xh.zhitongyuntch");
        }
        if (entryItem != null) {
            return entryItem;
        }
        ...
    }
    ...
}
```

---

## 二、请求/响应流程（XHApi）

### 2.1 接口定义

```java
public interface IXHAPI {
    void detach();
    boolean handleIntent(Intent intent, IXHAPIEventHandler iXHAPIEventHandler);
    boolean request(BaseRequest baseRequest);
    boolean response(BaseResponse baseResponse);
    void setEventHandler(IXHAPIEventHandler iXHAPIEventHandler);
}
```

`XHAPIFactory.createXHAPI(Activity/Service)` 创建 `XHApi` 实例。

### 2.2 请求（request）

1. 把请求序列化进 Bundle（`_xh_command_type`=1），附加 `_xh_base_sdkVersion=3`
2. 通过 `EntryManager.findEntry` 找到目标应用的 action，`startActivity` 发送
3. 找不到入口则 `sendDirect` 直发 `com.xh.arespunc.share`（支持 image/homework/answer_card/exam/course 五种媒体类型）
4. 发送失败回调 `SendMessageToXH.Resp`（errorCode=-3）

```java
private boolean sendDirect(Bundle bundle) {
    String mediaType = SendMessageToXH.Req.getMediaType(bundle);
    switch (mediaType.hashCode()) {
        case -1354571749: if (mediaType.equals(XHMediaMessage.IMediaObject.TYPE_COURSE)) c = 4; break;
        case -485149584:  if (mediaType.equals("homework")) c = 1; break;
        case -312009999:  if (mediaType.equals(XHMediaMessage.IMediaObject.TYPE_ANSWER_CARD)) c = 2; break;
        case 3127327:     if (mediaType.equals(XHMediaMessage.IMediaObject.TYPE_EXAM)) c = 3; break;
        case 100313435:   if (mediaType.equals(XHMediaMessage.IMediaObject.TYPE_IMAGE)) c = 0; break;
    }
    if (c == 0 || c == 1 || c == 2 || c == 3 || c == 4) {
        Intent intent = new Intent("com.xh.arespunc.share");
        intent.setPackage("com.xh.arespunc");
        intent.putExtras(bundle);
        intent.addFlags(268435456);  // FLAG_ACTIVITY_NEW_TASK
        if (Build.VERSION.SDK_INT >= 19) {
            intent.addFlags(134217728);  // FLAG_ACTIVITY_CLEAR_TOP
        }
        return send(intent);
    }
    return false;
}
```

### 2.3 响应（response）

`response` 显式 `setClassName(targetApp, "com.xuehai.open.XHReturnActivity")` 拉起回调 Activity。

```java
public boolean response(BaseResponse baseResponse) {
    Bundle bundle = new Bundle();
    baseResponse.packageName = this.context.getPackageName();
    baseResponse.toBundle(bundle);
    addSDKVersion(bundle);
    if (baseResponse.getType() != 2) {
        return false;
    }
    String str = ((SendMessageToXH.Resp) baseResponse).targetApp;
    if (TextUtils.isEmpty(str)) {
        return false;
    }
    Intent intent = new Intent();
    intent.setPackage(str);
    intent.putExtras(bundle);
    intent.setClassName(str, "com.xuehai.open.XHReturnActivity");
    return send(intent);
}
```

### 2.4 事件分发

`XHReturnActivity` 实现 `IXHAPIEventHandler`，`onCreate/onNewIntent` 时 `handleIntent` 解析 `_xh_command_type`（1→`onRequest`，2→`onResponse`），回调 `EventHandlerManager` 中注册的 handler 后 `finish()`。

```java
public final class EventHandlerManager {
    private static IXHAPIEventHandler eventHandler;
    public final void addEventHandler(IXHAPIEventHandler handler) {
        eventHandler = handler;
    }
    public final void removeEventHandler(IXHAPIEventHandler handler) {
        if (Intrinsics.areEqual(eventHandler, handler)) {
            eventHandler = null;
        }
    }
}
```

---

## 三、媒体对象（XHMediaMessage）

### 3.1 类型常量

| 类型 | 值 | 实现类 |
|------|-----|--------|
| text | `text` | XHTextObject |
| image | `image` | XHImageObject |
| url | `url` | XHWebObject（IActionObject） |
| homework | `homework` | XHHomeworkObject |
| answer_card | `answer_card` | XHAnswerCardObject |
| exam | `exam` | XHExamObject |
| course | `course` | XHCourseObject |
| resource | `resource` | XHResourceObject |
| app_page | `app_page` | XHAppPageObject（IActionObject） |

### 3.2 序列化

每个对象实现 `toBundle/fromBundle`，序列化时写入 `_xh_object_identifier`（类名）以便反序列化时 `Class.forName` 重建。

```java
public static Bundle toBundle(XHMediaMessage xHMediaMessage) {
    Bundle bundle = new Bundle();
    bundle.putString("_xh_object_title", xHMediaMessage.title);
    bundle.putString("_xh_object_description", xHMediaMessage.description);
    bundle.putByteArray("_xh_object_thumbData", xHMediaMessage.thumbData);
    if (xHMediaMessage.mediaObject != null) {
        bundle.putString("_xh_object_identifier", xHMediaMessage.mediaObject.getClass().getName());
        xHMediaMessage.mediaObject.toBundle(bundle);
    }
    return bundle;
}
```

### 3.3 兼容字段

各对象在 `toBundle` 时除了写入 `_xh_*` 前缀字段，还写入**无前缀的兼容字段**（供旧版接收方解析）：

- XHImageObject：`content`、`shareType=IMAGE`
- XHHomeworkObject：`homeWorkId`、`dataUri`、`shareType`、`homeWorkTitle`、`userId`、`homeWorkDate`
- XHAnswerCardObject：`homeWorkId`、`dataUri`、`shareType=HOME_ANSWER_SHEET`、`homeWorkTitle`、`homeWorkCreator`、`userId`、`homeWorkDate`
- XHExamObject：`examId`、`examTitle`、`examCreatorName`、`examCreatorId`、`examDate`、`dataUri`、`shareType=EXAM_LINK`
- XHCourseObject：`courseId`、`url`、`shareType=MCRO_COURSE`、`courseTitle`、`courseSubTitle`、`courseDuration`、`courseDate`、`microTitle`、`userName`、`lectureId`、`topicId`、`workId`

### 3.4 资源对象（XHResourceObject）

`resource` 类型是复合对象：`resourceObject`（实际媒体）+ `resourceAction`（跳转动作），各自带独立的 `_identifier` 字段反序列化。

---

## 四、常量

```java
public interface ConstantsOpen {
    int CMD_UNKNOWN = 0;
    int CMD_SEND_MESSAGE = 1;   // 请求
    int CMD_REPLAY_MESSAGE = 2; // 响应
    String COMMAND_TYPE = "_xh_command_type";
    long sdkVersion = 3;
}
```

`BaseRequest.toBundle` 写入：`_xh_command_type`、`_xh_base_req_transaction`、`_xh_base_req_packageName`、`packageName`。
`BaseResponse.toBundle` 写入：`_xh_command_type`、`_xh_base_resp_errorCode`、`_xh_base_resp_errorStr`、`_xh_base_resp_transaction`、`_xh_base_resp_packageName`。

`BaseResponse.ErrorCode`：`OK=0`、`SENT_FAILED=-1`、`USER_CANCEL=-2`、`UN_SUPPORT=-3`。

---

## 五、关键结论

1. **Intent 级 IPC**：开放 SDK 完全基于 `startActivity` + Bundle 传递数据，无 Binder/ContentProvider 依赖。
2. **入口发现靠 share.json**：扫描已安装应用的 assets 资源，动态注册/卸载分享入口。
3. **双序列化兼容**：`_xh_*` 前缀字段 + 无前缀兼容字段，兼容新旧版本接收方。
4. **回调链**：`XHReturnActivity` 作为统一回调 Activity，经 `EventHandlerManager` 单例分发到业务 handler。

## 附：关键文件索引

| 文件 | 作用 |
|------|------|
| `open/InitProvider.java` | 初始化 + 注册包监听 |
| `open/EntryManager.java` | 入口发现与注册 |
| `open/PackageReceiver.java` | 包增删改监听 |
| `open/XHReturnActivity.java` | 统一回调 Activity |
| `open/OpenUtil.java` | share.json 解析 |
| `open/FileUtil.java` | 文件工具 |
| `open/api/XHApi.java` | API 实现 |
| `open/api/XHAPIFactory.java` | API 工厂 |
| `open/api/EventHandlerManager.java` | 事件分发 |
| `open/api/IXHAPI.java` | API 接口 |
| `open/api/IXHAPIEventHandler.java` | 事件回调接口 |
| `open/base/BaseRequest.java` | 请求基类 |
| `open/base/BaseResponse.java` | 响应基类 |
| `open/constants/ConstantsOpen.java` | 常量 |
| `open/msg/SendMessageToXH.java` | 请求/响应消息 |
| `open/msg/XHMediaMessage.java` | 媒体消息容器 |
| `open/msg/XHTextObject.java` | 文本对象 |
| `open/msg/XHImageObject.java` | 图片对象 |
| `open/msg/XHWebObject.java` | 网页对象 |
| `open/msg/XHHomeworkObject.java` | 作业对象 |
| `open/msg/XHAnswerCardObject.java` | 答题卡对象 |
| `open/msg/XHExamObject.java` | 考试对象 |
| `open/msg/XHCourseObject.java` | 课程对象 |
| `open/msg/XHResourceObject.java` | 资源对象 |
| `open/msg/XHAppPageObject.java` | 应用页对象 |