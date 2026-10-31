---
title: "本地文件与存储层"
description: "智通平台的本地文件 I/O、数据库与缓存体系"
categories:
  - 技术解析
excerpt: 通过反编译解析智通平台的 SD 卡文件布局、Room/GreenDAO 数据库、内存缓存与 SharedPreferences。
---

# 智通平台本地文件与存储层解析

## 前言

智通平台（ZTP）是一个多进程 MDM Launcher，需要在本机持久化用户、应用、控制策略、消息等数据。本文梳理其**文件 I/O、数据库、缓存、SharedPreferences** 四类存储设施。

涉及源码包：
- `com.xuehai.platform.file` — 文件路径与存储空间管理
- `com.xuehai.open.FileUtil` — 通用文件工具
- `com.xuehai.launcher.data.db` — Room / GreenDAO 数据库
- `com.xuehai.launcher.data.cache` — 内存缓存
- `com.xuehai.launcher.data.util.app` — 应用数据清理

---

## 一、文件路径布局

### FilePathManager

`com.xuehai.platform.file.FilePathManager` 定义基础路径模板：

```
BASE_PATH = /sdcard/xuehai
```

| 目录 | 模板 |
|------|------|
| 应用数据库 | `/xuehai/<schoolId>/databases/<pkg>/<userId>` |
| 应用文件 | `/xuehai/<schoolId>/filebases/<pkg>` |
| 应用缓存 | `/xuehai/<schoolId>/filebases/<pkg>/cache` |

```java
public String getAppDatabaseDir() {
    return String.format("%s/%s/databases/%s/%s", BASE_PATH, schoolId, packageName, userId);
}
public String getAppFileDir() {
    return String.format("%s/%s/filebases/%s", BASE_PATH, schoolId, packageName);
}
```

### 完整目录常量（FilePath）

`com.xuehai.launcher.common.constants.FilePath` 定义全部基础目录（`BASE_PATH = /sdcard/xuehai`）：

| 常量 | 路径 |
|------|------|
| BASE_PATH | `/sdcard/xuehai` |
| DOWNLOAD_DIR | `/xuehai/download` |
| DOWNLOAD_APP_DIR | `/xuehai/download/app`（**下载的 APK 存放处**） |
| DOWNLOAD_CACHE_DIR | `/xuehai/download/cache` |
| DOWNLOAD_MEDIA_DIR | `/xuehai/download/media` |
| DOWNLOAD_IMG_DIR | `/xuehai/download/image` |
| ZIP_DIR | `/xuehai/zip` |
| LOG_DIR / LOG_DIR_CACHE / LOG_DIR_ERROR | `/xuehai/log[/cache|/error]` |
| CONFIG_DIR | `/xuehai/config` |
| KEEP_DIR | `/xuehai/keep`（**设备密钥/持久数据**） |
| THIRD_PARTY_DIR | `/xuehai/thirdParty` |
| BAK_LAUNCHER_PATH | `/xuehai/bak/xh_launcher.apk` |
| BAK_APP_DIR | `/xuehai/app` |
| APP_STATS_DIR | `/xuehai/keep/appStats` |

### 设备密钥目录（/xuehai/keep/device）

`/xuehai/keep/device` 存放设备级 SecretKey（`.ls` 文件，AES 加密，详见 `xuehai-brushcode.md`），是动态码离线验证的密钥来源，与用户无关、刷机不换。

### 登录密钥文件（XhSecretKeyUtils）

`com.p017xh.xhcore.common.util.XhSecretKeyUtils` 把登录返回的 `uv/randomStr` 密钥写入 `<xhDir>/sec/sec.ini`，格式为 `version|key`：

```java
public static final synchronized void writeSecretToFile(String version, String key) {
    if (version != null && key != null) {
        String xhDir = XhFileUtils.getXhDir();
        String str = xhDir + File.separator + DIR_NAME;   // DIR_NAME = "sec"
        XhFileUtils.deleteDirs(str);
        XhFileUtils.createDirs(str);
        String str2 = str + File.separator + "sec.ini";
        XhFileUtils.createFile(str2);
        XhFileUtils.writeFile(str2, version + Consts.SEPARATOR + key);
    }
}
```

登录成功后 `AccountRepository.unifiedDealLoginResult` 调用 `XhSecretKeyUtils.writeSecretToFile(account.getUv(), account.getRandomStr())` 保存密钥；`deleteSecretFile()` 在登出时删除。

### 下载 APK 存储（AppUpdateTask）

`AppUpdateTask.getAppSaveDir(pkg) = /xuehai/download/app/<pkg>`，保存路径为 `/xuehai/download/app/<pkg>/<versionCode>/<pkg>.apk`：

```java
private String createAppSavePath(String str, int i) {
    return ZStringUtil.format("%s/%d/%s.apk", createAppSaveDir(str), Integer.valueOf(i), str);
}
public static String getAppSaveDir(String str) {
    return ZStringUtil.format("%s/%s", FilePath.DOWNLOAD_APP_DIR, str);
}
```

