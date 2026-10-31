---
title: "学海签名与加密体系"

description: "请求签名（V1/V2）、响应签名校验、JNI 密钥管理、密钥文件存储、上传下载安全签名"

categories:
  - 技术解析
excerpt: 学海客户端的完整签名与加密体系：MD5 请求签名、V2 动态密钥、响应 MD5 校验、JNI 密钥、AK/SK 与文件安全。
---

# 学海签名与加密体系解析

## 前言

学海客户端通过多层签名/加密机制保护其 API 与文件服务。本文基于反编译代码梳理完整体系，包括：

1. **请求签名**（V1 静态密钥 / V2 动态密钥）
2. **响应签名校验**（MD5 校验）
3. **JNI 密钥管理**（xhcore.so）
4. **密钥文件存储**（sec.ini）
5. **上传/下载安全**（AK/SK、ACL、临时 URL）

## 一、请求签名

### 1.1 签名拦截器选择

`OkHttpClientManager.initOkHttpClient()` 根据 `XHAppConfigProxy.getInstance().useV2Sign()` 选择：

```java
if (useV2Sign) {
    requestSignInterceptor = new RequestSignV2Interceptor();
} else {
    requestSignInterceptor = new RequestSignInterceptor();
}
```

### 1.2 V1 签名（RequestSignInterceptor）

**流程**：
1. 读取请求 URL、请求体（UTF-8 解码）
2. 调用 `RequestSignUtil.addRestfulVerifyData(method, url, signatureKey, body, authHeader, listener)`
3. 用签名后的新 URL 重新发起请求

**签名算法**（`addRestfulVerifyData`）：

```
rawSignString = method + url + timestamp + signatureKey
if (method 不是 GET/DELETE && body 非空 && body < 1MB):
    rawSignString += body
if (authHeader != null):
    rawSignString += "Authorization: " + authHeader

sign = MD5(rawSignString)

finalUrl = url + ("&" if url contains "?" else "?") + "sign=" + sign + "&t=" + timestamp
```

其中 `signatureKey = XHCoreJniCache.getXhSignatureKey()`（JNI 获取，见第三节）。

### 1.3 V2 签名（RequestSignV2Interceptor）

**流程**：
1. 在 URL 后追加 `_xhsrc_={signSource}&_nonce_={UUID}&_uid_={userId}`
2. 从 JNI 获取动态密钥对 `signKey[0]`（版本）/ `signKey[1]`（密钥）
3. 若密钥无效（`-1`）→ 抛 `IOException("签名异常")`
4. 若 `isStaticKey(version)` → 清空 Authorization 头（使用静态密钥）
5. 否则若请求无 Authorization → 回退到静态密钥 `getXhStaticSignatureKey()`
6. 调用 `addRestfulVerifyDataV2(method, urlWithParams, version, key, body, authHeader, listener)`

**V2 签名算法**（`addRestfulVerifyDataV2`）：

```
rawSignString = method + urlWithParams + timestamp + version
if (method 不是 GET/DELETE && body 非空 && body < 1MB):
    rawSignString += body
if (authHeader != null):
    rawSignString += "Authorization: " + authHeader

sign = MD5(rawSignString)

finalUrl = urlWithParams + "&sign=" + sign + "&t=" + timestamp
```

注意 V2 与 V1 的区别：**V2 的密钥是版本号 + 密钥对，且 URL 已带 `_xhsrc_/_nonce_/_uid_` 参数**。

### 1.4 签名辅助函数

```java
needCombineBodyDataIntoUrl(method):
    return method == GET || method == DELETE   // 这两种方法 body 不参与签名
```

## 二、响应签名校验

### 2.1 ResponseSignInterceptor

- 请求时附加头 `X-Accept-Security: s/md5v1`
- 若请求带 `ResponseSignTag(needVerifyResponseSign=true)` 且响应无 `X-Content-Security` 头 → 抛 `IOException("响应签名校验失败")`
- 若响应头 `X-Content-Security` 含 `s/md5v1` → 执行 `verifySignMD5V1`

**MD5 校验算法**：

```
md5 = MD5("GHU^B_)+*&^%3~]" + responseBodyString)
if (md5 != X-Content-Sign-Token 头): 抛 IOException("响应md5校验失败")
```

响应体通过 `HttpDetailCollector.getResponseBodyStringBuilder` 读取（自动解 gzip）。

### 2.2 ResponseSignCheckInterceptor

- 仅当 `useV2Sign() && enableLogoutWhenSignError() && response.code() == 403` 时生效
- 解析响应体 JSON 的 `code` 字段：
  - `403001` 无效签名 → `notifyLogoutPlatform`（登出）
  - `403002` 签名过期 → 登出
  - `403003` 签名异常 → 登出

## 三、JNI 密钥管理（xhcore.so）

### 3.1 XHCoreJni

```java
System.loadLibrary("xhcore");   // 静态块加载

native String getSignatureKey();        // V1 静态签名密钥
native String[] getSignatureKeyV2();    // V2 动态密钥对 [version, key]
native String[] getStaticSignatureKey();// 静态密钥对 [version, key]
native boolean isStaticKey(String version); // 判断版本是否为静态密钥
```

### 3.2 XHCoreJniCache

