const axios = require("axios");
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

  /**
   * 验证微信支付回调签名（适用于商家转账回调）
   * @param {string} signature 签名值
   * @param {string} timestamp 时间戳
   * @param {string} nonce 随机字符串
   * @param {string} body 请求体
   * @param {string} serialNo 证书序列号
   * @returns {Promise<boolean>} 验证结果
   */
  async verifySignature(signature, timestamp, nonce, body, serialNo) {
    return this.payService.verifySignature(signature, timestamp, nonce, body, serialNo);
  }

  // ===== 物流服务 =====
  
  /**
   * 添加物流信息
   * @param {string} accessToken 接口调用凭证
   * @param {Object} deliveryData 物流数据
   * @returns {Promise<Object>} 添加结果
   */
  async addDeliveryInfo(accessToken, deliveryData) {
    return this.deliveryService.addDeliveryInfo(accessToken, deliveryData);
  }

  /**
   * 获取微信小程序订单状态
   * @param {string} transactionId 微信支付交易ID
   * @returns {Promise<Object>} 订单状态信息
   */
  async getOrderStatus(transactionId) {
    try {
      // 获取访问令牌
      const accessToken = await this.baseService.getAccessToken();
      
      if (!accessToken) {
        throw new Error("无法获取微信访问令牌");
      }

      // 调用微信小程序安全API获取订单状态
      const url = `https://api.weixin.qq.com/wxa/sec/order/get_order?access_token=${accessToken}`;
      
      logger.info(`请求微信订单状态API: ${url}, 交易ID: ${transactionId}`);
      
      const response = await axios.post(url, {
        transaction_id: transactionId
      });
      
      logger.info(`微信订单状态API响应: ${JSON.stringify(response.data)}`);
      
      // 检查API响应
      if (response.data.errcode !== 0) {
        throw new Error(`微信订单状态API错误: ${response.data.errcode}, ${response.data.errmsg}`);
      }
      
      return response.data.order;
    } catch (error) {
      logger.error(`获取微信订单状态失败:`, error);
      
      // 添加更详细的错误信息记录
      if (error.response) {
        logger.error(`微信API响应错误: 状态码 ${error.response.status}`);
        logger.error(`错误详情: ${JSON.stringify(error.response.data)}`);
      }
      
      throw error;
    }
  }

  /**
   * 批量获取订单状态
   * @param {Array<string>} transactionIds 微信支付交易ID数组
   * @returns {Promise<Object>} 订单状态信息映射 {transactionId: orderInfo}
   */
  async batchGetOrderStatus(transactionIds) {
    if (!transactionIds || transactionIds.length === 0) {
      return {};
    }
    
    const results = {};
    const errors = [];
    
    // 并发请求，但限制并发数为5
    const concurrencyLimit = 5;
    const batches = [];
    
    // 将交易ID分组
    for (let i = 0; i < transactionIds.length; i += concurrencyLimit) {
      batches.push(transactionIds.slice(i, i + concurrencyLimit));
    }
    
    // 按批次处理
    for (const batch of batches) {
      const batchPromises = batch.map(async (transactionId) => {
        try {
          const orderInfo = await this.getOrderStatus(transactionId);
          results[transactionId] = orderInfo;
        } catch (error) {
          errors.push({ transactionId, error: error.message });
          logger.error(`获取交易ID ${transactionId} 的订单状态失败:`, error);
        }
      });
      
      // 等待当前批次完成
      await Promise.all(batchPromises);
      
      // 添加小延迟，避免请求过于频繁
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    // 记录处理结果
    logger.info(`批量获取订单状态完成，成功: ${Object.keys(results).length}, 失败: ${errors.length}`);
    if (errors.length > 0) {
      logger.error(`批量获取订单状态错误:`, errors);
    }
    
    return results;
  }
}

// 导出单例
module.exports = new WechatService();