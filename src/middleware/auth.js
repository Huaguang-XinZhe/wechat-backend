// const User = require("../models/User"); // 数据库版本
const JwtService = require("../services/jwtService");
const UserAdapterService = require("../services/userAdapterService");
const logger = require("../utils/logger");
const jwt = require("jsonwebtoken");

/**
 * 认证中间件
 * 验证 JWT token 并加载用户
 */
const authMiddleware = async (req, res, next) => {
  try {
    const token = JwtService.getTokenFromRequest(req);

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "未提供认证 token",
        code: 401,
      });
    }

    // 验证 token
    try {
      const decoded = JwtService.verifyToken(token);

      // 从 payload 中获取 openid
      const openid = decoded.sub;
      logger.info(`从 JWT 解析的 openid: ${openid}`);

      if (!openid) {
        return res.status(401).json({
          success: false,
          message: "无效的 token",
          code: 401,
        });
      }

      // 特殊处理：如果是admin用户，直接通过认证
      if (openid === 'admin') {
        logger.info('管理员token，跳过用户查找，直接通过认证');
        req.user = {
          openid: 'admin',
          isAdmin: true,
          username: 'admin'
        };
        return next();
      }

      // 查找用户
      logger.info(`准备查找用户，openid: ${openid}`);
      const user = await UserAdapterService.findUserByOpenid(openid);

      if (!user) {
        return res.status(401).json({
          success: false,
          message: "用户不存在",
          code: 401,
        });
      }

      // 将用户对象挂载到请求上
      req.user = user;

      next();
    } catch (tokenError) {
      if (tokenError.name === "TokenExpiredError") {
        return res.status(401).json({
          success: false,
          message: "token 已过期",
          code: 401,
        });
      }

      return res.status(401).json({
        success: false,
        message: "无效的 token",
        code: 401,
      });
    }
  } catch (error) {
    logger.error("认证中间件错误:", error);
    return res.status(500).json({
      success: false,
      message: "服务器内部错误",
      code: 500,
    });
  }
};

/**
 * 可选身份验证中间件（不强制要求登录）
 */
const optionalAuth = async (req, res, next) => {
  try {
    const token = JwtService.getTokenFromRequest(req);

    if (token) {
      try {
        const decoded = JwtService.verifyToken(token);
        const openid = decoded.sub;

        if (openid) {
          // 特殊处理：如果是admin用户，直接通过认证
          if (openid === 'admin') {
            req.user = {
              openid: 'admin',
              isAdmin: true,
              username: 'admin'
            };
          } else {
            const user = await UserAdapterService.findUserByOpenid(openid);
            if (user) {
              req.user = user;
            }
          }
        }
      } catch (error) {
        // 可选认证失败时继续执行，但不设置 req.user
        logger.debug("可选认证失败:", error.message);
      }
    }

    next();
  } catch (error) {
    // 可选认证失败时继续执行，但不设置 req.user
    logger.debug("可选认证处理错误:", error);
    next();
  }
};

/**
 * 不验证签名的认证中间件（仅用于测试）
 * 只解析 token，不验证签名
 */
const noVerifyAuthMiddleware = async (req, res, next) => {
  try {
    const token = JwtService.getTokenFromRequest(req);

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "未提供认证 token",
        code: 401,
      });
    }

    try {
      // 直接解码 token，不验证签名
      const decoded = jwt.decode(token);
      logger.debug(`Token 解析结果: ${JSON.stringify(decoded)}`);

      if (!decoded) {
        return res.status(401).json({
          success: false,
          message: "无法解析 token",
          code: 401,
        });
      }

      // 检查 token 是否过期
      if (decoded.exp) {
        const now = Math.floor(Date.now() / 1000);
        if (decoded.exp < now) {
          return res.status(401).json({
            success: false,
            message: "token 已过期",
            code: 401,
          });
        }
      }

      // 从 payload 中获取 openid
      const openid = decoded.sub;
      logger.debug(`从 token 获取的 openid: ${openid}`);

      if (!openid) {
        return res.status(401).json({
          success: false,
          message: "无效的 token: 没有找到 openid",
          code: 401,
        });
      }

      // 特殊处理：如果是admin用户，直接通过认证
      if (openid === 'admin') {
        logger.debug('管理员token，跳过用户查找，直接通过认证');
        req.user = {
          openid: 'admin',
          isAdmin: true,
          username: 'admin'
        };
        return next();
      }

      // 查找用户
      logger.debug(`开始查找用户: ${openid}`);
      const user = await UserAdapterService.findUserByOpenid(openid);
      logger.debug(`查找用户结果: ${user ? "找到用户" : "用户不存在"}`);

      if (!user) {
        return res.status(401).json({
          success: false,
          message: "用户不存在",
          code: 401,
        });
      }

      // 将用户对象挂载到请求上
      req.user = user;
      next();
    } catch (error) {
      logger.error("Token 解析失败:", error);
      return res.status(401).json({
        success: false,
        message: `无效的 token: ${error.message}`,
        code: 401,
      });
    }
  } catch (error) {
    logger.error("认证中间件错误:", error);
    return res.status(500).json({
      success: false,
      message: "服务器内部错误",
      code: 500,
    });
  }
};

module.exports = {
  authMiddleware,
  optionalAuth,
  noVerifyAuthMiddleware,
};
