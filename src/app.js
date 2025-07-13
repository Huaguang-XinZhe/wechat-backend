const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const morgan = require("morgan");
require("dotenv").config();

const logger = require("./utils/logger");
const errorHandler = require("./middleware/errorHandler");
// const { connectDB } = require("./config/database"); // 暂时禁用数据库
const { testLegacyConnection } = require("./config/legacyDatabase"); // 引入老系统数据库连接测试
const authRoutes = require("./routes/auth");
const paymentRoutes = require("./routes/payment"); // 使用完整版支付路由
const paymentNotifyRoutes = require("./routes/paymentNotify"); // 支付通知路由
const userRoutes = require("./routes/user");
const debugRoutes = require("./routes/debug");
const authLegacyRoutes = require("./routes/auth-legacy"); // 添加老系统兼容路由
const testRoutes = require("./routes/test"); // 添加测试路由
const wxDeliveryRoutes = require("./routes/wxDelivery"); // 添加微信物流相关路由
const ordersRoutes = require("./routes/orders"); // 添加订单相关路由

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0"; // 监听所有网络接口

// 信任代理，支持 ngrok/x-forwarded-for
// 修改为只信任特定的代理，而不是所有代理
app.set("trust proxy", ["loopback", "linklocal", "uniquelocal"]);

// 中间件配置
app.use(helmet()); // 安全头
app.use(compression()); // 压缩响应

// 更新 CORS 配置以支持真机访问
app.use(
  cors({
    origin: function (origin, callback) {
      // 允许没有 origin 的请求（如移动应用）
      if (!origin) return callback(null, true);

      // 允许的域名列表
      const allowedOrigins = [
        "https://servicewechat.com", // 微信小程序
        "https://127.0.0.1",
        "https://localhost",
        "http://127.0.0.1:3000",
        "http://localhost:3000",
      ];

      // 开发环境允许所有本地 IP 访问
      if (process.env.NODE_ENV === "development") {
        if (
          origin.startsWith("http://192.168.") ||
          origin.startsWith("http://10.") ||
          origin.startsWith("http://172.") ||
          origin.includes("ngrok") // 允许 ngrok 域名
        ) {
          return callback(null, true);
        }
      }

      if (allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        callback(null, true); // 开发环境暂时允许所有来源
      }
    },
    credentials: true,
  })
);

// 限流配置
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分钟
  max: 100, // 限制每个 IP 15 分钟内最多 100 次请求
  message: {
    error: "请求过于频繁，请稍后再试",
    code: 429,
  },
  // 自定义密钥生成器，处理 ngrok 等代理情况
  keyGenerator: (req) => {
    // 优先使用 X-Forwarded-For 的第一个 IP（客户端真实 IP）
    if (req.headers["x-forwarded-for"]) {
      const forwardedIps = req.headers["x-forwarded-for"]
        .split(",")
        .map((ip) => ip.trim());
      return forwardedIps[0];
    }
    // 回退到 req.ip
    return req.ip;
  },
  // 禁用 trustProxy 验证
  validate: { trustProxy: false },
});
app.use("/api/", limiter);

// 条件性解析请求体 - 跳过微信支付回调路径，避免 XML 数据被预先解析
app.use((req, res, next) => {
  // 跳过微信支付回调路径的 body parsing
  if (req.url.includes('/payment/notify')) {
    return next();
  }
  
  // 对其他路径应用 body parser
  express.json({ limit: "10mb" })(req, res, () => {
    express.urlencoded({ extended: true, limit: "10mb" })(req, res, next);
  });
});

// 为微信支付回调创建特殊的路由处理，跳过 body parser
// app.use("/api/payment/notify", paymentNotifyRouter); // 移除此行

