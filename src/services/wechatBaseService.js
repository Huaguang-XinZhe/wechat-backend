const axios = require("axios");
const crypto = require("crypto");
const fs = require("fs");
const logger = require("../utils/logger");

class WechatBaseService {
  constructor() {
    this.appId = process.env.WECHAT_APP_ID;
    this.appSecret = process.env.WECHAT_APP_SECRET;
    this.mchId = process.env.WECHAT_MCH_ID;
    this.apiKey = process.env.WECHAT_API_KEY;
    this.apiV3Key = process.env.WECHAT_API_V3_KEY; // V3版本需要API v3密钥
    this.serialNo = process.env.WECHAT_SERIAL_NO; // 商户证书序列号

    // 证书路径
    this.certPath = process.env.WECHAT_CERT_PATH;
    this.keyPath = process.env.WECHAT_KEY_PATH;

    // 微信API基础地址
    this.baseURL = "https://api.weixin.qq.com";
    this.payBaseURL = "https://api.mch.weixin.qq.com";

    // 缓存access_token
    this.accessTokenCache = {
      token: null,
      expiresAt: 0,
    };

    // 加载证书
    this.loadCertificates();
  }

  // 加载证书文件
  loadCertificates() {
    try {
      if (this.certPath && fs.existsSync(this.certPath)) {
        this.certificate = fs.readFileSync(this.certPath, "utf8");
        logger.info("微信支付证书加载成功");
      } else {
        logger.warn("微信支付证书文件不存在，将无法使用支付功能");
      }

      if (this.keyPath && fs.existsSync(this.keyPath)) {
        this.privateKey = fs.readFileSync(this.keyPath, "utf8");
        logger.info("微信支付私钥加载成功，将使用RSA签名");
      } else {
        logger.warn("微信支付私钥文件不存在，将无法使用支付功能");
      }

      // 检查证书和密钥是否都加载成功
      if (this.certificate && this.privateKey) {
        logger.info("微信支付V3 API证书和私钥已准备就绪");
      }
    } catch (error) {
      logger.error("加载微信支付证书失败:", error);
    }
  }

  // 获取access_token
  async getAccessToken() {
    try {
      // 检查环境和配置
      if (!this.appId || this.appId === 'your_wechat_app_id' || !this.appSecret || this.appSecret === 'your_wechat_app_secret') {
        logger.warn('微信配置不完整，返回模拟access_token');
        return `mock_access_token_${Date.now()}`;
      }
      
      // 检查缓存
      if (
        this.accessTokenCache.token &&
        Date.now() < this.accessTokenCache.expiresAt
      ) {
        logger.info(`使用缓存的access_token: ${this.accessTokenCache.token.substring(0, 10)}...`);
        return this.accessTokenCache.token;
      }

      // 直接构建完整URL
      const url = 'https://api.weixin.qq.com/cgi-bin/token';
      const params = {
        grant_type: "client_credential",
        appid: this.appId,
        secret: this.appSecret,
      };

      logger.info(`开始获取access_token: ${url}`);
      logger.info(`请求参数: ${JSON.stringify(params)}`);
      
      // 使用更简洁的请求方式
      const startTime = Date.now();
      const response = await axios.get(url, { 
        params,
        timeout: 10000 // 设置10秒超时
      });
      const endTime = Date.now();
      
      logger.info(`请求耗时: ${endTime - startTime}ms`);
      logger.info(`微信API响应: ${JSON.stringify(response.data)}`);
      const data = response.data;

      if (data.errcode) {
        logger.error(`获取access_token失败: ${data.errcode} - ${data.errmsg}`);
        return `mock_access_token_${Date.now()}`;
      }

      // 缓存token（提前5分钟过期）
      this.accessTokenCache = {
        token: data.access_token,
        expiresAt: Date.now() + (data.expires_in - 300) * 1000,
      };
      
      logger.info(`成功获取access_token: ${data.access_token.substring(0, 10)}...`);
      return data.access_token;
    } catch (error) {
      logger.error(`获取access_token失败: ${error.message || error}`);
      
      if (error.code === 'ECONNABORTED') {
        logger.error('获取access_token请求超时');
      } else if (error.response) {
        logger.error(`HTTP状态码: ${error.response.status}`);
        logger.error(`响应数据: ${JSON.stringify(error.response.data)}`);
      } else if (error.request) {
        logger.error('未收到响应，可能是网络问题');
        logger.error(`请求详情: ${JSON.stringify(error.request._currentUrl || error.request)}`);
      }
      
      // 返回模拟数据
      return `mock_access_token_${Date.now()}`;
    }
  }
}

module.exports = WechatBaseService; 