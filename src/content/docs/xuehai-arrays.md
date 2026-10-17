---
title: "学海定制终端网络与应用白名单分析报告"

description: "定制终端网络与应用白名单分析报告"
categories:
  - 技术解析
excerpt: 定制终端网络与应用白名单分析报告
---

# 学海定制终端网络与应用白名单分析报告

## 1. 总体结论

学海终端整体呈现典型“教育平板白名单管控”模式：

1. **网络域名采用白名单思路**：只放行 24 条域名规则，覆盖学海/智通云业务、第三方教育服务、设备厂商 OTA/管理域名。未列出的域名预计默认拦截。
2. **允许联网的应用非常少**：`app_firewall_domains_app` 仅 7 个，主要是学海浏览器、数据中心、WiFi 管理、设置、助手、百度定位、学海桌面。
3. **核心应用白名单固定**：`app_control_white_list` 与 `app_white_list` 完全一致，仅 6 个核心应用。
4. **大量第三方与厂商预装应用被列入“不保留/禁止”清单**：包括视频、社交、办公、应用商店、浏览器、相机、图库、音乐、联系人、邮件等。
5. **仅一个应用强制更新**：`com.xh.arespunc`。
6. **学海应用全集有 62 个包名**，但并非全部允许联网；允许联网的只是其中少数核心应用。

---

## 2. 允许/放行的网站域名

`app_firewall_domains` 共 24 条。按用途可分为三类。

### 2.1 学海/智通云业务域名

| 域名规则 | 可能用途 |
|---|---|
| `*.ztyedu.com` | 智通云/学海教育主域 |
| `*.zjxhedu.com` | 学海教育相关域名 |
| `*.ztytech.com` | 智通云技术/资源域名 |
| `xh-res.ztytech.com` | 学海资源服务 |
| `*.yunzuoye.net` | 云作业主域 |
| `play.yunzuoye.net` | 云作业播放/资源服务 |
| `*.xh.com` | 学海相关域名 |
| `*.xht.com` | 学海相关域名 |
| `*.100fen.com` | 100分/学习业务域名 |
| `xuehaifile.oss-cn-hangzhou.aliyuncs.com` | 阿里云 OSS 文件存储 |

### 2.2 第三方服务与 SDK 域名

| 域名规则 | 可能用途 |
|---|---|
| `*.cloud.ssapi.cn` | 第三方云服务/接口 |
| `*.netease.im` | 网易云信 IM |
| `cloud.chivox.com` | 驰声语音评测 |
| `atk.myscript.com` | MyScript 手写/公式识别 |
| `android.bugly.qq.com` | 腾讯 Bugly 崩溃统计 |
| `pingma.qq.com` | 腾讯相关统计/网络服务 |

### 2.3 厂商/设备管理/OTA 域名

| 域名规则 | 可能用途 |
|---|---|
| `*.ospserver.net` | 设备 OTA/管理服务 |
| `*.samsungdm.com` | 三星设备管理 |
| `*.secb2b.com.cn` | 三星企业/设备服务 |
| `*.secb2b.*` | 三星企业/设备服务，通配范围较宽 |
| `*.mayitek.com` | 设备管理/定制服务 |
| `*.adups.cn` | ADUPS FOTA/设备管理 |
| `*.adups.com` | ADUPS FOTA/设备管理 |
| `*.lenovo.com` | 联想设备/服务域名 |

### 2.4 推断的禁止网站策略

文件中没有明确的“禁止域名列表”。结合白名单模式，可推断：

- **未出现在 `app_firewall_domains` 中的网站默认不允许访问**。
- 常见娱乐、社交、视频、应用商店、第三方浏览器等域名预计会被拦截。
- 放行域名中包含设备厂商和第三方 SDK 域名，说明系统并非完全只放行学海业务，而是保留必要的 OTA、语音、手写、IM、崩溃统计能力。

---

## 3. 允许联网/防火墙应用白名单

`app_firewall_domains_app` 共 7 个：

| 应用包名 | 角色推断 |
|---|---|
| `com.xh.browser` | 学海浏览器 |
| `com.xh.datacenter` | 数据中心 |
| `com.zhitongyun.wifimanager` | WiFi 管理 |
| `com.xuehai.settings` | 学海设置 |
| `com.xh.assist` | 学海助手 |
| `com.baidu.map.location` | 百度定位服务 |
| `com.xuehai.xuehailauncher` | 学海桌面/启动器 |

