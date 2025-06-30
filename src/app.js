const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
require("dotenv").config();

const logger = require("./utils/logger");
const errorHandler = require("./middleware/errorHandler");
// const { connectDB } = require("./config/database"); // 暂时禁用数据库
const authRoutes = require("./routes/auth");
const paymentRoutes = require("./routes/payment");
const userRoutes = require("./routes/user");
const debugRoutes = require("./routes/debug");

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0"; // 监听所有网络接口

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
          origin.startsWith("http://172.")
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
});
app.use("/api/", limiter);

// 解析请求体
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

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
    database: "disabled", // 标记数据库状态
    mode: "memory-only", // 当前运行模式
  });
});

// 根路径 - API 信息
app.get("/", (req, res) => {
  res.json({
    message: "微信小程序后端服务",
    version: "1.0.0",
    mode: "开发模式 (内存存储)",
    database: "暂时禁用",
    timestamp: new Date().toISOString(),
    endpoints: {
      health: "/health",
      auth: {
        login: "POST /api/auth/login",
        verify: "POST /api/auth/verify",
        refresh: "POST /api/auth/refresh",
        updateProfile: "POST /api/auth/updateProfile",
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
    },
  });
});

// API 文档路径
app.get("/api", (req, res) => {
  res.json({
    message: "微信小程序 API 文档",
    version: "1.0.0",
    mode: "内存存储模式",
    note: "当前使用内存存储，重启服务后数据会丢失",
    baseURL: `http://localhost:${PORT}/api`,
    endpoints: {
      认证相关: {
        微信登录: {
          method: "POST",
          url: "/api/auth/login",
          description: "使用微信 code 进行登录",
          body: {
            code: "微信登录 code",
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
    },
  });
});

// API 路由
app.use("/api/auth", authRoutes);
app.use("/api/payment", paymentRoutes);
app.use("/api/user", userRoutes);
app.use("/api/debug", debugRoutes);

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
    // 暂时跳过数据库连接
    // await connectDB();
    logger.info("🚀 服务启动模式：内存存储（无数据库）");

    // 启动服务器 - 监听所有网络接口
    app.listen(PORT, HOST, () => {
      logger.info(`✅ 服务器启动成功，地址：${HOST}:${PORT}`);
      logger.info(`🌍 环境：${process.env.NODE_ENV}`);
      logger.info(`💾 存储模式：内存存储（重启后数据丢失）`);
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