### 数据库目录（DatabaseFactory）

`com.xuehai.launcher.data.db.DatabaseFactory` 管理 5 个 Room 数据库，全部通过重写 `ContextWrapper.getDatabasePath()` 把数据库文件放到**按用户隔离**的目录：

| 数据库 | 路径模板 |
|--------|----------|
| LauncherDatabase | `<databases父目录>/<环境目录>/<name>` |
| AppUsagesDatabase | `FilePath.APP_STATS_DIR/<name>` |
| UserRoomDatabase | `BASE_PATH/<schoolId>/databases/<pkg>/<userId>/<环境目录>/<name>` |
| KeepRoomDatabase | `BASE_PATH/<schoolId>/databases_keep/<pkg>/<userId>/<环境目录>/<name>` |
| ThemeDatabase | 同 UserRoomDatabase |

`clearDbSession()` 把 5 个静态引用全部置空，用于切换账号时释放。

### GreenDAO（MyDaoMaster）

`MyDaoMaster.SdCardOpenHelper` 把 GreenDAO 数据库放到 SD 卡，升级时直接 `dropAllTables` 后重建（数据不保留）。`getContentWrapper` 重写 `getDatabasePath` 与 `openOrCreateDatabase`，SD 卡不可用时回退到内部存储。

`BaseLocalDataSource` 是 GreenDAO 的 `DaoMaster/DaoSession` 单例，数据库路径为 `BASE_PATH/<schoolId>/databases/<pkg>/<userId>`。子类通过 `getDaoSession().getXxxDao()` 访问各实体 DAO（AppNotification、FirewallRoster、FirewallRule、FirewallConfig 等）。

```java
public static SQLiteDatabase getDb() {
    synchronized (LOCK) {
        if (database == null || !database.isOpen()) {
            String databaseName = Configuration.getDatabaseName();
            String str = String.format("%s/%d/databases/%s/%d", FilePath.BASE_PATH,
                SessionData.getSchoolId(), BaseApplication.INSTANCE.getInstance().getPackageName(),
                SessionData.getUserId());
            database = new MyDaoMaster.SdCardOpenHelper(BaseApplication.INSTANCE.getInstance(), str, databaseName)
                .getWritableDatabase();
        }
        return database;
    }
}
```

---

## 二、通用文件工具（open.FileUtil）

`com.xuehai.open.FileUtil` 提供完整文件操作，用 `ReentrantReadWriteLock` 保护并发读写：

- 读写：`writeToFile`（4096 字节缓冲、可追加、可限最大尺寸滚动）、`readFromFile`、`readByBytes`、`readLine`
- 目录：`copyDir/copyFile`、`rename/move`、`deleteFile`（递归，拒绝删除 SD 卡根目录）
- 创建：`createFileNotExists/createDirNotExists/createParentDir/reCreateFile/reCreateDir`
- 搜索：`searchFileAndDir`、`searchFileBySuffix`（可深度递归）
- 空间：`getTotalSpace/getFreeSpace`（StatFs，兼容 API 18+）

```java
public static final boolean writeToFile(File file, InputStream inputStream, boolean append) throws Throwable {
    INSTANCE.writeLock(lock);
    try {
        createFileNotExists(file);
        FileOutputStream fileOutputStream = new FileOutputStream(file, append);
        byte[] bArr = new byte[4096];
        int i = inputStream.read(bArr);
        while (i != -1) {
            fileOutputStream.write(bArr, 0, i);
            i = inputStream.read(bArr);
        }
        fileOutputStream.flush();
        ...
    } finally {
        INSTANCE.writeUnlock(lock);
    }
}
```

---

## 三、存储空间管理（FileManager）

`com.xuehai.platform.file.FileManager` 负责存储空间检查：

- `MIN_STORAGE_SPACE = 1GB`（1073741824）
- `checkSdcardIsFull()` 用 `StatFs` 计算可用空间，阈值可被远端配置 `launcher_storage_space.minStorageSpace` 覆盖（上限 8GB）
- `showCleanDataView` 通过 `com.xuehai.action.storage.clear` 广播拉起清理界面
- `isLauncherSupport` 用 `CPVDProcess.isIntentEffective` 判断清理界面是否可用

```java
public static boolean checkSdcardIsFull(long j) {
    if (j < 1073741824) {
        j = 1073741824;
    }
    try {
        StatFs statFs = new StatFs(Environment.getExternalStorageDirectory().getPath());
        return getBlockSize(statFs) * getAvailableBlocks(statFs) < j;
    } catch (Exception unused) {
        return false;
    }
}
```

---

## 四、应用数据清理（AppStorageFileDataHelper）

`com.xuehai.launcher.data.util.app.AppStorageFileDataHelper` 提供带进度回调的应用数据清理：

