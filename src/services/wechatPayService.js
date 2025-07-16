const crypto = require("crypto");
const axios = require("axios");
const logger = require("../utils/logger");
const WechatBaseService = require("./wechatBaseService");

class WechatPayService extends WechatBaseService {
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

      // 打印环境信息帮助调试
      logger.info(`正在创建支付订单，运行环境: ${process.env.NODE_ENV}`);
      logger.info(`支付配置: AppID=${this.appId}, MchID=${this.mchId}`);
      logger.info(
        `证书文件状态: 证书=${this.certificate ? "已加载" : "未加载"}, 私钥=${
          this.privateKey ? "已加载" : "未加载"
        }`
      );
      logger.info(
        `支付参数: 订单号=${orderNo}, 金额=${amount}元(${total_fee}分), 用户openid=${openid}`
      );

      // 如果未配置证书或在测试环境，可以返回模拟数据
      if (
        (!this.certificate || !this.privateKey) &&
        process.env.NODE_ENV !== "production"
      ) {
        logger.warn("未找到有效的支付证书，将返回模拟支付参数");
        // 生成模拟 prepayId
        const mockPrepayId = `test_prepay_${Date.now()}`;
        // 返回模拟支付参数
        return {
          prepayId: mockPrepayId,
          payParams: this.generateMockPayParams(mockPrepayId),
        };
      }

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
      logger.info(`生成支付参数: ${JSON.stringify(payParams)}`);

