const crypto = require("crypto");

/**
 * 微信工具类
 * 提供各种通用工具函数
 */
class WechatUtils {
  /**
   * 生成随机字符串
   * @param {number} length 字符串长度，默认32
   * @returns {string} 随机字符串
   */
  static generateNonceStr(length = 32) {
    return crypto.randomBytes(length / 2).toString("hex");
  }

  /**
   * 生成签名
   * @param {Object} params 参数对象
   * @param {string} apiKey API密钥
   * @returns {string} 签名
   */
  static generateSign(params, apiKey) {
    // 排序参数
    const sortedKeys = Object.keys(params).sort();
    const stringA = sortedKeys
      .filter((key) => params[key] !== "" && params[key] !== undefined)
      .map((key) => `${key}=${params[key]}`)
      .join("&");

    const stringSignTemp = `${stringA}&key=${apiKey}`;
    return crypto
      .createHash("md5")
      .update(stringSignTemp, "utf8")
      .digest("hex")
      .toUpperCase();
  }

  /**
   * 构建XML
   * @param {Object} params 参数对象
   * @returns {string} XML字符串
   */
  static buildXML(params) {
    let xml = "<xml>";
    Object.keys(params).forEach((key) => {
      xml += `<${key}><![CDATA[${params[key]}]]></${key}>`;
    });
    xml += "</xml>";
    return xml;
  }

  /**
   * 解析XML（同步）
   * @param {string} xml XML字符串
   * @returns {Object} 解析后的对象
   */
  static parseXMLSync(xml) {
    const result = {};
    const regex = /<(\w+)><!\[CDATA\[(.*?)\]\]><\/\1>/g;
    let match;

    while ((match = regex.exec(xml)) !== null) {
      result[match[1]] = match[2];
    }

    return result;
  }
}

module.exports = WechatUtils; 