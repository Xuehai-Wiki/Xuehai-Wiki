---
title: "研究原件登记表"

description: "这批独立研究材料的全部二进制原件清单：路径、SHA256、体积与用途。原件不入库，此处只做可核对的登记"

categories:
  - 索引
  - 研究资料
excerpt: 研究过程中产生的 APK、7z 载荷包、实验证书、Zygisk 原生库与 PDF 体积大、不可检索且有合规风险，一律不入库。本页登记每个原件的原始路径、SHA256 前 16 位、字节数与用途，供需要时在离线环境核对。
---

# 研究原件登记表

> 分析对象：`XH/` 目录下除 wiki 本体之外的研究材料中，全部二进制文件。
> 原件均**不在本仓库内**，路径为采集时的原始位置。
> 配套阅读：[[research]]（研究资料索引）、[[research/smp200]]、[[research/envspoof]]、[[research/attack-chain]]。

## 一、为什么不入库

| 原因 | 说明 |
| --- | --- |
| 不可检索 | 二进制无法被站点搜索、无法被 wikilink 引用，放进来只是增加了体积 |
| 体积 | 单个 APK 即 7MB，原生库 1.9MB，整批约 17MB |
| 合规 | 载荷包与证书本身即为敏感物，进入公开仓库等于二次分发 |
| 可替换 | 真正有价值的是**怎么造出来的**，那部分以文字形式记录在正文里 |

因此本页只登记「有这个东西、它是什么、怎么核对」，不提供下载。

## 二、登记表

以下 SHA256 列均为**前 16 位十六进制**，用于快速核对；需要完整哈希时按同样方法离线计算。

### 2.1 环境伪装模块（`doc_from_chidc/`）

| 原件 | SHA256 前16 | 字节数 | 用途 |
| --- | --- | --- | --- |
| `XH-EnvSpoof/XH-EnvSpoof/XHEnvSpoof.apk` | `612d3b5ec4769a67` | 7,192,292 | 伪装模块 Release 产物（R8，约 6.86MB 主体 + 资源） |
| `XH-EnvSpoof/XH-EnvSpoof/kiosk/xh_kiosk.zip` | `bade98de2c46fa9d` | 4,809 | kiosk 模式的 Magisk 模块包（`module.prop` + 脚本） |
| `XH-EnvSpoof/XH-EnvSpoof/native/xh_nativehide.zip` | `373d1b3b808750f1` | 827,695 | 原生层隐藏模块的打包产物（双架构 zygisk 库） |
| `XH-EnvSpoof/XH-EnvSpoof/screenshot-三按钮透明导航.png` | `a31c826373354062` | 54,009 | kiosk 隐藏导航栏后的界面截图 |

### 2.2 原生库（`doc_from_chidc/xh_nativehide/`）

| 原件 | SHA256 前16 | 字节数 | 用途 |
| --- | --- | --- | --- |
| `zygisk/arm64-v8a.so` | `225407f687d2d3ae` | 1,900,016 | arm64 架构的 zygisk 模块主体，仅过滤目标包名的 maps |
| `zygisk/armeabi-v7a.so` | `39a0b6fdc8c79602` | 1,125,284 | armeabi-v7a 架构的同名模块 |

### 2.3 复盘文稿（`doc_from_chidc/`）

| 原件 | SHA256 前16 | 字节数 | 用途 |
| --- | --- | --- | --- |
| `XH-失败复盘-给同学/XH-失败复盘-给同学/XH-失败复盘-给同学.pdf` | `be4d90f8247a73a1` | 585,687 | 复盘稿的 PDF 导出版，与 Markdown 同源 |

### 2.4 载荷与数据库包（`doc_from_oliver/` — Private）

| 原件 | SHA256 前16 | 字节数 | 用途 |
| --- | --- | --- | --- |
| `O-XueHai-Unlocker-Private/payloads/agent.apk` | `8f0c4d648f5f742c` | 587,488 | 载荷 v20（`versionCode 9203`），含场景白名单修复逻辑 |
| `.../payloads/db35_status25_vc9203.7z` | `77cc8bab34040b8c` | 329,257 | 7z 任意路径写载荷，携带 `status=25` 任务行 + v20 APK |
| `.../payloads/payload_proxy.7z` | `77cc8bab34040b8c` | 329,257 | 同上（内容相同，命名区分用途） |
| `.../payloads/payload_db10_traversal-ok.7z` | `0183b70599d81515` | 33,704 | 首个成功的路径穿越载荷（db10 轮） |
| `.../payloads/payload_db12_status0.7z` | `371123ea4a8e9d44` | 9,409 | `status=0` 变体，用于验证任务行状态语义 |
| `.../payloads/wal_empty.bin` | `4d56833da3edf829` | 32 | 空 WAL 文件，替换数据库时避免 SQLite 回滚覆盖 |

