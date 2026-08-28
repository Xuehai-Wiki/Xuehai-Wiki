---
title: "动态码"
description: 动态码是学海用于重置设备的动态密码
badge:
  text: 示例
  variant: note
---

# 关于动态码的一些研究

## 动态码是什么？
动态码是学海系统中用于设备重置的一个代码，其本质是一个TOTP（基于时间的单次密码）

## 如何输入动态码？
动态码界面会在两种情况下出现：
1. 反复杀死智通平台进程（约15遍，智通云会显示“启动失败”，点击右下角“其他”，再点击“设备重置”，便可进入动态码界面）
2. 使得智通平台崩溃（3遍，智通云会显示“设备修复”界面，点击“进入安全模式”，再点击“设备重置”）

使得智通平台崩溃的方式：先在学海题舟、智通云听说、资料中心中下大体积文件，当提示“空间不足”时，在云课堂中下载文件直至无法再下载（提示 `No Space Left On Device` ），此时智通平台将因为没有空间而反复崩溃，等待即可

##  如何获取动态码？
通过反编译，我们得到了以下代码：

```java
public final Object invokeSuspend(Object obj) throws Throwable {
    IntrinsicsKt.getCOROUTINE_SUSPENDED();
    if (this.label != 0) {
        throw new IllegalStateException("call to 'resume' before 'invoke' with coroutine");
    }
    ResultKt.throwOnFailure(obj);
    MyLog.i("[MDM]", "验证动态码: " + this.$code);
    if (this.$code.length() == 0) {
        if (App.INSTANCE.getInstance().isDebug()) {
            MyLog.i("Debug[MDM]", "当前为测试版本，输入空直接跳转解锁！");
            LiveDataExtKt.action(this.this$0.getShowDeviceResetView());
        } else {
            this.this$0.toastMessage("输入内容不可为空！");
        }
        return Unit.INSTANCE;
    }
    if (NetworkUtil.INSTANCE.getNetworkType(App.INSTANCE.getInstance()).getIsAvailable() ? this.this$0.checkOnline(this.$code) : this.this$0.checkOffline(this.$code)) {
        LiveDataExtKt.action(this.this$0.getShowDeviceResetView());
    } else {
        this.this$0.toastMessage("动态码错误！");
    }
    LiveDataExtKt.action(this.this$0.getCloseDialogEvent());
    return Unit.INSTANCE;
}
```
可以看到，如果当前为在线状态，那么就会进行在线验证，否则进行离线验证。

## 在线验证
系统将你输入的动态码和设备号发送给学海后台进行验证。

**注意，只有后台手动给你生成了类型为在线的动态码，验证才有可能通过，暴力碰撞是无用的。**

```java
    public final LResponse checkBrushCode(String code) throws JSONException {
        Intrinsics.checkNotNullParameter(code, "code");
        MyLog.i("Http[MDM]", "校验code");
        JSONObject jSONObject = new JSONObject();
        try {
            jSONObject.put("code", code);
            jSONObject.put("deviceId", BaseApplication.INSTANCE.getInstance().getDeviceId());
        } catch (Exception e) {
            e.printStackTrace();
        }
        LRequest.Builder builderUrl$default = LRequest.Builder.url$default(new LRequest.Builder(), getUrl() + "/api/v2/pub/platform/brushCode", null, 2, null);
        LRequestBody lRequestBodyCreate = LRequestBody.create(jSONObject);
        Intrinsics.checkNotNullExpressionValue(lRequestBodyCreate, "create(jsonObject)");
        return RequestHelper.INSTANCE.requestWithRestful(builderUrl$default.patch(lRequestBodyCreate).build());
    }
```

## 离线验证
其实就是简单的 TOTP 算法，使用两个参数来生成动态码并和你的输入进行比较。

这两个参数分别是：当前时间、`SecretKey`。当前时间我们都知道，但是 `SecretKey` 是存储在 `xuehai/keep/device/` 中的，在无法打开文件的情况下无法获取。

`SecretKey` 在账户初始化时生成，此后与你终身绑定，即使刷机也不会更换，学海官方拥有设备号-`SecretKey` 的配对关系，因此他们可以算出动态码。