// 请求日志
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.url} - ${req.ip}`);
  next();
});

// 健康检查接口
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
    database: "legacy-compatible", // 标记数据库状态
    mode: "legacy-adapter", // 当前运行模式
  });
});

// 根路径 - API 信息
app.get("/", (req, res) => {
  res.json({
    message: "微信小程序后端服务",
    version: "1.0.0",
    mode: "老系统兼容模式",
    database: "使用老系统数据库",
    timestamp: new Date().toISOString(),
    endpoints: {
      health: "/health",
      auth: {
        login: "POST /api/auth/login",
        phoneLogin: "POST /api/auth/phoneLogin",
        registerWithInviteCode: "POST /api/auth/registerWithInviteCode",
        validateInviteCode: "POST /api/auth/validateInviteCode",
        verify: "POST /api/auth/verify",
        updateProfile: "POST /api/auth/updateProfile",
        inviteStats: "GET /api/auth/inviteStats",
      },
      payment: {
        create: "POST /api/payment/create",
        orders: "GET /api/payment/orders",
        order: "GET /api/payment/order/:orderNo",
      },
      user: {
        profile: "GET /api/user/profile",
        update: "PUT /api/user/profile",
      },
      老系统兼容API: {
        phoneLogin: "POST /api/legacy/auth/phoneLogin",
        validateInviteCode: "POST /api/legacy/auth/validateInviteCode",
        verify: "POST /api/legacy/auth/verify",
        updateProfile: "POST /api/legacy/auth/updateProfile",
        inviteStats: "GET /api/legacy/auth/inviteStats",
      },
    },
  });
});

// API 文档路径
app.get("/api", (req, res) => {
  res.json({
    message: "微信小程序 API 文档",
    version: "1.0.0",
    mode: "老系统兼容模式",
    note: "已对接老系统数据库",
    baseURL: `http://localhost:${PORT}/api`,
    endpoints: {
      认证相关: {
        微信登录: {
          method: "POST",
          url: "/api/auth/login",
          description: "使用微信 code 进行登录，返回新用户标识或直接登录",
          body: {
            code: "微信登录 code",
            userInfo: "用户信息（可选）",
            inviteCode: "邀请码（可选）",
          },
          response: {
            新用户: "返回 isNewUser: true, openid, session_key",
            已注册用户: "返回 isNewUser: false, token, userInfo, inviteCode",
          },
        },
        手机号登录: {
          method: "POST",
          url: "/api/auth/phoneLogin",
          description: "使用微信手机号一键登录",
          body: {
            code: "微信登录 code",
            encryptedData: "加密的手机号数据",
            iv: "加密算法的初始向量",
            inviteCode: "邀请码（新用户必需）",
          },
        },
        邀请码注册: {
          method: "POST",
          url: "/api/auth/registerWithInviteCode",
          description: "通过邀请码注册新用户",
          body: {
            openid: "用户 openid",
            userInfo: {
              nickName: "用户昵称",
              avatarUrl: "头像地址",
              gender: "性别 0-未知 1-男 2-女",
              country: "国家",
              province: "省份",
              city: "城市",
              language: "语言",
            },
            inviteCode: "邀请码（6位字母数字）",
          },
        },
        验证邀请码: {
          method: "POST",
          url: "/api/auth/validateInviteCode",
          description: "验证邀请码是否有效",
          body: {
            inviteCode: "邀请码",
          },
        },
        更新用户资料: {
          method: "POST",
          url: "/api/auth/updateProfile",
          description: "更新用户头像昵称等信息",
          headers: {
            Authorization: "Bearer your_jwt_token",
          },
          body: {
            userInfo: {
              nickName: "用户昵称",
              avatarUrl: "头像地址",
              gender: "性别 0-未知 1-男 2-女",
              country: "国家",
              province: "省份",
              city: "城市",
              language: "语言",
            },
          },
        },
        "验证 Token": {
          method: "POST",
          url: "/api/auth/verify",
          description: "验证 JWT Token 是否有效",
          headers: {
            Authorization: "Bearer your_jwt_token",
          },
        },
        邀请统计: {
          method: "GET",
          url: "/api/auth/inviteStats",
          description: "获取用户邀请码和邀请统计信息",
          headers: {
            Authorization: "Bearer your_jwt_token",
          },
        },
      },
      支付相关: {
        创建支付订单: {
          method: "POST",
          url: "/api/payment/create",
          description: "创建微信支付订单",
          headers: {
            Authorization: "Bearer your_jwt_token",
          },
          body: {
            goodsId: "商品ID",
            goodsName: "商品名称",
            amount: "金额（元）",
            remark: "备注",
          },
        },
        查询订单列表: {
          method: "GET",
          url: "/api/payment/orders",
          description: "获取用户订单列表",
          headers: {
            Authorization: "Bearer your_jwt_token",
          },
          query: {
            page: "页码（默认1）",
            limit: "每页数量（默认10）",
            status: "订单状态（可选）",
          },
        },
      },
      老系统兼容API: {
        手机号登录: {
          method: "POST",
          url: "/api/legacy/auth/phoneLogin",
          description: "兼容老系统的手机号登录API",
          body: {
            code: "微信登录 code",
            encryptedData: "加密的手机号数据",
            iv: "加密算法的初始向量",
            inviteCode: "邀请码（新用户必需）",
          },
        },
      },
    },
  });
});