结论：  
真正被允许走网络防火墙策略的应用极少。学海浏览器、数据中心、设置、助手、桌面和定位服务是网络能力核心。其他学海应用即使存在，也可能不直接联网，或通过网络代理/系统服务访问。

---

## 4. 应用白名单与管控白名单

`app_control_white_list` 与 `app_white_list` 内容完全一致，共 6 个：

| 应用包名 | 角色推断 |
|---|---|
| `com.xuehai.launcher` | 学海桌面/启动器 |
| `com.xh.zhitongyunstu` | 智通云学生端 |
| `com.xh.ime` | 学海输入法 |
| `com.xh.assist` | 学海助手 |
| `com.zhitongyun.wifimanager` | WiFi 管理 |
| `com.xuehai.settings` | 学海设置 |

这说明系统把“应用管控白名单”和“应用白名单”共用同一套核心应用集合。  
注意：白名单中是 `com.xuehai.launcher`，而学海应用全集和联网应用中有 `com.xuehai.xuehailauncher`，二者可能分别对应不同版本或不同角色。

---

## 5. 学海应用全集概览

`all_xh_app_package_name` 共 62 个，覆盖学生端、教师端、课堂、作业、考试、错题、词典、计算器、课程制作等。

主要类别：

| 类别 | 代表包名 |
|---|---|
| 桌面/启动器 | `com.xuehai.xuehailauncher`、`com.xuehai.launcher` |
| 核心工具 | `com.xh.ime`、`com.xh.assist`、`com.xh.dict`、`com.xh.calendar`、`com.xh.calculator` |
| 学生/教师端 | `com.xh.zhitongyunstu`、`com.xh.zhitongyuntch`、`com.zhitongyun.oetteacher`、`com.zhitongyun.oetStudent` |
| 课堂/互动 | `com.xh.smartclassstu`、`com.xh.smartclasstch`、`com.xh.smartclassroomstu`、`com.xh.smartclassroomtch` |
| 作业/考试 | `com.xuehai.examWeb`、`com.xh.doquestion`、`com.xuehai.mockexam`、`com.xh.homeworkreport` |
| 错题/反馈 | `com.xh.wronganswer`、`com.xuehai.mistakescollection`、`com.xh.feedback` |
| 课程/资源 | `com.xuehai.qualitycourse`、`com.xuehai.premiumcourses`、`com.xh.coursemaker`、`com.xuehai.cwpplayer` |
| 浏览器/数据 | `com.xh.browser`、`com.xh.datacenter`、`com.xh.responsebrowser` |
| 其他 | `cn.mdict`、`com.xh.zhitongyunqiwang`、`com.xuehai.assistant` |

这些包名是“学海应用全集”，不等同于允许联网清单。真正允许联网的只有 `app_firewall_domains_app` 中的 7 个。

---

## 6. 禁止/不保留应用分析

文件中存在多组 `un_keep_app`，表示不保留、禁止或可清理应用。整体特征是：**去娱乐化、去社交化、去第三方办公化、去厂商预装化，只保留学习核心和必要系统服务**。

### 6.1 通用禁止/不保留应用

`un_keep_app` 共 29 个，典型包括：

| 类型 | 代表应用 |
|---|---|
| 办公 | `cn.wps.moffice_eng`、Microsoft Office 系列、Polaris Office |
| 视频/娱乐 | 搜狐视频、爱奇艺、优酷、咪咕、QQ、UC、腾讯浏览器 |
| 阅读/新闻 | iReader、报刊、Flipboard、Viva |
| 网盘/输入法 | 百度网盘、搜狗输入法、讯飞语音 |
| 其他 | 唱吧华为 Pad 版、百度搜索三星版 |

### 6.2 系统级禁止/不保留应用

`android_un_keep_app` 共 16 个，包括：

- 系统浏览器、计算器、联系人、邮件、图库、短信、录音机
- 蓝牙、蓝牙 MIDI、InCallUI、媒体中心、音乐可视化等

说明系统会裁剪大量 Android 原生或厂商预装应用。

### 6.3 厂商禁止/不保留应用

