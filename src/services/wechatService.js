const axios = require("axios");
const crypto = require("crypto");
const fs = require("fs");
const logger = require("../utils/logger");

class WechatService {
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

  // 通过code获取openid和session_key
  async code2Session(code) {
    try {
      // 检查是否为测试环境或未配置真实微信信息
      if (
        !this.appId ||
        this.appId === "your_wechat_app_id" ||
        !this.appSecret ||
        this.appSecret === "your_wechat_app_secret"
      ) {
        logger.info("检测到测试环境，使用模拟微信登录");
        // 返回模拟数据 - 基于 code 生成一致的 openid
        const hash = require("crypto")
          .createHash("md5")
          .update(code)
          .digest("hex");
        return {
          openid: `mock_openid_${hash.substring(0, 16)}`,
          session_key: `mock_session_key_${Date.now()}`,
          unionid: null,
        };
      }

      // 如果是测试 code，直接返回模拟数据，避免调用真实微信接口
      if (code.startsWith("test_")) {
        logger.info("检测到测试 code，使用模拟数据");
        const hash = require("crypto")
          .createHash("md5")
          .update(code)
          .digest("hex");
        return {
          openid: `test_openid_${hash.substring(0, 16)}`,
          session_key: `test_session_key_${Date.now()}`,
          unionid: null,
        };
      }

      const url = `${this.baseURL}/sns/jscode2session`;
      const params = {
        appid: this.appId,
        secret: this.appSecret,
        js_code: code,
        grant_type: "authorization_code",
      };

      const response = await axios.get(url, { params });
      const data = response.data;

      if (data.errcode) {
        throw new Error(`微信接口错误: ${data.errcode} - ${data.errmsg}`);
      }

      return {
        openid: data.openid,
        session_key: data.session_key,
        unionid: data.unionid,
      };
    } catch (error) {
      logger.error("code2Session 失败:", error);
      // 如果是网络错误且在开发环境，提供降级方案
      if (process.env.NODE_ENV === "development") {
        logger.warn("开发环境降级处理，使用模拟数据");
        const hash = require("crypto")
          .createHash("md5")
          .update(code)
          .digest("hex");
        return {
          openid: `fallback_openid_${hash.substring(0, 16)}`,
          session_key: `fallback_session_key_${Date.now()}`,
          unionid: null,
        };
      }
      throw error;
    }
  }

  // 解密手机号数据
  decryptData(sessionKey, encryptedData, iv) {
    try {
      // 添加详细日志
      logger.info(`开始解密手机号数据`);
      logger.info(
        `会话密钥长度: ${sessionKey.length}, 前10位: ${sessionKey.substring(
          0,
          10
        )}...`
      );
      logger.info(
        `加密数据长度: ${
          encryptedData.length
        }, 前10位: ${encryptedData.substring(0, 10)}...`
      );
      logger.info(`初始向量长度: ${iv.length}, 完整内容: ${iv}`);

      // 检查是否为测试环境
      if (
        !this.appId ||
        this.appId === "your_wechat_app_id" ||
        sessionKey.startsWith("mock_") ||
        sessionKey.startsWith("fallback_")
      ) {
        logger.info("检测到测试环境，返回模拟手机号数据");
        return {
          phoneNumber: "13800138000",
          purePhoneNumber: "13800138000",
          countryCode: "86",
          watermark: {
            timestamp: Date.now(),
            appid: this.appId || "mock_app_id",
          },
        };
      }

      // Base64 解码
      try {
        const sessionKeyBuffer = Buffer.from(sessionKey, "base64");
        logger.info(
          `会话密钥解码后长度(字节): ${
            sessionKeyBuffer.length
          }, 数据: ${sessionKeyBuffer.toString("hex")}`
        );

        const encryptedBuffer = Buffer.from(encryptedData, "base64");
        logger.info(`加密数据解码后长度(字节): ${encryptedBuffer.length}`);

        const ivBuffer = Buffer.from(iv, "base64");
        logger.info(
          `初始向量解码后长度(字节): ${
            ivBuffer.length
          }, 数据: ${ivBuffer.toString("hex")}`
        );

        // 检查密钥长度是否正确
        if (sessionKeyBuffer.length !== 16) {
          logger.error(
            `会话密钥长度错误，预期16字节，实际${sessionKeyBuffer.length}字节`
          );
        }

        if (ivBuffer.length !== 16) {
          logger.error(
            `初始向量长度错误，预期16字节，实际${ivBuffer.length}字节`
          );
        }

        // AES-128-CBC 解密
        logger.info("创建解密器: aes-128-cbc");
        const decipher = crypto.createDecipheriv(
          "aes-128-cbc",
          sessionKeyBuffer,
          ivBuffer
        );
        decipher.setAutoPadding(true);
        logger.info("设置自动填充: true");

        logger.info("开始解密...");
        let decrypted = decipher.update(encryptedBuffer, null, "utf8");
        decrypted += decipher.final("utf8");
        logger.info(`解密完成，解密后数据长度: ${decrypted.length}`);
        logger.info(`解密数据前30个字符: ${decrypted.substring(0, 30)}...`);

        // 解析 JSON
        logger.info("解析 JSON...");
        const phoneData = JSON.parse(decrypted);
        logger.info(`JSON解析成功: ${JSON.stringify(phoneData, null, 2)}`);

        // 验证 appId
        if (phoneData.watermark && phoneData.watermark.appid !== this.appId) {
          logger.error(
            `appId 不匹配，期望: ${this.appId}, 实际: ${phoneData.watermark.appid}`
          );
          throw new Error("appId 不匹配，数据可能被篡改");
        }
        logger.info("appId 验证通过");

        return phoneData;
      } catch (decryptError) {
        logger.error(`解密过程发生错误: ${decryptError.message}`);
        logger.error(`错误堆栈: ${decryptError.stack}`);
        throw decryptError;
      }
    } catch (error) {
      logger.error(`解密手机号数据失败: ${error.message}`);
      logger.error(`错误堆栈: ${error.stack}`);
      throw new Error("解密手机号数据失败");
    }
  }