// API 路由
app.use("/api/auth", authRoutes);
app.use("/api/payment", paymentRoutes); // 使用完整版支付路由
app.use("/api/payment", paymentNotifyRoutes); // 注册支付通知路由
app.use("/api/user", userRoutes);
app.use("/api/debug", debugRoutes);
// 添加老系统兼容路由
app.use("/api/legacy/auth", authLegacyRoutes);
// 添加测试路由
app.use("/api/test", testRoutes);
// 添加订单相关路由
app.use("/api/orders", ordersRoutes);
// 添加微信物流相关路由
app.use("/api/wx-delivery", wxDeliveryRoutes);

// 404 处理
app.use("*", (req, res) => {
  res.status(404).json({
    success: false,
    message: "接口不存在",
    code: 404,
  });
});

// 全局错误处理
app.use(errorHandler);

// 启动服务器
async function startServer() {
  try {
    // 测试老系统数据库连接
    const legacyDbConnected = await testLegacyConnection();

    logger.info("🚀 服务启动模式：老系统兼容模式");

    if (legacyDbConnected) {
      logger.info("✅ 老系统数据库连接成功");
    } else {
      logger.warn("⚠️ 老系统数据库连接失败，将使用内存模式");
    }

    // 启动服务器 - 监听所有网络接口
    app.listen(PORT, HOST, () => {
      logger.info(`✅ 服务器启动成功，地址：${HOST}:${PORT}`);
      logger.info(`🌍 环境：${process.env.NODE_ENV}`);
      logger.info(
        `💾 存储模式：${
          legacyDbConnected ? "老系统数据库" : "内存存储（重启后数据丢失）"
        }`
      );
      logger.info(`🏥 健康检查：http://localhost:${PORT}/health`);
      logger.info(`📖 API 文档：http://localhost:${PORT}/api`);

      // 显示所有可能的访问地址
      console.log("\n📡 服务访问地址：");
      console.log(`   - 本地访问：http://localhost:${PORT}`);
      console.log(`   - 局域网访问：http://[你的IP地址]:${PORT}`);
      console.log(
        "   - 真机测试：请将小程序中的 baseURL 修改为你的电脑 IP 地址"
      );
      console.log("\n🎉 后端服务已启动，支持真机访问！");
    });
  } catch (error) {
    logger.error("服务器启动失败:", error);
    process.exit(1);
  }
}

// 优雅关闭
process.on("SIGTERM", () => {
  logger.info("收到 SIGTERM 信号，正在关闭服务器...");
  process.exit(0);
});

process.on("SIGINT", () => {
  logger.info("收到 SIGINT 信号，正在关闭服务器...");
  process.exit(0);
});

// 未捕获的异常处理
process.on("uncaughtException", (error) => {
  logger.error("未捕获的异常:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error("未处理的 Promise 拒绝:", reason);
  process.exit(1);
});

startServer();

module.exports = app;
