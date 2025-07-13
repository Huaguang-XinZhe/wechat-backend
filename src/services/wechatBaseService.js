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

      // 测试DNS解析
      try {
        const dns = require('dns');
        const dnsStart = Date.now();
        logger.info('开始DNS解析: api.weixin.qq.com');
        const addresses = await new Promise((resolve, reject) => {
          dns.resolve4('api.weixin.qq.com', (err, addresses) => {
            if (err) reject(err);
            else resolve(addresses);
          });
        });
        const dnsEnd = Date.now();
        logger.info(`DNS解析完成，耗时: ${dnsEnd - dnsStart}ms, IP地址: ${addresses.join(', ')}`);
      } catch (dnsError) {
        logger.error(`DNS解析失败: ${dnsError.message}`);
      }

      // 直接构建完整URL
      const apiUrl = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${this.appId}&secret=${this.appSecret}`;
      logger.info(`开始获取access_token: ${apiUrl}`);
      
      // 使用原生https模块
      const https = require('https');
      const url = require('url');
      const parsedUrl = url.parse(apiUrl);
      
      const startTime = Date.now();
      logger.info(`开始发送HTTPS请求: ${startTime}`);
      
      // 发送请求
      const data = await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: parsedUrl.hostname,
          path: parsedUrl.path,
          method: 'GET',
          timeout: 10000, // 10秒超时
          headers: {
            'User-Agent': 'Node.js/https',
            'Accept': 'application/json'
          }
        }, (res) => {
          logger.info(`响应状态码: ${res.statusCode}`);
          logger.info(`响应头: ${JSON.stringify(res.headers)}`);
          
          let responseData = '';
          res.on('data', (chunk) => {
            responseData += chunk;
          });
          
          res.on('end', () => {
            const endTime = Date.now();
            logger.info(`请求耗时: ${endTime - startTime}ms`);
            
            try {
              const jsonData = JSON.parse(responseData);
              resolve(jsonData);
            } catch (e) {
              logger.error(`解析JSON失败: ${e.message}`);
              reject(e);
            }
          });
        });
        
        req.on('error', (e) => {
          logger.error(`请求错误: ${e.message}`);
          reject(e);
        });
        
        req.on('timeout', () => {
          logger.error('请求超时');
          req.destroy();
          reject(new Error('请求超时'));
        });
        
        req.end();
      });
      
      logger.info(`微信API响应: ${JSON.stringify(data)}`);

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
      
      // 返回模拟数据
      return `mock_access_token_${Date.now()}`;
    }
  }
}

module.exports = WechatBaseService; 