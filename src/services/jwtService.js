const jwt = require("jsonwebtoken");
const logger = require("../utils/logger");
const crypto = require("crypto");

class JwtService {
  /**
   * 生成符合老系统格式的 JWT token
   * @param {Object} user 用户信息
   * @returns {string} JWT token
   */
  static generateToken(user) {
    try {
      const now = Math.floor(Date.now());
      const expiresInSec = 7 * 24 * 60 * 60; // 7天过期时间（秒）

      // 符合老系统格式的 payload
      const payload = {
        sub: user.openid, // subject 存储 openid
        created: now, // token 创建时间的时间戳（毫秒）
        exp: Math.floor(now / 1000) + expiresInSec, // token 过期时间的时间戳（秒）
      };

      // 手动创建 JWT
      // 1. 创建只包含 alg 字段的 header
      const header = { alg: "HS512" };

      // 2. Base64Url 编码 header 和 payload
      const encodedHeader = this.base64UrlEncode(JSON.stringify(header));
      const encodedPayload = this.base64UrlEncode(JSON.stringify(payload));

      // 3. 组合数据
      const signatureInput = `${encodedHeader}.${encodedPayload}`;

      // 4. 创建签名
      const signature = this.createSignature(
        signatureInput,
        process.env.JWT_SECRET
      );

      // 5. 组合最终 token
      const token = `${signatureInput}.${signature}`;

      logger.info(`生成 JWT token，使用 HS512 算法，用户: ${user.openid}`);
      return token;
    } catch (error) {
      logger.error("生成 JWT token 失败:", error);
      throw error;
    }
  }

  /**
   * Base64Url 编码
   * @param {string} str 要编码的字符串
   * @returns {string} Base64Url 编码后的字符串
   */
  static base64UrlEncode(str) {
    return Buffer.from(str)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
  }

  /**
   * 创建 HS512 签名
   * @param {string} data 要签名的数据
   * @param {string} secret 密钥
   * @returns {string} Base64Url 编码的签名
   */
  static createSignature(data, secret) {
    const signature = crypto
      .createHmac("sha512", secret)
      .update(data)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
    return signature;
  }

  /**
   * 从请求头解析 token
   * @param {Object} req Express 请求对象
   * @returns {string|null} JWT token 或 null
   */
  static getTokenFromRequest(req) {
    try {
      const authHeader = req.headers["authorization"];
      if (!authHeader) {
        logger.debug("请求头中没有 authorization 字段");
        return null;
      }

      // 支持两种格式: "Bearer <token>" 或直接 "<token>"
      if (authHeader.startsWith("Bearer ")) {
        const token = authHeader.substring(7);
        logger.debug(
          `从请求头解析到 Bearer token: ${token.substring(0, 20)}...`
        );
        return token;
      }

      logger.debug(
        `从请求头解析到直接 token: ${authHeader.substring(0, 20)}...`
      );
      return authHeader;
    } catch (error) {
      logger.error("从请求头解析 token 失败:", error);
      return null;
    }
  }

  /**
   * 验证 JWT token
   * @param {string} token JWT token
   * @returns {Object} 解码后的 payload
   */
  static verifyToken(token) {
    try {
      logger.debug(`开始解析 token: ${token.substring(0, 20)}...`);
      logger.debug("使用 decode 方法解析 token，跳过签名验证");
      // 直接解码 token，不验证签名
      const decoded = jwt.decode(token);
      logger.debug(`Token 解析结果: ${JSON.stringify(decoded)}`);

      // 注释掉 Base64 解码部分，保持 sub 原样
      // if (decoded && decoded.sub && decoded.sub.startsWith("base64_")) {
      //   try {
      //     const originalOpenid = Buffer.from(
      //       decoded.sub.replace("base64_", ""),
      //       "base64"
      //     ).toString();
      //     decoded.sub = originalOpenid;
      //     logger.debug(`解码 Base64 用户名: ${decoded.sub}`);
      //   } catch (decodeErr) {
      //     logger.error(`解码 Base64 用户名失败: ${decodeErr.message}`);
      //     // 如果解码失败，保持原样
      //   }
      // }

      // 检查 token 是否过期
      if (decoded && decoded.exp) {
        const now = Math.floor(Date.now() / 1000);
        if (decoded.exp < now) {
          logger.error(`Token 已过期: exp=${decoded.exp}, now=${now}`);
          const error = new Error("jwt expired");
          error.name = "TokenExpiredError";
          throw error;
        }
        logger.debug(
          `Token 有效: exp=${decoded.exp}, now=${now}, 剩余${
            decoded.exp - now
          }秒`
        );
      }

      return decoded;
    } catch (error) {
      logger.error(`验证 JWT token 失败: ${error.name} - ${error.message}`);
      throw error;
    }
  }
}

module.exports = JwtService;
