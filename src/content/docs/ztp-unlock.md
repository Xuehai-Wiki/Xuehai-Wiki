---
title: "智通平台中的动态码"
description: 动态码是学海用于重置设备的动态密码
categories:
  - 智通平台
excerpt: 无
badge:
  text: 示例
  variant: note
---

---

# 「登录账号输入 `*数字*` 进入开发者界面」功能分析

## 一、功能定位

该功能是学海智通云学生端 Launcher（`com.xh.zhitongyunstu` v3.125.04）内置的**售后/运维后门通道**：在登录页用“账号 + 随意密码”提交时，若账号命中刷码格式（`*码*` / `#码#` / `@码@`），App 不走正常登录，而是校验刷码有效性后**跳转到“开发者模式”页面**——一个提供"一键还原管控、删除桌面、跳转 MDM 解锁页”的高危运维界面。

整条链路涉及 4 层：隐藏 UI 暗号 → 登录协程拦截 → 双通道刷码校验（HTTP API + MDM Binder）→ 路由跳转。

## 二、入口：登录页的隐形 A/B 暗号区

布局 [user_login_act.xml](<resources/res/layout/user_login_act.xml>) 中，Logo（`login_logo_iv`）左右各放了一个 60dp 宽的透明 `View`：

- [LoginActivity.java:489-495](<sources/com/xuehai/launcher/user/login/LoginActivity.java>) — `loginAView`/`loginBView` 点击监听 → [LoginActivity.java:574-583](<sources/com/xuehai/launcher/user/login/LoginActivity.java>) `init$lambda-1/2` → `viewModel.m948a()/m949b()`
- [InputMode.java:28-63](<sources/com/xuehai/launcher/user/login/InputMode.java>) — 点击左侧追加 `"A"`，右侧追加 `"B"`，超过 15 位清空：

```java
public final boolean isDefault() { return "ABBAAB".equals(input); }        // 默认模式
public final boolean isDev()     { return "ABBBBBAAABBB".equals(input); }  // 开发者模式
public final boolean isScan()    { return "ABAABA".equals(input); }        // 扫码模式
```

连点 Logo 左右区域拼出暗号后，[LoginViewModel.java:382-409](<sources/com/xuehai/launcher/user/login/LoginViewModel.java>)（`updateCheckModeTask`）响应：`isDev()` 且无历史密钥时，生成 6 位随机大写密钥 `curSecretKey` 并弹窗显示（离线刷码用的本地密钥）。

## 三、核心拦截：登录协程（smali 还原）

反编译失败的 `LoginViewModel$login$1.invokeSuspend`（源码 [LoginViewModel.kt:245-306]），从 smali [LoginViewModel$login$1.smali](<smali_classes4\com\xuehai\launcher\user\login\LoginViewModel$login$1.smali>) 完整还原为：

```kotlin
fun login(loginRequest: LoginRequest) = viewModelScope.launch(IO) {
    val isBrushInput = inputMode.isDefault() || (inputMode.isDev() && !hasHistorySecretKey) // smali L237-272
    clearInputMode()
    if (!checkMDM()) { hideProgress(); return@launch }                                      // L283

    if (loginRequest.isPasswordLogin()) {                 // loginType ∈ {1,3,5}，账号/手机号密码登录
        val accountName = loginRequest.accountName

        // ① 第一道检查：MDM 动态开发者 token（本机 Binder，不走网络）
        if (DeviceManagerPolicyProxy.verifyDevelopToken(accountName, 1)) {                  // L319-327
            hideProgress(); reqScanAbility(); return@launch                                 // L339
        }
        showProgress("加载中...")

        // ② 第二道检查：刷码格式校验（切到请求线程，走网络 API）
        val isBrushCode = withContext(requestDispatcher) {                                  // L355-385
            mdmModel.checkBrushCode(curSecretKey, accountName, isBrushInput)                // isBrushCode$1.smali L203
        }
        if (isBrushCode) {
            toDeveloper(accountName)                       // ★ 进入开发者界面，账号原文作为 token   L397-412
            hideProgress(); return@launch
        }
    }
    actualOnlineLogin(loginRequest)                        // 非刷码 → 正常登录流程                    L586-597
}
```

