---
title: "登录API"

description: "登录接口是获取通行令牌的途径"

categories:
  - 技术解析
excerpt: 学海登录接口的请求与响应解析，以及通行令牌的获取方式。

badge:
  text: 示例
  variant: note

---



## API 概述

**端点**: `/api/v2/platform/login`  
**方法**: POST  
**功能**: 用户登录认证，支持多种登录方式（账号密码、手机短信、微信、天翼等） [1](#0-0) 

## 请求头

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| UserId | Integer | 否 | 用户ID |
| SchoolId | Integer | 否 | 学校ID |
| Tenant | String | 否 | 租户代码 [2](#0-1)|
| TenantCode | String | 否 | 租户代码 |

## 请求体参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| userName | String | 是 | 用户名/手机号 |
| password | String | 条件必填 | 密码（MD5加密后转大写） [3](#0-2)  |
| loginType | int | 是 | 登录类型（见下方登录类型表） [4](#0-3)  |
| deviceId | String | 是 | 设备ID |
| osDisplay | String | 是 | 系统显示信息（Build.DISPLAY） [5](#0-4)  |
| imei | String | 是 | 设备IMEI |
| ap | String | 是 | 网络类型 |
| mac | String | 条件必填 | MAC地址（设备支持时必填） [6](#0-5)  |
| isNew | boolean | 是 | 是否新用户 |
| activationCode | String | 是 | 激活码 |
| installTime | long | 是 | 应用安装时间 |
| mdmVersionCode | int | 是 | MDM版本号 |
| mdmVersionName | String | 是 | MDM版本名称 |
| forceActivateBenefit | Boolean | 否 | 强制激活权益 |
| state | String | 条件必填 | 状态（天翼登录需要） [7](#0-6)  |
| smsCode | String | 条件必填 | 短信验证码（短信登录需要） [8](#0-7)  |
| code | String | 条件必填 | 二维码code（二维码登录需要） [9](#0-8)  |
| operatorId | Long | 条件必填 | 操作员ID |
| boundTenantAppCode | String | 条件必填 | 绑定租户应用代码 |
| boundTenantCode | String | 条件必填 | 绑定租户代码 | [1](#0-0) 

## 登录类型 (loginType)

| 值 | 常量名 | 说明 |
|----|--------|------|
| 0 | UN_KNOW | 未知 |
| 1 | ACCOUNT | 账号登录 |
| 3 | PHONE | 手机号登录 |
| 4 | PHONE_SMS | 手机短信登录 |
| 5 | ACCOUNT_OR_PHONE | 账号或手机号登录 |
| 6 | WE_CHAT | 微信登录 |
| 9 | ZSCM | 浙数登录 |
| 10 | QR_XY | 二维码登录 |
| 13 | YUE_QING | 越清登录 |
| 15 | TIAN_YI | 天翼登录 |
| 99 | EDU_CLOUD | 教育云登录 | [4](#0-3) 

## 响应

响应体为JSON格式，解析为 `Account` 对象 [10](#0-9) 。主要字段包括：

- 用户基本信息（userId, userName, userType等）
- 认证信息（accessToken, expiresIn等）
- 学校信息（schoolId, schoolName等）
- 设备绑定信息
- 签名相关字段
- 时间戳信息（timestampDTO）

## 使用示例

### 账号密码登录
```java
LoginRequest request = LoginRequest.Companion.passwordLogin("username", "password", "deviceId");
``` [11](#0-10) 

### 手机短信登录
```java
LoginRequest request = LoginRequest.Companion.phoneSMSLogin("phone", "smsCode", "deviceId");
``` [12](#0-11) 

### 微信登录
```java
LoginRequest request = LoginRequest.Companion.weChatLogin("sceneId", "deviceId");
``` [13](#0-12) 

## 调用流程

1. 创建 `LoginRequest` 对象（使用Companion工厂方法或直接构造）
2. 调用 `AccountRepository.userLogin(loginRequest)` [14](#0-13) 
3. Repository内部调用 `AccountRemoteDataSource.userLogin(loginRequest)` [1](#0-0) 
4. 返回 `Observable<Account>` 对象

## Notes

- 密码在发送前会进行MD5加密并转为大写 [3](#0-2) 
- MAC地址仅在设备支持时才发送 [6](#0-5) 
- 登录成功后会处理密钥信息（uv和randomStr）并保存到本地文件 [15](#0-14) 
- 响应处理包括解析Account对象、保存最近登录信息、更新系统时间等 [10](#0-9)

### Citations

**File:** app/src/main/java/com/xuehai/launcher/user/data/AccountRemoteDataSource.java (L206-253)
```java
    public Observable<LResponse> userLogin(LoginRequest loginRequest) throws JSONException {
        MyLog.i("[Lc]::Http", "登录");
        JSONObject jSONObject = new JSONObject();
        try {
            jSONObject.put("userName", loginRequest.getAccountName());
            jSONObject.put("password", EncryptionUtil.getMD5(loginRequest.getPassword()).toUpperCase());
            jSONObject.put("loginType", loginRequest.getLoginType());
            jSONObject.put("deviceId", loginRequest.getDeviceId());
            jSONObject.put("osDisplay", loginRequest.getOsDisplay());
            jSONObject.put("imei", loginRequest.getImei());
            jSONObject.put("ap", loginRequest.getAp());
            if (DeviceSupportCompat.INSTANCE.isDeviceSupport()) {
                jSONObject.put("mac", loginRequest.getMac());
            } else {
                jSONObject.put("mac", "");
            }
            jSONObject.put("isNew", loginRequest.getIsNew());
            jSONObject.put("activationCode", loginRequest.getActivationCode());
            jSONObject.put("installTime", loginRequest.getInstallTime());
            jSONObject.put("mdmVersionCode", loginRequest.getMdmVersionCode());
            jSONObject.put("mdmVersionName", loginRequest.getMdmVersionName());
            jSONObject.put("forceActivateBenefit", loginRequest.getForceActivateBenefit());
            jSONObject.put("state", loginRequest.getState());
            if (loginRequest.getSmsCode() != null) {
                jSONObject.put("smsCode", loginRequest.getSmsCode());
            }
            if (loginRequest.getCode() != null) {
                jSONObject.put("code", loginRequest.getCode());
            }
            if (loginRequest.getOperatorId() != null) {
                jSONObject.put("operatorId", loginRequest.getOperatorId());
            }
            if (loginRequest.getBoundTenantAppCode() != null) {
                jSONObject.put("boundTenantAppCode", loginRequest.getBoundTenantAppCode());
            }
            if (loginRequest.getBoundTenantCode() != null) {
                jSONObject.put("boundTenantCode", loginRequest.getBoundTenantCode());
            }
        } catch (JSONException e) {
            e.printStackTrace();
        }
        LRequest lRequestBuild = new LRequest.Builder().url(url() + "/api/v2/platform/login").post(LRequestBody.create(jSONObject)).build();
        lRequestBuild.getHeader().headers.put("UserId", Integer.valueOf(loginRequest.getUserId()));
        lRequestBuild.getHeader().headers.put("SchoolId", Integer.valueOf(loginRequest.getSchoolId()));
        lRequestBuild.getHeader().headers.put("Tenant", loginRequest.getTenantCode());
        lRequestBuild.getHeader().headers.put("TenantCode", loginRequest.getTenantCode());
        return requestWithRestfulByRx(lRequestBuild);
    }
```

**File:** app/src/main/java/com/xuehai/launcher/data/entity/LoginRequest.java (L54-62)
```java
        public final LoginRequest passwordLogin(String account, String passwordIn, String deviceId) {
            Intrinsics.checkNotNullParameter(account, "account");
            Intrinsics.checkNotNullParameter(passwordIn, "passwordIn");
            Intrinsics.checkNotNullParameter(deviceId, "deviceId");
            LoginRequest loginRequest = new LoginRequest(5, deviceId, null, 4, null);
            loginRequest.setAccountName(account);
            loginRequest.setPassword(passwordIn);
            return loginRequest;
        }
```

**File:** app/src/main/java/com/xuehai/launcher/data/entity/LoginRequest.java (L64-72)
```java
        public final LoginRequest phoneSMSLogin(String phone, String mobileCode, String deviceId) {
            Intrinsics.checkNotNullParameter(phone, "phone");
            Intrinsics.checkNotNullParameter(mobileCode, "mobileCode");
            Intrinsics.checkNotNullParameter(deviceId, "deviceId");
            LoginRequest loginRequest = new LoginRequest(4, deviceId, null, 4, null);
            loginRequest.setAccountName(phone);
            loginRequest.setSmsCode(mobileCode);
            return loginRequest;
        }
```

**File:** app/src/main/java/com/xuehai/launcher/data/entity/LoginRequest.java (L88-94)
```java
        public final LoginRequest weChatLogin(String sceneId, String deviceId) {
            Intrinsics.checkNotNullParameter(sceneId, "sceneId");
            Intrinsics.checkNotNullParameter(deviceId, "deviceId");
            LoginRequest loginRequest = new LoginRequest(6, deviceId, null, 4, null);
            loginRequest.setAccountName(sceneId);
            return loginRequest;
        }
```

**File:** app/src/main/java/com/xuehai/launcher/data/entity/LoginRequest.java (L118-134)
```java
    public static final class LoginType {
        public static final int ACCOUNT = 1;
        public static final int ACCOUNT_OR_PHONE = 5;
        public static final int EDU_CLOUD = 99;
        public static final LoginType INSTANCE = new LoginType();
        public static final int PHONE = 3;
        public static final int PHONE_SMS = 4;
        public static final int QR_XY = 10;
        public static final int TIAN_YI = 15;
        public static final int UN_KNOW = 0;
        public static final int WE_CHAT = 6;
        public static final int YUE_QING = 13;
        public static final int ZSCM = 9;

        private LoginType() {
        }
    }
```

**File:** app/src/main/java/com/xuehai/launcher/user/data/AccountRepository.java (L856-926)
```java
    public final Account unifiedDealLoginResult(LoginResult loginResult) throws Throwable {
        Intrinsics.checkNotNullParameter(loginResult, "loginResult");
        TraceHelper.beginSection("unifiedDealLoginResult");
        CacheManager.clearUserCache$default(false, 1, null);
        LResponse response = loginResult.getResponse();
        String responseBody = response.getResponseBody();
        Account account = (Account) JsonUtil.parseJson(responseBody, Account.class);
        if (account == null) {
            BuryDetail.loginOnlineFailReason(responseBody);
            response.setError(ErrorCode.ERROR_PARSER_JSON);
            throw new ResponseException(response);
        }
        if (account.isContinueToBind()) {
            throw new WeChatLoginException(response);
        }
        int loginType = loginResult.getLoginType();
        String accountName = loginResult.getAccountName();
        String password = loginResult.getPassword();
        if (account.getUv() != null && account.getRandomStr() != null) {
            MyLog.e("AccountRepository", "登录返回了密钥，uv=" + account.getUv() + ",randomStr=" + account.getRandomStr());
            XhSecretKeyUtils.writeSecretToFile(account.getUv(), account.getRandomStr());
        }
        pwdChangeSwitch = new PwdChangeSwitch(account.getForcePwdChangeSwitch());
        saveLatelyAccountName(loginType, accountName);
        saveLatelyPassword(loginType, password);
        saveLatelyAccount(account);
        LoginUtil.afterLogin$default(account, false, 2, null);
        UrlCache.checkLauncherUrlChange();
        PollInterfaceManager.INSTANCE.resetErrorInfos();
        PollInterfaceManager.setTokenValidStatus(true);
        UserConfiguration.INSTANCE.markCodeLogin(account.isCodeLoginEnabled());
        UserConfiguration.INSTANCE.markUsed();
        Account.TimestampDTO timestampDTO = account.getTimestampDTO();
        if (timestampDTO != null) {
            SettingsHelper.INSTANCE.updateSystemTime(timestampDTO.getDateTime());
        }
        SceneInfoControler.refreshSceneInfosCache();
        MessageModel messageModel = ModelFactory.getMessageModel();
        messageModel.registerClient(messageModel.getClientId());
        SignatureRepository signatureRepository = new SignatureRepository();
        if (account.isFirstAuthorized()) {
            signatureRepository.saveSignatureStatus(SignatureInfo.SignatureStatus.NO_STATUS);
        }
        signatureRepository.updateSignIgnoreCount(account.getSignIgnoreRemainingTimes());
        try {
            JSONObject jSONObject = new JSONObject(responseBody);
            if (jSONObject.has("joinedClass")) {
                ArrayList<ClassEntity> arrayList = new ArrayList<>();
                JSONArray jSONArray = new JSONArray(jSONObject.optString("joinedClass"));
                int length = jSONArray.length();
                for (int i = 0; i < length; i++) {
                    JSONObject jSONObject2 = jSONArray.getJSONObject(i);
                    ClassEntity classEntity = new ClassEntity();
                    classEntity.setClassId(jSONObject2.optLong("classId", 0L));
                    classEntity.setClassName(jSONObject2.optString("className"));
                    classEntity.setGradeName(jSONObject2.optString("grade"));
                    classEntity.setClassType(0);
                    classEntity.setSchoolId(account.getSchoolId());
                    arrayList.add(classEntity);
                }
                new ClassRepository().saveClassList(arrayList);
            }
            if (jSONObject.has("tenantCodes")) {
                new UserRepository().updateTenants(UtilExtKt.parseJsonToList(jSONObject.optString("tenantCodes"), String.class));
            }
        } catch (Exception e) {
            MyLog.w("[Lc]::", "accountJson parse error", e);
        }
        TraceHelper.endSection("unifiedDealLoginResult");
        return account;
    }
```

**File:** app/src/main/java/com/xuehai/launcher/user/data/AccountRepository.java (L933-943)
```java
    public final Observable<Account> userLogin(final LoginRequest loginRequest) {
        Intrinsics.checkNotNullParameter(loginRequest, "loginRequest");
        Observable map = login(loginRequest).observeOn(ThreadPlugins.ioScheduler()).map(new Function() {
            @Override
            public final Object apply(Object obj) {
                return AccountRepository.m1278userLogin$lambda0(this.f$0, loginRequest, (LResponse) obj);
            }
        });
        Intrinsics.checkNotNullExpressionValue(map, "login(loginRequest).obse…uest, response)\n        }");
        return map;
    }
```
