const axios = require("axios");
const logger = require("../utils/logger");

class LegacyApiService {
  /**
   * 将 openid 转换为 base64 编码
   * @param {string} openid 原始 openid
   * @returns {string} base64 编码后的 openid
   */
  static encodeOpenidToBase64(openid) {
    if (!openid) return openid;
    return Buffer.from(openid).toString("base64");
  }

  /**
   * 向老后端发送登录请求，获取 token
   * @param {string} openid 原始 openid
   * @param {string} password 密码
   * @returns {Promise<Object>} 登录结果，包含 token
   */
  static async login(openid, password) {
    try {
      const legacyApiUrl =
        process.env.LEGACY_API_URL || "https://boyangchuanggu.com";
      const loginUrl = `${legacyApiUrl}/sso/login`;

      // 将 openid 编码为 base64 作为用户名
      const base64Username = this.encodeOpenidToBase64(openid);

      logger.info(
        `向老后端发送登录请求: ${loginUrl}, 原始 openid: ${openid}, base64 用户名: ${base64Username}`
      );

      // 准备表单数据
      const params = new URLSearchParams();
      params.append("username", base64Username); // 使用 base64 编码的 openid
      params.append("password", password);

      // 发送请求
      const response = await axios.post(loginUrl, params, {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      // 检查响应
      if (response.data && response.data.code === 200) {
        logger.info(
          `老后端登录成功，原始 openid: ${openid}, base64 用户名: ${base64Username}`
        );
        return {
          success: true,
          token: response.data.data.token,
          tokenHead: response.data.data.tokenHead,
        };
      } else {
        logger.error(`老后端登录失败: ${JSON.stringify(response.data)}`);
        return {
          success: false,
          message: response.data.message || "登录失败",
        };
      }
    } catch (error) {
      logger.error(`老后端登录请求异常: ${error.message}`);
      return {
        success: false,
        message: `登录请求异常: ${error.message}`,
      };
    }
  }
}

module.exports = LegacyApiService;