如果通过某些手段重置了设备，可在 `/xuehai/keep/device` 下找到一个后缀名为 `.ls` 的文件。该文件的大小为0。复制其文件名（不含后缀），称为 `EncrypedSecretKey`，是一个160位Hex。

示例：`D613859CB4EE323BE507F131B4E821B8E9B723EF81A3BD76CD31E1DF8B3AE908FC974DC55706395130EE21FCE5F5A036D23D7E964661CF8D6DEE5A1AF5E6894181A9BD164671F74E9C1257E300753E0F`

使用 `453DA222330F6F421E7DABF2CAB6AECC` 为密钥，PKCS5Padding 填充，ECB 模式进行 AES 解密，得到 `SecretKey` 明文。

示例：`MJSTONRUGY2TELLBMVTDQLJUGIYDQLJYGQYGMLLDMU2GMNBWHE3DOOJSGNJFI33K`

注意到 `SecretKey` 是一个 Base32 字符串，这与代码中描述相符。

使用 Base32 解码得到一串字符串，其符合 UUID 格式。

示例：`be764652-aef8-4208-840f-ce4f46967923RToj`

另外，我们在代码中发现一个残余的 `SecretKey`，推测用于测试：

`GYZWCYTCMMZGELJUMVRWGLJUMJRGILLBGJRTQLJVMVQTQNJXMRSTENJRHFRXITDY` 

对应 UUID `63abbc2b-4ecc-4bbd-a2c8-5ea857de2519ctLx`

获取到 `SecretKey` 后，可以使用这个网站获取动态码：

[TOTP在线计算网站](https://www.toolbox365.cn/tools/totp/)

位数为6，周期为60s，算法为 SHA1

```java
public class TotpUtils {
    private static final int CODE_DIGITS = 6;
    private static final int TIME_STEP = 60;

    public static String createDeviceRandomText(int i) {
        return SecretUtil.createRandomText(i, SecretUtil.createRandomText(i, "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ") + BaseApplication.getInstance().getDeviceId()).toUpperCase();
    }

    private static String generateTOTP(String str, int i, int i2) throws NoSuchAlgorithmException, InvalidKeyException {
        if (i2 < 1 || i2 > 18) {
            throw new UnsupportedOperationException("不支持" + i2 + "位数的动态口令");
        }
        byte[] bArrHmacSha = hmacSha(ByteBuffer.allocate(8).putLong(getCurrentInterval(i)).array(), str);
        int i3 = bArrHmacSha[bArrHmacSha.length - 1] & 15;
        return leftPadding(Long.toString(((bArrHmacSha[i3 + 3] & 255) | (((bArrHmacSha[i3 + 2] & 255) << 8) | (((bArrHmacSha[i3] & 127) << 24) | ((bArrHmacSha[i3 + 1] & 255) << 16)))) % Long.parseLong(rightPadding("1", i2 + 1))), i2);
    }

    private static long getCurrentInterval(int i) {
        if (i < 0) {
            i = 60;
        }
        return (System.currentTimeMillis() / 1000) / i;
    }

    private static byte[] hmacSha(byte[] bArr, String str) throws NoSuchAlgorithmException, InvalidKeyException {
        try {
            byte[] bArrDecode = new Base32().decode(str);
            Mac mac = Mac.getInstance("HmacSHA1");
            mac.init(new SecretKeySpec(bArrDecode, "HmacSHA1"));
            return mac.doFinal(bArr);
        } catch (Exception e) {
            throw new UndeclaredThrowableException(e);
        }
    }

    private static String leftPadding(String str, int i) {
        StringBuilder sb = new StringBuilder(str);
        while (sb.length() < i) {
            sb.insert(0, "0");
        }
        return sb.toString();
    }

    private static String rightPadding(String str, int i) {
        StringBuilder sb = new StringBuilder(str);
        while (sb.length() < i) {
            sb.append("0");
        }
        return sb.toString();
    }

    public static boolean verify(String str, String str2, int i) {
        return verify(str, str2, i, 6);
    }

    public static boolean verify(String str, String str2, int i, int i2) {
        for (int i3 = 0; i3 <= 1; i3++) {
            if (generateTOTP(str, i, i2).equals(str2)) {
                return true;
            }
        }
        return false;
    }
}