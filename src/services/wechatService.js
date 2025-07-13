const logger = require("../utils/logger");
const WechatBaseService = require("./wechatBaseService");
const wechatAuthService = require("./wechatAuthService");
const wechatPayService = require("./wechatPayService");
const wechatDeliveryService = require("./wechatDeliveryService");
const WechatUtils = require("./wechatUtils");

/**
 * 微信服务主类
 * 整合所有微信相关服务
 */
class WechatService {
  constructor() {
    // 初始化各个服务
    this.baseService = new WechatBaseService();
    this.authService = wechatAuthService;
    this.payService = wechatPayService;
    this.deliveryService = wechatDeliveryService;
    this.utils = WechatUtils;

    logger.info("微信服务已初始化");
  }

  // ===== 基础服务 =====
  
  /**
   * 获取access_token
   * @returns {Promise<string>} access_token
   */
  async getAccessToken() {
    return this.authService.getAccessToken();
  }

  // ===== 认证服务 =====
  
  /**
   * 通过code获取openid和session_key
   * @param {string} code 小程序登录code
   * @returns {Promise<Object>} 包含openid和session_key的对象
   */
  async code2Session(code) {
    return this.authService.code2Session(code);
  }

  /**
   * 解密手机号数据
   * @param {string} sessionKey 会话密钥
   * @param {string} encryptedData 加密数据
   * @param {string} iv 初始向量
   * @returns {Promise<Object>} 解密后的手机号数据
   */
  decryptData(sessionKey, encryptedData, iv) {
    return this.authService.decryptData(sessionKey, encryptedData, iv);
  }

  // ===== 支付服务 =====
  
  /**
   * 创建微信支付订单
   * @param {Object} orderData 订单数据
   * @returns {Promise<Object>} 支付参数
   */
  async createPayOrder(orderData) {
    return this.payService.createPayOrder(orderData);
  }

  /**
   * 验证支付回调
   * @param {string} xmlData 微信支付回调XML数据
   * @returns {Object} 验证后的数据
   */
  verifyPaymentNotify(xmlData) {
    return this.payService.verifyPaymentNotify(xmlData);
  }

  /**
   * 解密微信支付V3 API回调数据
   * @param {Object} resource 资源对象
   * @returns {Object} 解密后的数据
   */
  decryptResource(resource) {
    return this.payService.decryptResource(resource);
  }

  /**
   * 验证微信支付V3 API回调签名
   * @param {string} timestamp 时间戳
   * @param {string} nonce 随机字符串
   * @param {string} body 请求体
   * @param {string} signature 签名
   * @returns {boolean} 验证结果
   */
  verifyNotifySignature(timestamp, nonce, body, signature) {
    return this.payService.verifyNotifySignature(timestamp, nonce, body, signature);
  }

  // ===== 物流服务 =====
  
  /**
   * 获取微信支持的物流公司列表
   * @param {string} accessToken 接口调用凭证
   * @returns {Promise<Object>} 物流公司列表
   */
  async getDeliveryCompanies(accessToken) {
    return this.deliveryService.getDeliveryCompanies(accessToken);
  }

  /**
   * 添加物流信息
   * @param {string} accessToken 接口调用凭证
   * @param {Object} deliveryData 物流数据
   * @returns {Promise<Object>} 添加结果
   */
  async addDeliveryInfo(accessToken, deliveryData) {
    return this.deliveryService.addDeliveryInfo(accessToken, deliveryData);
  }
}

// 导出单例
module.exports = new WechatService();