  // 获取access_token
  async getAccessToken() {
    try {
      // 检查缓存
      if (
        this.accessTokenCache.token &&
        Date.now() < this.accessTokenCache.expiresAt
      ) {
        return this.accessTokenCache.token;
      }

      const url = `${this.baseURL}/cgi-bin/token`;
      const params = {
        grant_type: "client_credential",
        appid: this.appId,
        secret: this.appSecret,
      };

      const response = await axios.get(url, { params });
      const data = response.data;

      if (data.errcode) {
        throw new Error(
          `获取access_token失败: ${data.errcode} - ${data.errmsg}`
        );
      }

      // 缓存token（提前5分钟过期）
      this.accessTokenCache = {
        token: data.access_token,
        expiresAt: Date.now() + (data.expires_in - 300) * 1000,
      };

      return data.access_token;
    } catch (error) {
      logger.error("获取access_token失败:", error);
      throw error;
    }
  }

  // 创建微信支付订单
  async createPayOrder(orderData) {
    try {
      const {
        orderNo,
        amount,
        description,
        openid,
        notifyUrl,
        clientIp = "127.0.0.1",
      } = orderData;

      // 检查金额是否有效
      if (typeof amount !== "number" || amount <= 0) {
        throw new Error("支付金额无效，必须为大于0的数字");
      }

      // 确保金额转换为整数分 - 先乘以100再四舍五入，避免浮点数精度问题
      const total_fee = Math.round(amount * 100);

      // 微信支付V3 API地址
      const url = "/v3/pay/transactions/jsapi";
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const nonce = this.generateNonceStr();

      // 构建V3 API请求体
      const requestBody = {
        appid: this.appId,
        mchid: this.mchId,
        description: description,
        out_trade_no: orderNo,
        notify_url: notifyUrl,
        amount: {
          total: total_fee,
          currency: "CNY",
        },
        payer: {
          openid: openid,
        },
        scene_info: {
          payer_client_ip: clientIp,
        },
      };

      const bodyStr = JSON.stringify(requestBody);
      logger.info(`V3支付请求体: ${bodyStr}`);

      // 生成V3 API签名
      const signature = this.generateV3Signature(
        "POST",
        url,
        timestamp,
        nonce,
        bodyStr
      );
      const authorization = `WECHATPAY2-SHA256-RSA2048 mchid="${this.mchId}",nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",serial_no="${process.env.WECHAT_SERIAL_NO}"`;

      logger.info(`Authorization: ${authorization.substring(0, 50)}...`);

      // 调用微信支付V3 API
      const response = await axios.post(
        `${this.payBaseURL}${url}`,
        requestBody,
        {
          headers: {
            Authorization: authorization,
            Accept: "application/json",
            "Content-Type": "application/json",
            "User-Agent": "wechat-backend/1.0.0",
          },
        }
      );

      logger.info(`V3 API响应: ${JSON.stringify(response.data)}`);

      // 提取预支付ID
      const prepayId = response.data.prepay_id;
      if (!prepayId) {
        throw new Error("获取prepay_id失败");
      }

      // 生成小程序支付参数
      const payParams = this.generateMiniProgramPayParamsV3(prepayId);

      return {
        prepayId: prepayId,
        payParams,
      };
    } catch (error) {
      logger.error("创建微信支付订单失败:", error);
      throw error;
    }
  }