- `xhSignatureKey`：懒加载缓存 `getSignatureKey()` 结果
- `xhStaticSignatureKey`：懒加载缓存 `getStaticSignatureKey()`，长度 < 2 或异常时回退 `["-1", "-1"]`
- `getSignKey()`：调用 `getSignatureKeyV2()`，异常/长度不足回退 `["-1", "-1"]`
- `isStaticKey(kv)`：调用 JNI，异常返回 false

### 3.3 已知密钥

V1 静态签名密钥（从 xhcore.so 中提取）：

```
eptim]q34imt5b]-q04i5q=fdkfjfsadlkjfasdfrt573df4pltoy]-pn965498d
```

详见 `xuehai-sign.md`。

## 四、密钥文件存储（XhSecretKeyUtils）

登录成功后，服务端返回 `uv`（版本）和 `randomStr`（密钥），客户端写入本地：

```
路径: {XhDir}/sec/sec.ini
内容: {version}|{key}     // 竖线分隔
```

- `writeSecretToFile(version, key)`：先删除旧目录再写入
- `readSecretFile()`：读取 sec.ini
- `deleteSecretFile()`：删除 sec 目录
- 另有 `encode`/`decode`（Base64）与 `appendRandom`/`subtractRandom`（追加/去除 6 位随机字符）方法，但当前流程未使用

## 五、上传/下载安全

### 5.1 AK/SK 获取（AkSkUtil）

**流程**：
1. `getAkSk(callback)` → `internalAkSk(1000, false, callback)`
2. 依次检查内存缓存（WeakReference）→ 本地文件（`{cacheDir}/{userId}.aksk`）
3. 均无效则请求 `{ALI_AK_SK_HOST}/XHFileServer/sts/certificate?appName={appId}`（GET）
4. 响应 `response` 字段用 **AES-GCM** 解密（密钥 `xhyadfaf342sx@fs`）
5. 解析出 `accessKey` / `accessSecret` / `expiration`（UTC 时间）/ `securityToken`
6. 写入本地文件 + 内存缓存，回调所有等待的 callback

**AES-GCM 格式**（AesEncryptUtils）：
```
密文 = [4字节 IV长度][IV(12字节)][AES/GCM/NoPadding 加密数据]
```

### 5.2 上传安全（UploadSecurityUtil）

- 私有文件（`UploadSecurityConfig.isPrivate()`）：
  - OSS 方式：设置 `x-oss-object-acl: private` + 用户元数据 `Conditions`
  - OkHttp 方式：附加头 `Acl: private`、`Conditions: {conditions}`、`Cond-Sign: {sign}`
- **签名算法**（ConstSecurity.computeUploadSecuritySign）：

```
sign = MD5(reverse(securityType + ";" + conditions))
```

- 私有 URL 以 `?!` 结尾（`isPrivate(url)` 判断）

### 5.3 下载安全（DownloadSecurityUtil）

- 私有 URL（以 `?!` 结尾）需换取临时 URL：
  - POST `{ALI_AK_SK_HOST}/XHFileServer/file/getTempUrl`
  - 请求体：`[{url, conditions, sign, 0}]`
  - **签名算法**：`sign = MD5(reverse(conditions))`
- 内网盒子（`isRemoteTypeBox()`）不走临时 URL，直接附加 `Conditions` + `Cond-Sign` 头

### 5.4 安全条件字段（ConstSecurity）

| 常量 | 值 |
|------|-----|
| `SECURITY_CONDITIONS_KEY` | `Conditions` |
| `SECURITY_CONDITION_SIGN_KEY` | `Cond-Sign` |
| `SECURITY_SCHOOL_ID` | `schoolId` |
| `SECURITY_CLASS_ID` | `classId` |
| `SECURITY_USER_ID` | `userId` |
| `SECURITY_IS_TEACHER` | `isTeacher` |

## 六、其他加密工具

### 6.1 MD5Util（签名用）

标准 MD5，输出小写 hex。

### 6.2 XHEncryptUtil

完整加密工具库：
- 摘要：MD2/MD5/SHA1/SHA224/SHA256/SHA384/SHA512
- HMAC：HmacMD5/HmacSHA1/HmacSHA224/HmacSHA256/HmacSHA384/HmacSHA512
- 对称：DES/3DES/AES（默认 `ECB/NoPadding`）

### 6.3 RSAUtil

- 生成密钥对、公钥加密/私钥解密、私钥加密/公钥解密
- 分段加解密（`rsaSplitCodec`）

### 6.4 StringEncryptUtils

自定义混淆加密：
- 96 位混淆区 + 校验码（`9 - (sum % 10)`）+ Base64 + 13 位时间戳
- 用于字符串混淆存储

### 6.5 LogCompress（日志加密）

- AES 加密（密钥不足 16 字节用 `A` 补齐）
- 输出大写 hex

## 七、安全观察

1. **V1 签名密钥硬编码在 so 中**，可静态提取
2. **AK/SK 解密密钥硬编码**：`xhyadfaf342sx@fs`
3. **客户端证书密码硬编码**：`654321`
4. **签名算法为简单 MD5 拼接**，无盐（除密钥本身），可离线重放（配合时间戳 t 防重放）
5. **V2 签名引入 nonce 与动态密钥**，安全性高于 V1，但密钥仍从 JNI 返回明文
6. **响应签名仅校验 MD5**，密钥为固定前缀 `GHU^B_)+*&^%3~]`，可伪造