要点：
- **触发条件**：账号框输入 `*123456*`、密码随便填、联网状态、点登录（[LoginRequest.java:305-308](<sources/com/xuehai/launcher/data/entity/LoginRequest.java>) `isPasswordLogin = loginType ∈ {1,3,5}`）。
- `expectLocal`（即 `isBrushInput`）只影响**断网时**是否允许走本地 Binder 校验；联网时三种暗号状态都会执行第②步。
- 第一道检查（①）不要求 `*` 包裹——原始账号串直接交给 MDM 服务验 token（`type=1`），通过则进入"扫码解锁”流程而非开发者界面。

## 四、刷码校验的两条通道与 WebAPI 格式

### 通道 A：服务端 HTTP 校验（主通道）

判定 + 请求在 [MdmModelImpl.java:163-184](<sources/com/xuehai/launcher/mdm/data/MdmModelImpl.java>)：

```kotlin
fun checkBrushCode(key: String, code: String, expectLocal: Boolean): Boolean {
    if (code.isEmpty()) return false
    if (expectLocal && !网络可用) return PolicyManager.getDeviceManagerPolicyProxy().verifyDynamicCode(key, code, 0) // 离线走 Binder
    if ((code.startsWith("*") && code.endsWith("*")) ||
        (code.startsWith("#") && code.endsWith("#")) ||
        (code.startsWith("@") && code.endsWith("@"))) {
        val resp = mdmRemoteDataSource.checkBrushCode(code)
        if (resp.isSuccessful) {
            val status = StringEncryptUtils.decrypt(JSONObject(resp.responseBody).optString("status"))
            return status.toInt() == 1          // "1" = 有效刷码
        }
    }
    return false
}
```

**HTTP 定义**（[MdmRemoteDataSource.java:33-47](<sources/com/xuehai/launcher/mdm/data/MdmRemoteDataSource.java>)）：

```
PATCH {基址}/api/v2/pub/platform/brushCode
Content-Type: application/json

{"code": "*123456*", "deviceId": "<XhApplication.getDeviceId()>"}
```

- **基址** = `UrlCache.getHttpUrl()`（[UrlCache.java:70-109](<sources/com/xuehai/launcher/data/cache/UrlCache.java>)），默认 `https://ztp.yunzuoye.net`（[Constants.java:21-22](<sources/com/xuehai/launcher/common/constants/Constants.java>)，可被账号下发的 `microAddressDTOList` 线路切换）。
- **响应**：`LResponse{code, responseBody, restfulError}`（[LResponse.java](<sources/com/xuehai/launcher/common/http/LResponse.java>)），`responseBody` 形如 `{"status":"<加密串>"}`。
- `status` 字段是自研混淆串（[StringEncryptUtils.java:21-52](<sources/com/xuehai/launcher/data/util/StringEncryptUtils.java>)）：长度 ≥98、末位为累加校验码、`&` 分隔的 96 字符三十二进制字符置换表、Base64(明文+13 位毫秒时间戳)，**有效期 300 秒**；解密后为 `"1"`（通过）/`"0"`。

### 通道 B：MDM Binder 本地校验（离线/开发者 token）

- [DeviceManagerPolicyProxy.java:24-32](<sources/com/xuehai/launcher/common/sdk/proxy/DeviceManagerPolicyProxy.java>)：

```kotlin
fun verifyDevelopToken(key: String, type: Int): Boolean {
    MdmLog.i(TAG, "验证开发者token: key= $key ,type= $type")
    return policy.verifyDynamicToken(key, type)     // 异常时返回 false
}
```

- 调用链：`PolicyManager`（[PolicyManager.java:124-144](<sources/com/xuehai/launcher/common/sdk/proxy/PolicyManager.java>)，JDK 动态代理 `MdmPolicy`）→ [MdmPolicy.java:14-21](<sources/com/xuehai/launcher/common/sdk/proxy/MdmPolicy.java>)（取 `MdmHolder.getMdmService()`，无 Binder 则 `registerMdm()` 重绑并抛异常）→ [MdmHolder.java:70-97](<sources/com/xuehai/launcher/common/sdk/MdmHolder.java>) → [MdmServiceManager.java:22-45](<sources/com/xuehai/system/mdm/MdmServiceManager.java>) `bindService(action="com.xuehai.system.mdm.action_aidl", package="com.xuehai.launcher")` → AIDL `MdmAidlInterface.verifyDynamicToken(key, type)`（[MdmAidlInterface.java:978](<sources/com/xuehai/system/mdm/MdmAidlInterface.java>)，事务码 5）。
- **具体校验算法在本 APK 之外**——它实现在设备上包名为 `com.xuehai.launcher` 的 MDM 管控组件（`LAUNCHER_MDM_STU`，[Constants.java:8](<sources/com/xuehai/launcher/common/constants/Constants.java>)）的 Binder 服务端；本 APK 只持有 AIDL 客户端。MDM 未启用时走 [DefaultApi.java:637-639](<sources/com/xuehai/launcher/common/sdk/DefaultApi.java>) 恒返回 `false`（`verifyDynamicCode` 恒 `true`）。

