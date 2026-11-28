---
title: "Launcher MDM 能力的 AIDL 调用指南"

description: "智通云 Launcher 通过 AIDL 对外共享的 MDM 能力全貌：服务定位、两种接入方式、十一个能力分类、真实事务号、真机验证结果与五条使用注意"

categories:
  - 技术解析
  - 研究资料
excerpt: Launcher 把约 145 个设备管理能力通过一个没有权限声明的 AIDL 服务暴露出来：安装卸载、保活自启、防火墙、设备限制、系统控制、设备信息、许可激活、动态口令。本文给出服务定位方式、两种接入写法、能力清单、实测事务号与真实的边界条件。
password: xh-research-2026
---

# Launcher MDM 能力的 AIDL 调用指南

> 分析对象：Launcher 端 MDM 服务（`com.xuehai.launcher`）与其 AIDL 接口。
> 路径均相对反编译输出根目录，行号为反编译源文件行号。
> 配套阅读：[[research/attack-chain]]（该能力在链路中的位置）、[[research/unlocker-architecture]]（帧协议）、[[15-zty-mdm-startup]]（两个管理端的启动关系）。

## 一、结论速览

| 问题 | 答案 |
| --- | --- |
| 服务怎么找 | 固定 action `com.xuehai.system.mdm.action_aidl`，包名 `com.xuehai.launcher` |
| 需要申请权限吗 | **不需要**。服务声明里没有 `android:permission` |
| 暴露多少能力 | 约 145 个方法，分 11 类 |
| 怎么拿代理 | 先 `startService` 再 `bindService`，或直接 `bindService` + `Stub.asInterface` |
| 有调用方身份校验吗 | 没有。`MdmBinder` 不检查调用方 uid |
| 最大的坑 | 绑定必须在独立线程；连接存活窗口很短 |
| 能装应用吗 | 能，且**不校验签名** |

一句话概括：**这是整个体系里防护最薄的一层——一个无权限声明、无调用方校验的 AIDL 服务，却握着安装、卸载、保活、锁屏、改时间这些最重的权限。**

---

## 二、服务信息

| 项 | 值 |
| --- | --- |
| 包名（学生端） | `com.xuehai.launcher` |
| 包名（教师端） | `com.xuehai.response_launcher_teacher` |
| 服务类 | `com.xuehai.system.mdm.MdmService` |
| action | `com.xuehai.system.mdm.action_aidl` |
| AIDL descriptor | `com.xuehai.system.mdm.MdmAidlInterface` |
| 权限声明 | 无 |
| directBootAware | `true` |

清单声明（`AndroidManifest.xml:238-242`）：

```xml
<service
    android:name="com.xuehai.system.mdm.MdmService"
    android:directBootAware="true">
    <intent-filter>
        <action android:name="com.xuehai.system.mdm.action_aidl" />
    </intent-filter>
</service>
```

`directBootAware="true"` 意味着服务在用户解锁前（Direct Boot 阶段）就可用。这解释了为什么某些管控行为在开机瞬间就能生效。

---

## 三、两种接入方式

### 3.1 方式 A：走官方管理器

Launcher 内部自己用的写法，封装在 `MdmServiceManager`：

| 步骤 | 位置 | 行为 |
| --- | --- | --- |
| 1a | `MdmServiceManager.java:108` | 用固定 action 构造 Intent |
| 1b | `:121` | 探测目标包名是否存在 |
| 1c | `:133` | **先 `startService`，再 `bindService`** |
| 1d | `:45` | 从连接回调拿远程代理 |
| 1e | `:144` | 把连接登记进 `WeakHashMap` 缓存 |

拿代理的表达式：

```java
ServiceToken token = MdmServiceManager.bindService(ctx);
MdmAidlInterface sdk = token.getServiceBinder().getSdkServer();
```

关键：`getSdkServer()` 在 `onServiceConnected` 之前返回 `null`。这是最常见的空指针来源。

### 3.2 方式 B：手动绑定

不依赖管理器的直连写法：

```java
Intent intent = new Intent("com.xuehai.system.mdm.action_aidl");
intent.setPackage("com.xuehai.launcher");
ctx.bindService(intent, conn, Context.BIND_AUTO_CREATE);
// onServiceConnected 里：
MdmAidlInterface sdk = MdmAidlInterface.Stub.asInterface(service);
```

**必须放在独立线程。** 主线程绑定会因服务端初始化耗时导致超时或被判定为 ANR 风险。

---

## 四、调用链：从 action 到真正执行

四条主链，每条都记到了行号：

### 4.1 对外共享的入口链

| 段 | 位置 | 内容 |
| --- | --- | --- |
| 1a~1e | 见 §3.1 | 管理器侧发起与缓存 |
| 2a | `AndroidManifest.xml:312` | 服务声明 |
| 2b | `MdmService.java:15` | `onBind` 返回 `MdmBinder` |
| 2c | `MdmBinder.java:231` | 委托给 `PolicyManager` |
| 2d | `MdmBinder.java:127` | 防火墙代理 |
| 2e | `MdmBinder.java:1050` | 设备限制代理 |
| 3a | `MdmAidlInterface.java:3554` | `onTransact` 分发 |
| 3b | `MdmAidlInterface.java:4083` | 事务 89：批量授予运行时权限 |
| 3c | `MdmAidlInterface.java:4429` | 接口方法清单 |
| 3d | `MdmAidlInterface.java:4707` | 动态口令接口 |
| 3e | `MdmBinder.java:1014` | TOTP 实现 |
| 4a | `AndroidManifest.xml:112` | 厂商权限声明 |
| 4b | `AndroidManifest.xml:363` | `XHContentProvider` |
| 4c | `PermissionManager.java:64` | 内部自动赋权 |
| 4d | `MdmBinder.java:104` | **无调用方身份检查** |

