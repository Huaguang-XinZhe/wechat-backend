# 微信小程序后端服务 - 邀请注册功能

这是一个支持微信小程序登录和邀请注册功能的 Node.js 后端服务。

## 🚀 功能特性

### 核心功能

- ✅ 微信小程序登录
- ✅ 邀请码注册系统
- ✅ 用户资料管理
- ✅ JWT Token 认证
- ✅ 支付功能（原有）
- ✅ 订单管理（原有）

### 邀请码系统

- ✅ 系统默认邀请码 `AAA`（仅供商户注册，一次性使用）
- ✅ 商户注册后自动生成个人邀请码
- ✅ 邀请码可多次使用
- ✅ 用户只能通过一个邀请码注册
- ✅ 邀请关系追踪
- ✅ 邀请统计功能

## 📋 技术栈

- Node.js + Express
- JWT 认证
- 内存存储（开发模式）
- Joi 数据验证
- Winston 日志
- Docker 支持

## 🛠️ 开发环境设置

### 1. 安装依赖

```bash
npm install
```

### 2. 环境配置

复制 `env.example` 到 `.env` 并修改配置：

```bash
cp env.example .env
```

主要配置项：

```env
# 服务配置
PORT=3000
NODE_ENV=development

# JWT 配置
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=7d

# 微信小程序配置
WECHAT_APPID=your-appid
WECHAT_SECRET=your-secret
```

### 3. 启动服务

```bash
# 开发模式（带热重载）
npm run dev

# 生产模式
npm start
```

## 🧪 测试

### API 功能测试

```bash
# 邀请码功能完整测试
npm run test:invite
```

### 手动测试

启动服务后访问：

- API 文档：`GET http://localhost:3000/api`
- 系统状态：`GET http://localhost:3000/api/debug/status`

## 📖 API 接口文档

### 认证相关

#### 1. 微信登录

```http
POST /api/auth/login
Content-Type: application/json

{
  "code": "微信登录code",
  "userInfo": {
    "nickName": "用户昵称",
    "avatarUrl": "头像地址",
    "gender": 1,
    "country": "中国",
    "province": "北京",
    "city": "北京",
    "language": "zh_CN"
  }
}
```

响应：

```json
// 新用户
{
  "code": 200,
  "message": "新用户",
  "data": {
    "isNewUser": true,
    "openid": "user_openid",
    "session_key": "session_key"
  }
}

// 已注册用户
{
  "code": 200,
  "message": "登录成功",
  "data": {
    "isNewUser": false,
    "token": "jwt_token",
    "userInfo": { ... },
    "inviteCode": "ABC123",
    "inviteFrom": "AAA"
  }
}
```

#### 2. 邀请码注册

```http
POST /api/auth/registerWithInviteCode
Content-Type: application/json

{
  "openid": "user_openid",
  "userInfo": {
    "nickName": "用户昵称",
    "avatarUrl": "头像地址",
    "gender": 1,
    "country": "中国",
    "province": "北京",
    "city": "北京",
    "language": "zh_CN"
  },
  "inviteCode": "AAA"
}
```

#### 3. 验证邀请码

```http
POST /api/auth/validateInviteCode
Content-Type: application/json

{
  "inviteCode": "ABC123"
}
```

#### 4. 获取邀请统计

```http
GET /api/auth/inviteStats
Authorization: Bearer your_jwt_token
```

### 调试接口（仅开发环境）

#### 查看所有用户

```http
GET /api/debug/users
```

#### 查看邀请码统计

```http
GET /api/debug/invite-codes
```

#### 测试邀请码验证

```http
POST /api/debug/test-invite-code
Content-Type: application/json

{
  "inviteCode": "AAA"
}
```

#### 清空测试数据

```http
DELETE /api/debug/clear
```

## 🔄 邀请码业务流程

### 1. 商户注册流程

1. 商户使用系统默认邀请码 `AAA` 注册
2. 系统验证邀请码有效性
3. 创建商户账户并生成个人邀请码（如 `XYZ789`）
4. 系统邀请码 `AAA` 标记为已使用

### 2. 用户注册流程

1. 用户通过分享链接打开小程序
2. 微信登录获取 openid
3. 如果是新用户，要求输入邀请码
4. 验证邀请码有效性
5. 创建用户账户并建立邀请关系

### 3. 邀请关系

- 每个用户只能通过一个邀请码注册
- 邀请码可以被多次使用
- 系统追踪完整的邀请关系链
- 支持邀请统计和分析

## 🔧 数据模型

### 用户模型

```javascript
{
  id: 1,                           // 用户ID
  openid: "wx_openid",            // 微信OpenID
  nickname: "用户昵称",            // 昵称
  avatar_url: "头像地址",          // 头像
  invite_code: "ABC123",          // 用户的邀请码
  invite_from: "AAA",             // 注册时使用的邀请码
  inviter_id: 1,                  // 邀请人ID
  created_at: "2024-01-01",       // 创建时间
  // ... 其他字段
}
```

### 邀请码映射

```javascript
{
  "AAA": null,        // 系统邀请码
  "ABC123": 1,        // 用户1的邀请码
  "XYZ789": 2,        // 用户2的邀请码
}
```

## 🐳 Docker 部署

### 构建镜像

```bash
npm run docker:build
```

### 运行容器

```bash
npm run docker:run
```

### Docker Compose 部署（推荐）

使用 Docker Compose 部署，并连接到 mall_mall-net 网络：

```bash
# 启动服务
npm run docker:compose:up

# 查看日志
npm run docker:compose:logs

# 停止服务
npm run docker:compose:down
```

> 注意：此配置已设置使用 mall_mall-net 内部网络，确保该网络已存在。

## 📝 开发说明

### 内存存储模式

当前使用内存存储模式，数据在服务重启后会丢失。适用于开发和测试环境。

### 数据库模式

生产环境可以切换到数据库模式：

1. 修改模型引用：`require("../models/User")` 替换 `require("../models/MemoryUser")`
2. 配置数据库连接
3. 运行数据库迁移

### 安全考虑

- JWT Token 有效期限制
- 请求频率限制
- 输入数据验证
- CORS 配置
- 错误信息隐藏

## 🚨 注意事项

1. **生产环境**：请确保修改默认的 JWT_SECRET
2. **微信配置**：需要配置正确的小程序 AppID 和 Secret
3. **域名配置**：生产环境需要配置正确的域名和 HTTPS
4. **数据持久化**：生产环境建议使用数据库存储

## 📞 支持

如有问题请联系开发团队或提交 Issue。

## �� 许可证

MIT License

## Token 兼容性方案

为了解决新后端生成的 token 与老后端不兼容的问题，我们采用了以下方案：

### 方案概述

1. 在创建用户时，使用固定的默认密码（member123）并进行哈希处理后存储到数据库
2. 登录时，通过调用老后端的登录接口（/sso/login）获取兼容的 token
3. 将老后端返回的 token 传递给前端使用

### 实现细节

1. 创建了 `LegacyApiService` 服务，负责与老后端通信
2. 修改了 `UserAdapterService`，在创建用户时设置哈希后的默认密码
3. 更新了登录接口和 token 验证接口，使用老后端的登录接口获取 token

### 测试脚本

- `npm run test:legacy-login`: 测试使用老后端登录接口获取 token

### 优点

1. 完全兼容老系统，解决了 token 格式不一致的问题
2. 无需修改前端代码
3. 保持了统一的认证机制

### 注意事项

1. 需要确保老后端服务可用
2. 所有用户使用相同的默认密码（member123）进行老后端认证
3. 实际认证和授权仍由新后端完成，老后端仅用于生成兼容的 token