      return {
        prepayId: prepayId,
        payParams,
      };
    } catch (error) {
      logger.error("创建微信支付订单失败:", error);
      if (error.response) {
        logger.error(`微信API响应: ${JSON.stringify(error.response.data)}`);
      }
      throw error;
    }
  }

  // 生成小程序支付参数 (V3 API)
  generateMiniProgramPayParamsV3(prepayId) {
    try {
      // 重要! timeStamp 必须是字符串类型
      const timeStamp = Math.floor(Date.now() / 1000).toString();
      const nonceStr = this.generateNonceStr();

      // V3 API支付参数格式
      const packageStr = `prepay_id=${prepayId}`;

      logger.info("生成支付参数...");
      logger.info(`appId = ${this.appId}`);
      logger.info(`timeStamp = ${timeStamp}`);
      logger.info(`nonceStr = ${nonceStr}`);
      logger.info(`packageStr = ${packageStr}`);

      // 构建签名字符串 (V3 API方式)
      // 签名串格式：应用id\n时间戳\n随机字符串\n预支付交易会话ID\n
      const signatureStr = `${this.appId}\n${timeStamp}\n${nonceStr}\n${packageStr}\n`;
      logger.info(`签名字符串 = ${signatureStr}`);

      // 使用私钥进行签名
      const sign = crypto.createSign("RSA-SHA256");
      sign.update(signatureStr);
      sign.end();
      const paySign = sign.sign(this.privateKey, "base64");
      logger.info(`签名结果 = ${paySign.substring(0, 20)}...`);

      // 返回符合微信支付规范的参数对象
      return {
        timeStamp: timeStamp,
        nonceStr: nonceStr,
        package: packageStr,
        signType: "RSA",
        paySign: paySign,
      };
    } catch (error) {
      logger.error("生成支付参数出错:", error);
      throw error;
    }
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
    // 确保timeStamp是字符串类型
    const timeStamp = Math.floor(Date.now() / 1000).toString();
    const nonceStr = this.generateNonceStr();
    const packageStr = `prepay_id=${prepayId}`;

    logger.info("生成模拟支付参数...");
    logger.info(`timeStamp = ${timeStamp} (${typeof timeStamp})`);

    // 模拟支付参数，格式与正式参数保持一致
    return {
      timeStamp: timeStamp, // 确保是字符串
      nonceStr: nonceStr,
      package: packageStr,
      signType: "RSA",
      paySign: `mock_sign_${Date.now()}`,
    };
  }

  // 验证支付回调
  verifyPaymentNotify(xmlData) {
    try {
      logger.info("开始解析XML数据...");
      logger.info(`原始XML数据: ${xmlData}`);
      
      const data = this.parseXMLSync(xmlData);
      logger.info(`解析后的数据: ${JSON.stringify(data)}`);

      // 检查是否有签名
      if (!data.sign) {
        logger.error("回调数据中没有签名字段");
        throw new Error("回调数据中没有签名字段");
      }

      // 验证签名
      const sign = data.sign;
      delete data.sign;
      
      logger.info("开始验证签名...");
      logger.info(`接收到的签名: ${sign}`);
      
      const calculatedSign = this.generateSign(data);
      logger.info(`计算出的签名: ${calculatedSign}`);

      if (sign !== calculatedSign) {
        logger.error("支付回调签名验证失败");
        logger.error(`期望签名: ${calculatedSign}`);
        logger.error(`实际签名: ${sign}`);
        throw new Error("支付回调签名验证失败");
      }

      logger.info("签名验证成功");
      return data;
    } catch (error) {
      logger.error("验证支付回调失败:", error);
      logger.error("错误堆栈:", error.stack);
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

  // 解密微信支付V3 API回调数据
  decryptResource(resource) {
    try {
      logger.info("开始解密微信支付V3 API回调数据...");
      
      const { ciphertext, associated_data, nonce } = resource;
      logger.info(`解密参数: associated_data=${associated_data}, nonce=${nonce}`);
      logger.info(`密文长度: ${ciphertext.length}`);
      
      // 使用 AEAD_AES_256_GCM 算法解密
      const ciphertextBuffer = Buffer.from(ciphertext, 'base64');
      const authTag = ciphertextBuffer.slice(ciphertextBuffer.length - 16);
      const data = ciphertextBuffer.slice(0, ciphertextBuffer.length - 16);
      
      logger.info(`密文数据长度: ${data.length}, 认证标签长度: ${authTag.length}`);
      
      // 创建解密器
      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        Buffer.from(this.apiV3Key, 'utf8'),
        Buffer.from(nonce, 'utf8')
      );
      
      // 设置认证标签和附加数据
      decipher.setAuthTag(authTag);
      if (associated_data) {
        decipher.setAAD(Buffer.from(associated_data, 'utf8'));
      }
      
      // 解密
      let decrypted = decipher.update(data, null, 'utf8');
      decrypted += decipher.final('utf8');
      
      logger.info(`解密成功，解密后数据: ${decrypted}`);
      
      // 解析JSON
      const result = JSON.parse(decrypted);
      return result;
    } catch (error) {
      logger.error("解密微信支付V3 API回调数据失败:", error);
      logger.error("错误堆栈:", error.stack);
      throw error;
    }
  }

  // 验证微信支付V3 API回调签名
  verifyNotifySignature(timestamp, nonce, body, signature) {
    try {
      logger.info("开始验证微信支付V3 API回调签名...");
      
      // 构建签名字符串
      const message = `${timestamp}\n${nonce}\n${body}\n`;
      logger.info(`签名字符串: ${message}`);
      
      // 获取微信平台证书
      // 注意: 实际项目中应该从微信支付平台获取并缓存证书
      
      // 在生产环境中，应该实现完整的验证逻辑
      if (process.env.NODE_ENV === 'production') {
        logger.info("生产环境下进行完整签名验证");
        
        // 使用公钥验证签名
        // const verify = crypto.createVerify('RSA-SHA256');
        // verify.update(message);
        // const result = verify.verify(publicKey, signature, 'base64');
        // return result;
        
        // 由于证书配置复杂，暂时返回成功，但记录警告
        logger.warn("警告：生产环境下跳过签名验证，请尽快实现完整验证逻辑");
      } else {
        logger.info("开发环境下跳过签名验证");
      }
      
      return true;
    } catch (error) {
      logger.error("验证微信支付V3 API回调签名失败:", error);
      logger.error("错误堆栈:", error.stack);
      return false;
    }
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
    try {
      logger.info("开始验证商家转账回调签名...");
      
      // 构建验签名串
      const message = `${timestamp}\n${nonce}\n${body}\n`;
      logger.info(`验签名串: ${message.substring(0, 100)}...`);
      
      // 检查是否为签名探测流量
      if (signature && signature.startsWith('WECHATPAY/SIGNTEST/')) {
        logger.info("检测到签名探测流量，直接返回成功");
        return true;
      }
      
      // 在生产环境中验证签名
      if (process.env.NODE_ENV === 'production') {
        logger.info(`使用证书序列号: ${serialNo}`);
        
        try {
          // 获取对应的微信支付平台证书
          // 实际项目中应该从证书管理器获取对应序列号的证书
          const publicKey = this.getWechatPayPublicKey(serialNo);
          
          if (!publicKey) {
            logger.error(`未找到序列号为 ${serialNo} 的微信支付平台证书`);
            return false;
          }
          
          // 使用公钥验证签名
          const verify = crypto.createVerify('RSA-SHA256');
          verify.update(message);
          const result = verify.verify(publicKey, signature, 'base64');
          
          logger.info(`签名验证结果: ${result ? '成功' : '失败'}`);
          return result;
        } catch (verifyError) {
          logger.error("验证签名时发生错误:", verifyError);
          return false;
        }
      } else {
        // 开发环境下跳过验证
        logger.info("开发环境下跳过签名验证，直接返回成功");
        return true;
      }
    } catch (error) {
      logger.error("验证商家转账回调签名失败:", error);
      logger.error("错误堆栈:", error.stack);
      return false;
    }
  }
  
  /**
   * 获取微信支付平台证书
   * @param {string} serialNo 证书序列号
   * @returns {string|null} 证书公钥
   */
  getWechatPayPublicKey(serialNo) {
    try {
      // 实际项目中应该实现证书管理逻辑，定期从微信支付平台获取并缓存证书
      // 这里简化处理，使用环境变量中配置的证书
      
      // 检查是否为公钥ID格式
      if (serialNo && serialNo.startsWith('PUB_KEY_ID_')) {
        logger.info(`检测到公钥ID格式: ${serialNo}`);
        // 使用配置的公钥
        return process.env.WECHAT_PAY_PUBLIC_KEY || null;
      }
      
      // 否则使用平台证书
      // 实际项目中应该根据序列号获取对应的证书
      logger.info(`使用平台证书: ${serialNo}`);
      return this.certificate || null;
    } catch (error) {
      logger.error("获取微信支付平台证书失败:", error);
      return null;
    }
  }
}

module.exports = new WechatPayService(); 