### 4.2 为什么不需要申请权限

两件事共同导致：

1. 服务本身没声明 `android:permission`，任何应用都能 `bindService`；
2. 服务端在内部**自己给自己赋权**（`PermissionManager.java:64`），不依赖调用方持有权限。

也就是说，权限模型被内化了：调用方只需要能 bind，剩下的由服务自己解决。

---

## 五、能力分类

约 145 个方法，按用途分 11 类：

| 分类 | 典型能力 |
| --- | --- |
| 应用管理 | 静默安装、卸载、查询已安装列表、清数据 |
| 运行时权限 | 批量授予/撤销、查询授予状态 |
| 保活自启 | 加入常驻列表、加入自启列表、电池优化白名单 |
| 防火墙网络 | 应用级联网开关、域名/IP 黑白名单 |
| 设备限制 | 摄像头/麦克风/USB/蓝牙/截屏等硬件开关 |
| 系统控制 | 锁屏、解锁屏、重启、关机、改时间、改时区 |
| 设备信息 | 型号、序列号、IMEI、MAC、系统指纹、存储状态 |
| 设置读写 | `Settings.Global/Secure/System` 读写 |
| 许可激活 | 激活状态查询、许可写入 |
| 动态口令 | TOTP 校验（离线） |
| 其他 | 日志上传、截屏、录屏、文件读写 |

完整方法清单在 `MdmAidlInterface.java:4425-4714`。

---

## 六、实测事务号

AIDL 的 `onTransact` 按整型事务号分发。以下为真机核对过的一组（**事务号随版本变动，换版本必须重核**）：

| 方法 | 事务号 | 十进制 |
| --- | --- | --- |
| `installApplication` | `0x11` | 17 |
| `uninstallApplication` | `0x12` | 18 |
| `removeLockScreen` | `0x0c` | 12 |
| `addAppAlwaysRunningList` | `0x1d` | 29 |
| `addAppAutoRunningList` | `0x20` | 32 |
| `addPackageToBatteryOptimizationWhiteList` | `0x4f` | 79 |
| `lockScreen` | `0x5f` | 95 |
| `setAutomaticTime` | `0x25` | 37 |
| `setSystemTime` | `0x26` | 38 |
| `setDateTimeChangeEnabled` | `0x6b` | 107 |

核对来源：`smali_classes2/com/xuehai/system/mdm/MdmAidlInterface$Stub.smali`。

---

## 七、真机验证结果

| 能力 | 结果 | 判据 |
| --- | --- | --- |
| 绑定服务 | 成立 | `mdm-bind ok=true`，连接组件为 `com.xuehai.launcher/com.xuehai.system.mdm.MdmService` |
| 常驻列表 | 成立 | 返回 `true` 且系统设置项变化 |
| 电池优化白名单 | 成立 | 返回 `true` |
| 自动时间开关 | 成立 | `setAutomaticTime(false)` 后系统项变为关闭 |
| 静默安装 | 成立（需满足两条件） | 应用被安装且无用户交互 |
| 动态口令校验 | 离线可用 | 密钥文件存在时本地算 TOTP 成功 |

静默安装的两个必要条件：

1. **签名一致**：目标包若已存在且签名不同，安装失败（`INSTALL_FAILED_UPDATE_INCOMPATIBLE`）；
2. **版本号递增**：已装同 `versionCode` 时，上层会跳过安装并把状态改为 `0x65`。

---

## 八、五条使用注意

### 8.1 绑定必须放独立线程

主线程绑定会阻塞。更隐蔽的问题是：服务端有一个**约 7 秒的存活窗口**，超时后进程被回收，界面上表现为「什么都没发生」。

### 8.2 不要自己装自己

用 MDM 安装正在运行的自身进程，会触发替换行为——进程被杀且不会自动回来。这不是 bug，是系统行为。

### 8.3 改时间前先关自动时间

`setSystemTime` 在自动时间开启时会被系统立即覆盖回网络时间。正确顺序是先 `setAutomaticTime(false)`，再 `setSystemTime`，必要时再 `setDateTimeChangeEnabled(false)` 防止外部修改。

### 8.4 私有目录也能读

有一个读取接口可以取任意包私有目录下的文件，包括管理端自身的配置目录。%%会话令牌即存放于 files/launcher.ini 这类配置文件中%%（见 [[research/dead-ends]]）。

### 8.5 事务号不稳定

AIDL 事务号由接口方法**声明顺序**决定。加一个方法，后面全部偏移。任何「硬编码事务号」的方案都必须绑定具体版本号，并在升级后重核。

---

## 九、这套暴露面的意义

把上面的信息合起来看，可以得到一个不依赖任何现场操作的判断：

> 一个无权限声明、无调用方校验、`directBootAware` 的 AIDL 服务，暴露了安装、卸载、保活、锁屏、改时间、读写私有目录的能力。

这意味着：**任何能在这台设备上运行代码的应用，都握有与系统管理端等效的能力。** 反过来，这也意味着任何「装一个应用看看」的行为都值得警惕——一旦落地，它就不再是「一个普通应用」。

真实链路里，这个服务是最后一环的执行者：链路上游只需要把 APK 放到一个可访问的路径，剩下的静默安装由 MDM 完成，全程无用户交互、无签名校验、无提示。

一句话概括：**最重的权限挂在最薄的锁上，而锁的位置在「谁能 bind」这一层——而那一层什么也没挡。**