## 五、跳转：`toDeveloper(token) → DeveloperActivity`

[LoginViewModel.java:1057-1067](<sources/com/xuehai/launcher/user/login/LoginViewModel.java>)（jadx 可读）：

```kotlin
private fun toDeveloper(token: String?) {
    val bundle = Bundle()
    token?.let { bundle.putString("token", it) }          // ★ 账号原文 "*123456*" 作为 token
    val postcard = Postcard(RouterPath.DEVELOPER_ACTIVITY)
    postcard.extras = bundle
    getPostcard().postValue(postcard)                      // LiveData 通知 Activity
    action(getFinish())                                    // 关闭登录页
}
```

`DeveloperActivity`（路由 `RouterPath.DEVELOPER_ACTIVITY` 经 `ServiceLoader.putPage` 注册）接收 token 并装配界面（[DeveloperActivity.java:79-139](<sources/com/xuehai/launcher/developer/DeveloperActivity.java>)）：

```kotlin
viewModel.setMToken(getIntent().getStringExtra("token"))   // L133
标题 "开发者模式"（L103），列表来自 DeveloperViewModel.load()
```

开发者界面菜单（[DeveloperViewModel.java:93-99, 252-286](<sources/com/xuehai/launcher/developer/DeveloperViewModel.java>)）：

| 菜单项 | 行为 |
|---|---|
| **一键还原**（type 0） | 清下载目录/备份桌面、关防火墙、允许刷机/双清/安全模式/OTA、恢复全部被禁应用、重置激活状态（L101-254） |
| **删除智通云(请先还原, 再删除!!)**（type 1） | 有 root 静默卸载自身，否则拉起卸载页（L256-286） |
| **跳转MDM解锁页**（type 1） | LiveData → Activity 跳 MDM 解锁页（L101-119） |

**token 的实际用途**：`wipe()`（双清，未挂载进当前菜单，L288-337）中作为双清口令——`DevicePolicyProxy.resetFactory(MD5Util.encode(mToken))`，即刷码数字经 MD5 后作为恢复出厂的授权参数传给 MDM Binder。

## 六、佐证材料（smali 原文）

- 登录协程拦截与跳转：`LoginViewModel$login$1.smali` L305-309（`isPasswordLogin`）、L319-327（`verifyDevelopToken(accountName, 1)`）、L355-412（`checkBrushCode` → `access$toDeveloper`）、L586-597（兜底 `actualOnlineLogin`）— [smali_classes4\com\xuehai\launcher\user\login\LoginViewModel$login$1.smali](<smali_classes4\com\xuehai\launcher\user\login\LoginViewModel$login$1.smali>)
- 刷码格式三前缀判定：[MdmModelImpl.java:171](<sources/com/xuehai/launcher/mdm/data/MdmModelImpl.java>)（`XPath.WILDCARD` 常量即 `"*"`，与 `#`、`@` 并列）
- 附带请求：verifyDevelopToken 通过后 `GET {基址}/api/v1/platform/{deviceId}/scan/ability` 决定是否显示扫码能力（[SystemRemoteDataSource.java:86-89](<sources/com/xuehai/launcher/data/source/SystemRemoteDataSource.java>)，[StuLoginViewModel.java:383-395](<sources/com/xuehai/launcher/user/login/StuLoginViewModel.java>)）

**一句话总结**：登录时账号串若满足 `*码*`/`#码#`/`@码@` 格式，先经 MDM Binder 验开发者 token（type=1，本机校验），再 `PATCH /api/v2/pub/platform/brushCode` 服务端校验（`status` 解密后为 1 即通过）；通过则把该账号串整体作为 `token` extra 路由到“开发者模式”页（一键还原/删除桌面/MDM 解锁），token 亦是双清（`resetFactory(MD5(token))`）的授权口令。