const axios = require("axios");
const crypto = require("crypto");
const logger = require("../utils/logger");

class WechatService {
  constructor() {
    this.appId = process.env.WECHAT_APP_ID;
    this.appSecret = process.env.WECHAT_APP_SECRET;
    this.mchId = process.env.WECHAT_MCH_ID;
    this.apiKey = process.env.WECHAT_API_KEY;

    // 微信API基础地址
    this.baseURL = "https://api.weixin.qq.com";
    this.payBaseURL = "https://api.mch.weixin.qq.com";

    // 缓存access_token
    this.accessTokenCache = {
      token: null,
      expiresAt: 0,
    };
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

      // 检查是否为测试环境或未配置真实支付信息
      if (
        !this.mchId ||
        this.mchId === "your_merchant_id" ||
        !this.apiKey ||
        this.apiKey === "your_api_key"
      ) {
        logger.info("检测到测试环境，使用模拟支付订单");

        const mockPrepayId = `mock_prepay_id_${Date.now()}_${Math.random()
          .toString(36)
          .substr(2, 9)}`;
        const payParams = this.generateMockPayParams(mockPrepayId);

        return {
          prepayId: mockPrepayId,
          payParams,
        };
      }

      // 构建支付参数
      const params = {
        appid: this.appId,
        mch_id: this.mchId,
        nonce_str: this.generateNonceStr(),
        body: description,
        out_trade_no: orderNo,
        total_fee: Math.round(amount * 100), // 转换为分
        spbill_create_ip: clientIp,
        notify_url: notifyUrl,
        trade_type: "JSAPI",
        openid: openid,
      };

      // 生成签名
      params.sign = this.generateSign(params);

      // 构建XML
      const xml = this.buildXML(params);

      // 调用统一下单接口
      const response = await axios.post(
        `${this.payBaseURL}/pay/unifiedorder`,
        xml,
        {
          headers: {
            "Content-Type": "application/xml",
          },
        }
      );

      // 解析返回结果
      const result = await this.parseXML(response.data);

      if (result.return_code !== "SUCCESS") {
        throw new Error(`微信支付接口调用失败: ${result.return_msg}`);
      }

      if (result.result_code !== "SUCCESS") {
        throw new Error(
          `创建支付订单失败: ${result.err_code} - ${result.err_code_des}`
        );
      }

      // 生成小程序支付参数
      const payParams = this.generateMiniProgramPayParams(result.prepay_id);

      return {
        prepayId: result.prepay_id,
        payParams,
      };
    } catch (error) {
      logger.error("创建微信支付订单失败:", error);

      // 开发环境降级处理
      if (process.env.NODE_ENV === "development") {
        logger.warn("开发环境降级处理，使用模拟支付参数");
        const mockPrepayId = `fallback_prepay_id_${Date.now()}_${Math.random()
          .toString(36)
          .substr(2, 9)}`;
        const payParams = this.generateMockPayParams(mockPrepayId);

        return {
          prepayId: mockPrepayId,
          payParams,
        };
      }

      throw error;
    }
  }

  // 生成小程序支付参数
  generateMiniProgramPayParams(prepayId) {
    const timeStamp = Math.floor(Date.now() / 1000).toString();
    const nonceStr = this.generateNonceStr();
    const packageStr = `prepay_id=${prepayId}`;

    const params = {
      appId: this.appId,
      timeStamp,
      nonceStr,
      package: packageStr,
      signType: "MD5",
    };

    // 生成支付签名
    const paySign = this.generateSign(params);

    return {
      timeStamp,
      nonceStr,
      package: packageStr,
      signType: "MD5",
      paySign,
    };
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
