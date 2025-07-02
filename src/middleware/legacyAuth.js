const UserAdapterService = require("../services/userAdapterService");
const JwtService = require("../services/jwtService");
const logger = require("../utils/logger");

/**
 * 老系统认证中间件
 * 验证 JWT token 并加载用户
 */
const legacyAuthMiddleware = async (req, res, next) => {
  try {
    const token = JwtService.getTokenFromRequest(req);

    if (!token) {
      return res.status(401).json({
        code: 401,
        message: "未提供认证 token",
        data: null,
      });
    }

    // 验证 token
    try {
      const decoded = JwtService.verifyToken(token);

      // 从 payload 中获取 openid
      const openid = decoded.sub;

      if (!openid) {
        return res.status(401).json({
          code: 401,
          message: "无效的 token",
          data: null,
        });
      }

      // 查找用户
      const user = await UserAdapterService.findUserByOpenid(openid);

      if (!user) {
        return res.status(401).json({
          code: 401,
          message: "用户不存在",
          data: null,
        });
      }

      // 将用户对象挂载到请求上
      req.user = user;

      next();
    } catch (tokenError) {
      if (tokenError.name === "TokenExpiredError") {
        return res.status(401).json({
          code: 401,
          message: "token 已过期",
          data: null,
        });
      }

      return res.status(401).json({
        code: 401,
        message: "无效的 token",
        data: null,
      });
    }
  } catch (error) {
    logger.error("认证中间件错误:", error);
    return res.status(500).json({
      code: 500,
      message: "服务器内部错误",
      data: null,
    });
  }
};

/**
 * 可选身份验证中间件（不强制要求登录）
 * @param {Object} req Express 请求对象
 * @param {Object} res Express 响应对象
 * @param {Function} next Express 下一个中间件函数
 */
async function optionalLegacyAuth(req, res, next) {
  try {
    const token = JwtService.getTokenFromRequest(req);

    if (token) {
      const decoded = JwtService.verifyToken(token);
      const openid = decoded.sub;

      if (openid) {
        const user = await UserAdapterService.findUserByOpenid(openid);
        if (user) {
          req.user = user;
        }
      }
    }

    next();
  } catch (error) {
    // 可选认证失败时继续执行，但不设置 req.user
    next();
  }
}

module.exports = {
  legacyAuthMiddleware,
  optionalLegacyAuth,
};