### 2.5 实验室载荷（`doc_from_oliver/` — 公开版）

| 原件 | SHA256 前16 | 字节数 | 用途 |
| --- | --- | --- | --- |
| `O-XueHai-Unlocker/payloads/agent.apk` | `bafbd001a24258a2` | 1,866,277 | 早期载荷版本，用于验证静默安装路径 |
| `.../payloads/clienthello.bin` | `6f4626f978506502` | 517 | 保存的 TLS ClientHello，用于对照指纹 |
| `.../payloads/lab-certs/fullchain.pem` | `b7d26d5002f4ec36` | 3,384 | 实验室自签证书链（证明自签方案不可行，见 [[research/unlocker-architecture]]） |
| `.../payloads/lab-certs/mitm_fullchain.pem` | `a1492d7bad468f13` | 6,912 | 中间人实验用证书链 |
| `.../payloads/lab-certs/mitm_server.crt` | `cb5efcddb932685d` | 1,360 | 中间人实验服务端证书 |
| `.../payloads/lab-payload-db-traversal.7z` | `e85a10730fa03810` | 2,270 | 最小路径穿越验证包 |
| `.../payloads/payload_malicious.cwp` | `4e02ad3d12869c50` | 1,422 | 课件包格式（`.cwp`）的畸形样本，验证解析边界 |
| `.../payloads/payload_proxy.7z` | `5277714d87cebad9` | 9,312 | 代理配置注入载荷 |
| `.../payloads/payload_slip.7z` | `e6a3659345352e27` | 14,092 | Zip Slip 样本（该路径最终判定不可达，见 [[research/dead-ends]]） |
| `.../payloads/nso.webp` | `eab21bc833efca38` | 350 | 界面测试用图，验证图片加载链路 |

## 三、文本材料的对应关系

二进制之外，文本材料约 7,400 行，已全部并入本站：

| 原文件 | 去处 |
| --- | --- |
| `mdm.md` | [[research/mdm-aidl-guide]] |
| `smp200.md` | [[research/smp200]] |
| `RESEARCH_REPORT_PUSH_CHANNEL.md` | [[research/push-channel-reverse]] |
| `学海审计-20261123.md` | [[research/log-upload-endpoints]] |
| `XH-EnvSpoof/.../README.md` | [[research/envspoof]] |
| `XH-EnvSpoof/.../AUDIT_LOGIN_SCREEN_COVERAGE.md` | [[research/login-chain-audit]] |
| `XH-失败复盘-给同学/.../XH-失败复盘-给同学.md` | [[research/postmortem]] |
| `XH-Assist-Package-*/README.md` | [[research/assist-channel-repro]] |
| `O-XueHai-Unlocker/docs/{ARCHITECTURE,METHODOLOGY}.md` | [[research/unlocker-architecture]]、[[research/unlocker-methodology]] |
| `O-XueHai-Unlocker-Private/docs/{CHAIN,ENTRY-POINTS}.md` | [[research/attack-chain]]、[[research/dead-ends]] |
| `O-XueHai-Unlocker-Private/docs/{DEAD-ENDS,SCENE-CONTROL,PAYLOAD}.md` | [[research/dead-ends]]、[[research/attack-chain]] |
| `O-XueHai-Unlocker-Private/docs/MDM-AIDL.md` | [[research/mdm-aidl-guide]] |

> `学海审计-20261123.md` 与 `XH-EnvSpoof/.../AUDIT_ENV_LOGIN_LOG_UPLOAD.md` 的 MD5 完全相同（`45ed43102d710d4f3a0205cad180f8f0`），属同一份文件的两个副本，本站只收录一次。

## 四、核对方法

需要离线核对某个原件时：

```text
Windows PowerShell:  Get-FileHash -Algorithm SHA256 <文件路径>
Linux / macOS:       shasum -a 256 <文件路径>
```

取结果前 16 位与本页对照即可。完整哈希值以离线环境计算为准，本页不转写完整值——避免把「核对工具」本身变成敏感数据的载体。

一句话概括：**原件不入库，但每一个都能被核对；真正留下来的知识写在正文里，那才是搬不走的部分。**