| 厂商 | 数组 | 主要清理对象 |
|---|---|---|
| 华为 | `huawei_hem_un_keep_app`、`huawei_un_keep_app` | 华为浏览器、应用市场、视频编辑、文件管理、记事本、云空间、音乐、视频、联系人、计算器、相机、游戏中心、儿童模式、天气、主题等 |
| 联想 | `lenovo_un_keep_app`、`lenovo_un_keep_app_223fc`、`lenovo_un_keep_app_x6c6f` | 应用商店、浏览器、相机、WPS、文件管理、图库、音乐、时钟、FM 收音机、Google 拼音等 |
| 三星 | `samsung_un_keep_app`、`samsung_un_keep_app_p615`、`samsung_un_keep_app_p620` | 三星应用商店、浏览器、相机、图库、音乐、视频、日历、联系人、邮件、笔记、Bixby、AR 等 |

### 6.4 禁止策略推断

- 被列入 `un_keep_app` 的应用预计会被卸载、禁用、隐藏或不允许保留。
- 未列入白名单的应用可能无法运行或无法联网。
- 设备被定制为学习终端，禁止安装或保留大量消费级、娱乐级、办公级应用。

---

## 7. 强制更新与设备适配

### 7.1 强制更新应用

`app_update_force` 仅有一个：

| 包名 | 说明 |
|---|---|
| `com.xh.arespunc` | 唯一强制更新应用，可能是学海核心答题/响应/统一客户端组件 |

### 7.2 设备支持列表

| 数组 | 设备 |
|---|---|
| `device_huawei` | `BZT-W09` |
| `device_huawei_c5` | `BTKZ-W00`、`BZF5-W00`、`AY6-W00`、`BBG7-W00`、`BJS5-W00`、`BTKZ-AL00` |
| `device_lenovo` | `Lenovo TB-8604F`、`Lenovo TB-X6C6F`、`Lenovo TB223FC` |
| `device_samsung` | `SM-P350`、`SM-P355C`、`SM-P583` |
| `device_samsung_v3` | `SM-P200`、`SM-P615C`、`SM-P620` |
| `setting_custom_device` | `Lenovo TB-8604F`、`Lenovo TB-X6C6F`、`Lenovo TB223FC`、`SM-P200`、`SM-P615C` |
| `use_xh_notification_device` | `Lenovo TB223FC`、`SM-P620` |
| `use_xh_settings_device` | `BTKZ-W00`、`BZF5-W00`、`AY6-W00`、`BBG7-W00`、`Lenovo TB-8604F`、`Lenovo TB-X6C6F`、`Lenovo TB223FC`、`SM-P620` |

注意：`samsung_keep_app_p620` 是空数组，说明 SM-P620 可能不使用该保留列表，或由其他策略覆盖。

---

## 8. 风险与建议

1. **确认防火墙语义**  
   需核对代码中 `app_firewall_domains` 是 allowlist 还是 denylist。本文按白名单模式分析。

2. **通配符范围过宽**  
   `*.ztytech.com`、`*.xh.com`、`*.xht.com`、`*.100fen.com`、`*.secb2b.*` 等通配范围较大，建议收敛到必要子域，降低误放行风险。

3. **第三方 SDK 隐私合规**  
   放行域名包含网易云信、驰声、MyScript、Bugly、腾讯 pingma 等，涉及 IM、语音、手写、崩溃统计。建议在隐私政策中披露，并确认最小必要原则。

4. **厂商 OTA/管理域名需评估**  
   `*.adups.cn`、`*.adups.com`、`*.lenovo.com`、`*.samsungdm.com`、`*.ospserver.net`、`*.mayitek.com` 等可能带来 OTA、广告或设备管理流量，需确认是否必须放行。

5. **禁止列表维护成本高**  
   华为、联想、三星的 `un_keep_app` 列表非常长，且随系统版本变化。建议按机型、ROM 版本维护，避免误杀必要系统服务。

6. **强制更新包可用性**  
   `com.xh.arespunc` 是唯一强制更新应用，需确保其更新通道、签名、域名均在白名单内。

7. **设备差异化策略**  
   不同厂商、不同型号使用不同 keep/unkeep 列表和设置入口，建议建立设备-策略映射表，避免策略串用。
