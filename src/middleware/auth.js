const jwt = require("jsonwebtoken");
// const User = require("../models/User"); // 数据库版本
const User = require("../models/MemoryUser"); // 内存存储版本（单例）
const logger = require("../utils/logger");

// JWT 验证中间件
async function authenticateToken(req, res, next) {
  try {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "访问令牌缺失",
        code: 401,
      });
    }

    // 验证 JWT
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 查找用户
    const user = await User.findByPk(decoded.userId);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "用户不存在",
        code: 401,
      });
    }

    // 将完整用户对象添加到请求对象
    req.user = user;
    next();
  } catch (error) {
    logger.error("JWT 验证失败:", error);

    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "访问令牌已过期",
        code: 401,
      });
    }

    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({
        success: false,
        message: "无效的访问令牌",
        code: 401,
      });
    }

    return res.status(500).json({
      success: false,
      message: "身份验证失败",
      code: 500,
    });
  }
}

// 可选身份验证中间件（不强制要求登录）
async function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];

    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findByPk(decoded.userId);
      if (user) {
        req.user = user;
      }
    }

    next();
  } catch (error) {
    // 可选认证失败时继续执行，但不设置 req.user
    next();
  }
}

module.exports = {
  authenticateToken,
  optionalAuth,
};

// 默认导出主要的认证中间件
module.exports.default = authenticateToken;