- `clearAppAllData`：删除 `Android/data/<pkg>`、数据库目录、缓存目录、`/xuehai` 数据目录、APK 保存目录
- `clearAppCacheData`：仅删除 `Android/data/<pkg>`、数据库目录、缓存目录
- 进度按文件数计算百分比，`clearAppDataByDirList` 递归删除并回调进度
- 若设备已 root（`ZCommand.isRoot()`），执行 `pm clear <pkg>`
- `calculateAppFileCount`：统计各应用文件数并上报日志（`LogManager.uploadLog`）

```java
private final void clearAppDataByDirList(String packageName, Function0<? extends List<String>> fileDirListBlock,
        final Function1<? super Float, Unit> progressBlock, Function0<Unit> completeBlock) {
    ...
    if (ZCommand.isRoot()) {
        ZCommand.execRootCmd("pm clear " + packageName);
    }
    completeBlock.invoke();
}
```

---

## 五、内存缓存体系

| 缓存 | 实现 | 说明 |
|------|------|------|
| CacheManager | `ConcurrentHashMap<String,String>` | 通用键值缓存 + 静态 schoolId/userId |
| MessageCache | `ConcurrentHashMap<String,CPVDMessage>` | 未读消息缓存，key=`CPVDMessageData.getKey(userId, pkg)` |
| AppShortcutCache | `ConcurrentHashMap<String,AppShortcut>` | 应用快捷方式缓存 |
| IconCache | `LruCache<String,Bitmap>(30)` | 图标缓存，含圆角/圆形处理 |

`CacheManager` 的内存管理策略：

```java
public static final void onTrimMemory(int level) {
    if (level >= 60) {          // TRIM_MEMORY_MODERATE
        clearCache();
    } else if (level >= 40) {   // TRIM_MEMORY_BACKGROUND
        IconCache.evictAll();
        MessageCache.INSTANCE.clear();
        CPVDManager.clearAllCache();
        cacheMap.clear();
    }
}
```

`clearUserCache` 在账号切换时清空 `MessageCache`、`CPVDManager`、`SessionData`、`CPVDUserData`，并可选清空数据库会话。

---

## 六、SharedPreferences

| 工具类 | 文件名 | 关键键 |
|--------|--------|--------|
| SharePreferencesUtil | `XHSPUtil.FILE_NAME` | 通用 |
| LauncherSPUtil | 同上 | `launcher_push_client_id_<userId>`（推送 clientId）、`launcher_register_device_<deviceId>`（设备注册）、`resource_update_version_<userId>`、`message_list_remote_version`、`check_update_time` 等 |
| PushSharedPrefUtil | `xh_push_sp_<appId>` | `sp_app_id`、`sp_app_secret`、`sp_client_id`、`sp_school_id`、`sp_user_service` |
| NetworkLineConfig | `network_line` | `launcherUrl_<env>`、`microUrl_<env>`、`remote_url_enable_<env>` |

`LauncherSPUtil` 的推送 clientId 键是令牌体系的一部分：

```java
private static String clientIdKey() {
    return "launcher_push_client_id_" + SessionData.getUserId();
}
public static boolean isClientChanged(String str) {
    return !TextUtils.equals(str, (String) get(clientIdKey(), ""));
}
public static void updateClientId(String str) {
    put(clientIdKey(), str);
}
```

---

## 七、关键结论

1. **按用户隔离**：所有数据库与文件路径都包含 `schoolId/userId`，切换账号即切换数据目录。
2. **SD 卡优先**：数据库默认放 SD 卡 `/xuehai/`，SD 卡不可用时回退内部存储。
3. **弱加密存储**：本地敏感数据（密码、令牌）用 XOR / 伪随机流 / 混淆 Base64 保护，密钥硬编码在 Java 层（详见 `xuehai-storage-ipc-token.md` 令牌层章节）。
4. **推送状态文件**：`/xuehai/config/pn-message/status.txt` 是跨进程推送存活状态文件，配合 FileObserver 监听。

## 附：关键文件索引

| 文件 | 作用 |
|------|------|
| `platform/file/FilePathManager.java` | 文件路径模板 |
| `platform/file/FileManager.java` | 存储空间管理 |
| `open/FileUtil.java` | 通用文件工具 |
| `launcher/data/db/DatabaseFactory.java` | Room 数据库工厂 |
| `launcher/data/db/MyDaoMaster.java` | GreenDAO SD 卡助手 |
| `launcher/data/db/BaseLocalDataSource.java` | GreenDAO 会话 |
| `launcher/data/cache/CacheManager.java` | 内存缓存管理 |
| `launcher/data/cache/MessageCache.java` | 未读消息缓存 |
| `launcher/data/cache/UrlCache.java` | 服务器地址轮换 |
| `launcher/data/cache/AppShortcutCache.java` | 应用快捷方式缓存 |
| `launcher/data/cache/IconCache.java` | 图标缓存 |
| `launcher/data/util/app/AppStorageFileDataHelper.java` | 应用数据清理 |
| `launcher/data/util/SharePreferencesUtil.java` | SharedPreferences 封装 |
| `launcher/data/util/LauncherSPUtil.java` | Launcher 专用 SP 键 |
| `message/utils/PushSharedPrefUtil.java` | 推送 SP 键 |