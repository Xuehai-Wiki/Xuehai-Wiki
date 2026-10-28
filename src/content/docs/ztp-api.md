---
title: "智通平台 API 服务地址分类汇总"

description: "智通平台 API 服务地址分类汇总"
categories:
  - 应用
---

## 🌐 API 服务地址分类汇总

### 1️⃣ 认证与设备管理 (Authentication & Device Management)

| 地址 | 用途 |
|------|------|
| `https://ztp.yunzuoye.net/api/v1/check/device` | 设备认证校验 |
| `https://ztp.yunzuoye.net/api/v1/check/os` | 系统版本校验 |
| `https://ztp.yunzuoye.net/api/v1/check/app` | 应用合法性校验 |
| `http://47.111.168.116:8089/api/v1/device/register` | 设备注册(开发环境) |

### 2️⃣ 文件服务 (File Service / OSS)

| 地址 | 用途 |
|------|------|
| `https://filesoss.yunzuoye.net` | 文件服务器(生产) |
| `http://filesoss.yunzuoye.net/XHFileServer/file/stream` | 文件流下载 |
| `http://filesoss.yunzuoye.net/XHFileServer/file/batch/upload/tmp` | 批量上传(临时) |
| `https://files.yunzuoye.net/XHFileServer/file/zip` | ZIP 压缩包上传 |

### 3️⃣ 数据埋点与分析 (Analytics & Tracking)

| 地址 | 用途 |
|------|------|
| `http://47.111.168.116:8089/api/track/save` | 埋点数据上报 |
| `http://47.111.168.116:8089/api/config` | 远程配置拉取 |

### 4️⃣ MDM 设备管理 (Mobile Device Management)

| 地址 | 用途 |
|------|------|
| `http://ztp.yunzuoye.net/XHFileServer/api/v1/mdm` | MDM 策略下发 |
| `http://filesoss.yunzuoye.net/XHFileServer/api/v1/mdm/policy` | MDM 策略下发 |

### 5️⃣ 华为 HMS 生态服务

| 地址 | 用途 |
|------|------|
| `https://filesoss.yunzuoye.net/hms/` | 华为 HMS Core 推送 |
| `http://files.yunzuoye.net/hms/` | HMS 文件服务 |

### 6️⃣ 开发/测试环境 (Development & Testing)

| 地址 | 用途 |
|------|------|
| `http://filesoss.yunzuoye.net/dev` | 开发环境 |
| `http://files.yunzuoye.net/test` | 测试环境 |

### 7️⃣ 第三方 OSS 服务 (Third-party OSS)

| 地址 | 用途 |
|------|------|
| `http://filesoss.yunzuoye.net/oss/` | 对象存储服务 |
| `http://files.yunzuoye.net/oss/upload` | OSS 上传 |

---

## 🔍 关键发现

1. **双环境架构**: 代码中通过 `BuildConfig.DEBUG` 或 `isProduction()` 标志切换生产/测试环境
2. **硬编码 IP**: `47.111.168.116` (埋点服务器) 和 `192.168.10.93` (内网文件服务器) 直接写死在 `ConstServerBaseUrlKt.java` 中
3. **文件服务冗余**: 存在 **4 套不同的文件服务器域名**(filesoss / files / filesoss.yunzuoye / files.yunzuoye),疑似历史遗留或灰度分流
4. **HTTP 明文风险**: 大量接口仍使用 `http://` 而非 `https://`,存在中间人攻击风险
5. ****关键发现**: 发现了完整的 API 地址矩阵** — 包括认证、文件、埋点、MDM 策略下发等 4 大类共 16 个服务端点