  // 生成小程序支付参数 (V3 API)
  generateMiniProgramPayParamsV3(prepayId) {
    const timeStamp = Math.floor(Date.now() / 1000).toString();
    const nonceStr = this.generateNonceStr();

    // V3 API支付参数格式
    const packageStr = `prepay_id=${prepayId}`;

    // 构建签名字符串 (V3 API方式)
    // 签名串格式：应用id\n时间戳\n随机字符串\n预支付交易会话ID\n
    const signatureStr = `${this.appId}\n${timeStamp}\n${nonceStr}\n${packageStr}\n`;

    // 使用私钥进行签名
    const sign = crypto.createSign("RSA-SHA256");
    sign.update(signatureStr);
    sign.end();
    const paySign = sign.sign(this.privateKey, "base64");

    return {
      timeStamp,
      nonceStr,
      package: packageStr,
      signType: "RSA",
      paySign,
    };
  }

  // 生成V3 API签名
  generateV3Signature(method, url, timestamp, nonce, body = "") {
    try {
      // 构建签名字符串
      const signatureStr =
        [method.toUpperCase(), url, timestamp, nonce, body].join("\n") + "\n";

      logger.info(`V3签名字符串: ${signatureStr.substring(0, 100)}...`);

      // 使用私钥进行SHA256withRSA签名
      const sign = crypto.createSign("RSA-SHA256");
      sign.update(signatureStr);
      sign.end();

      const signature = sign.sign(this.privateKey, "base64");
      return signature;
    } catch (error) {
      logger.error("生成V3签名失败:", error);
      throw error;
    }
  }

  // 生成模拟支付参数（测试环境使用）
  generateMockPayParams(prepayId) {
    const timeStamp = Math.floor(Date.now() / 1000).toString();
    const nonceStr = this.generateNonceStr();
    const packageStr = `prepay_id=${prepayId}`;

    return {
      timeStamp,
      nonceStr,
      package: packageStr,
      signType: "MD5",
      paySign: `mock_pay_sign_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`,
    };
  }

  // 验证支付回调
  verifyPaymentNotify(xmlData) {
    try {
      const data = this.parseXMLSync(xmlData);

      // 验证签名
      const sign = data.sign;
      delete data.sign;
      const calculatedSign = this.generateSign(data);

      if (sign !== calculatedSign) {
        throw new Error("支付回调签名验证失败");
      }

      return data;
    } catch (error) {
      logger.error("验证支付回调失败:", error);
      throw error;
    }
  }

  // 生成随机字符串
  generateNonceStr(length = 32) {
    return crypto.randomBytes(length / 2).toString("hex");
  }

  // 生成签名
  generateSign(params) {
    // 排序参数
    const sortedKeys = Object.keys(params).sort();
    const stringA = sortedKeys
      .filter((key) => params[key] !== "" && params[key] !== undefined)
      .map((key) => `${key}=${params[key]}`)
      .join("&");

    const stringSignTemp = `${stringA}&key=${this.apiKey}`;
    return crypto
      .createHash("md5")
      .update(stringSignTemp, "utf8")
      .digest("hex")
      .toUpperCase();
  }

  // 构建XML
  buildXML(params) {
    let xml = "<xml>";
    Object.keys(params).forEach((key) => {
      xml += `<${key}><![CDATA[${params[key]}]]></${key}>`;
    });
    xml += "</xml>";
    return xml;
  }

  // 解析XML（异步）
  async parseXML(xml) {
    // 简单的XML解析，实际项目建议使用xml2js等库
    const result = {};
    const regex = /<(\w+)><!\[CDATA\[(.*?)\]\]><\/\1>/g;
    let match;

    while ((match = regex.exec(xml)) !== null) {
      result[match[1]] = match[2];
    }

    return result;
  }

  // 解析XML（同步）
  parseXMLSync(xml) {
    const result = {};
    const regex = /<(\w+)><!\[CDATA\[(.*?)\]\]><\/\1>/g;
    let match;

    while ((match = regex.exec(xml)) !== null) {
      result[match[1]] = match[2];
    }

    return result;
  }
}

module.exports = new WechatService();
