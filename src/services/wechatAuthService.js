const crypto = require("crypto");
const axios = require("axios");
const logger = require("../utils/logger");
const WechatBaseService = require("./wechatBaseService");

class WechatAuthService extends WechatBaseService {
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
      logger.info(`Node.js 版本: ${process.version}`);
      logger.info(`OpenSSL 版本: ${process.versions.openssl}`);
      logger.info(`平台: ${process.platform}, 架构: ${process.arch}`);
      logger.info(`环境变量: NODE_ENV=${process.env.NODE_ENV}`);

      // 记录输入参数详情
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

      // 设置解密超时保护
      const decryptTimeout = setTimeout(() => {
        logger.error("手机号数据解密操作超时（10秒）");
        throw new Error("解密操作超时，请重试");
      }, 10000); // 10秒超时

      try {
        // Base64 解码
        logger.info("开始 Base64 解码...");
        const sessionKeyBuffer = Buffer.from(sessionKey, "base64");
        logger.info(
          `会话密钥解码后长度(字节): ${
            sessionKeyBuffer.length
          }, 数据(十六进制): ${sessionKeyBuffer.toString("hex")}`
        );

        const encryptedBuffer = Buffer.from(encryptedData, "base64");
        logger.info(
          `加密数据解码后长度(字节): ${
            encryptedBuffer.length
          }, 前10字节(十六进制): ${encryptedBuffer
            .subarray(0, 10)
            .toString("hex")}...`
        );

        const ivBuffer = Buffer.from(iv, "base64");
        logger.info(
          `初始向量解码后长度(字节): ${
            ivBuffer.length
          }, 数据(十六进制): ${ivBuffer.toString("hex")}`
        );

        // 检查密钥长度是否正确
        if (sessionKeyBuffer.length !== 16) {
          clearTimeout(decryptTimeout);
          logger.error(
            `会话密钥长度错误，预期16字节，实际${sessionKeyBuffer.length}字节`
          );
          throw new Error(
            `会话密钥长度错误: ${sessionKeyBuffer.length}字节，应为16字节`
          );
        }

        if (ivBuffer.length !== 16) {
          clearTimeout(decryptTimeout);
          logger.error(
            `初始向量长度错误，预期16字节，实际${ivBuffer.length}字节`
          );
          throw new Error(
            `初始向量长度错误: ${ivBuffer.length}字节，应为16字节`
          );
        }

        // 记录加密算法细节
        logger.info("加密算法细节:");
        logger.info(`- 算法: aes-128-cbc`);
        logger.info(`- 密钥长度: ${sessionKeyBuffer.length * 8}位`);
        logger.info(`- 初始向量长度: ${ivBuffer.length * 8}位`);
        logger.info(`- 填充模式: PKCS#7 (自动填充)`);

        // 列出可用的加密算法
        logger.info(`可用的加密算法: ${crypto.getCiphers().join(", ")}`);

        // AES-128-CBC 解密
        logger.info("创建解密器: aes-128-cbc");
        let decipher;
        try {
          decipher = crypto.createDecipheriv(
            "aes-128-cbc",
            sessionKeyBuffer,
            ivBuffer
          );
          logger.info("解密器创建成功");
        } catch (cipherError) {
          clearTimeout(decryptTimeout);
          logger.error(`创建解密器失败: ${cipherError.message}`);
          logger.error(`错误堆栈: ${cipherError.stack}`);
          throw cipherError;
        }

        decipher.setAutoPadding(true);
        logger.info("设置自动填充: true");

        logger.info("开始解密...");
        let decrypted;
        try {
          decrypted = decipher.update(encryptedBuffer, null, "utf8");
          logger.info(`解密第一阶段完成，获取到 ${decrypted.length} 字符`);

          const finalPart = decipher.final("utf8");
          logger.info(`解密最终阶段完成，获取到额外 ${finalPart.length} 字符`);

          decrypted += finalPart;
        } catch (decryptError) {
          clearTimeout(decryptTimeout);
          logger.error(`解密操作失败: ${decryptError.message}`);
          logger.error(`错误堆栈: ${decryptError.stack}`);

          // 尝试使用不同的编码重新解密
          logger.info("尝试使用二进制模式重新解密...");
          try {
            decipher = crypto.createDecipheriv(
              "aes-128-cbc",
              sessionKeyBuffer,
              ivBuffer
            );
            decipher.setAutoPadding(true);

            const binaryResult = Buffer.concat([
              decipher.update(encryptedBuffer),
              decipher.final(),
            ]);

            logger.info(
              `二进制模式解密成功，结果长度: ${binaryResult.length} 字节`
            );
            logger.info(`尝试将二进制结果转换为 UTF-8...`);

            decrypted = binaryResult.toString("utf8");
            logger.info(`转换成功，获取到 ${decrypted.length} 字符`);
          } catch (retryError) {
            logger.error(`二进制模式解密也失败: ${retryError.message}`);
            throw decryptError; // 抛出原始错误
          }
        }

        logger.info(`解密完成，解密后数据长度: ${decrypted.length}`);
        logger.info(`解密数据前30个字符: ${decrypted.substring(0, 30)}...`);

        // 检查解密结果是否为有效的 JSON 格式
        if (!decrypted.startsWith("{") || !decrypted.endsWith("}")) {
          clearTimeout(decryptTimeout);
          logger.error(
            `解密结果不是有效的 JSON 格式: ${decrypted.substring(0, 100)}...`
          );
        }

        // 解析 JSON
        logger.info("解析 JSON...");
        let phoneData;
        try {
          phoneData = JSON.parse(decrypted);
          logger.info(
            `JSON解析成功，包含字段: ${Object.keys(phoneData).join(", ")}`
          );
          logger.info(`手机号信息: ${JSON.stringify(phoneData, null, 2)}`);
        } catch (jsonError) {
          clearTimeout(decryptTimeout);
          logger.error(`JSON解析失败: ${jsonError.message}`);
          logger.error(`解密后的原始数据: ${decrypted}`);
          throw jsonError;
        }

        // 验证 appId
        if (phoneData.watermark) {
          logger.info(`水印信息: ${JSON.stringify(phoneData.watermark)}`);
          if (phoneData.watermark.appid !== this.appId) {
            clearTimeout(decryptTimeout);
            logger.error(
              `appId 不匹配，期望: ${this.appId}, 实际: ${phoneData.watermark.appid}`
            );
            throw new Error("appId 不匹配，数据可能被篡改");
          }
          logger.info("appId 验证通过");
          logger.info(
            `水印时间戳: ${phoneData.watermark.timestamp}, 对应时间: ${new Date(
              phoneData.watermark.timestamp * 1000
            ).toISOString()}`
          );
        } else {
          logger.warn("解密数据中没有水印信息");
        }

        // 清除超时计时器
        clearTimeout(decryptTimeout);
        
        return phoneData;
      } catch (decryptError) {
        clearTimeout(decryptTimeout);
        logger.error(`解密过程发生错误: ${decryptError.message}`);
        logger.error(`错误堆栈: ${decryptError.stack}`);
        throw decryptError;
      }
    } catch (error) {
      logger.error(`解密手机号数据失败: ${error.message}`);
      logger.error(`错误堆栈: ${error.stack}`);
      throw new Error(`解密手机号数据失败: ${error.message}`);
    }
  }
}

module.exports = new WechatAuthService(); 