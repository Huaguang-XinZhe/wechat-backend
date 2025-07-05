const axios = require("axios");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const logger = require("../utils/logger");

class WechatTransferService {
  constructor() {
    this.appId = process.env.WECHAT_APP_ID;
    this.mchId = process.env.WECHAT_MCH_ID;
    this.apiV3Key = process.env.WECHAT_API_V3_KEY; // V3版本需要API v3密钥
    this.serialNo = process.env.WECHAT_SERIAL_NO; // 商户证书序列号

    // 证书路径
    this.certPath = process.env.WECHAT_CERT_PATH;
    this.keyPath = process.env.WECHAT_KEY_PATH;

    // V3 API基础地址
    this.apiBaseURL = "https://api.mch.weixin.qq.com";

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
        logger.warn("微信支付证书文件不存在，将使用测试模式");
      }

      if (this.keyPath && fs.existsSync(this.keyPath)) {
        this.privateKey = fs.readFileSync(this.keyPath, "utf8");
        logger.info("微信支付私钥加载成功");
      } else {
        logger.warn("微信支付私钥文件不存在，将使用测试模式");
      }
    } catch (error) {
      logger.error("加载微信支付证书失败:", error);
    }
  }

  // 生成V3 API签名
  generateV3Signature(method, url, timestamp, nonce, body = "") {
    try {
      // 构建签名字符串
      const signatureStr =
        [method.toUpperCase(), url, timestamp, nonce, body].join("\n") + "\n";

      logger.info(`签名字符串: ${signatureStr}`);

      if (!this.privateKey) {
        // 测试环境返回模拟签名
        return `mock_signature_${Date.now()}_${Math.random()
          .toString(36)
          .substr(2, 9)}`;
      }

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

  // 生成Authorization头
  generateAuthorizationHeader(method, url, timestamp, nonce, body = "") {
    const signature = this.generateV3Signature(
      method,
      url,
      timestamp,
      nonce,
      body
    );

    return `WECHATPAY2-SHA256-RSA2048 mchid="${this.mchId}",nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",serial_no="${this.serialNo}"`;
  }

  // 生成随机字符串
  generateNonce(length = 32) {
    return crypto.randomBytes(length / 2).toString("hex");
  }

  // 商家转账到个人账户
  async transferToUser(transferData) {
    try {
      const {
        outBillNo,
        transferAmount, // 单位：分
        openid,
        userName = "", // 可选，收款人姓名（加密）
        transferRemark = "商家转账",
        transferSceneId = "1000", // 转账场景ID
        transferSceneReportInfos = [], // 添加场景报备信息参数
        notifyUrl,
        testMode = false, // 新增测试模式参数
      } = transferData;

      // 如果明确要求使用测试模式，则直接返回模拟结果
      if (testMode === true) {
        logger.info("前端请求使用测试模式，返回模拟转账结果");
        return this.generateMockTransferResult(outBillNo, transferAmount);
      }

      // 检查是否为测试环境（缺少必要配置）
      if (this.isTestMode()) {
        logger.warn("缺少必要的支付配置，无法进行真实转账");
        throw new Error("系统未配置微信支付证书，无法进行真实转账");
      }

      const url = "/v3/fund-app/mch-transfer/transfer-bills";
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const nonce = this.generateNonce();

      // 构建请求体
      const requestBody = {
        appid: this.appId,
        out_bill_no: outBillNo,
        transfer_scene_id: transferSceneId,
        openid: openid,
        transfer_amount: transferAmount,
        transfer_remark: transferRemark,
      };

      // 如果有收款感知描述，则添加
      if (userRecvPerception) {
        requestBody.user_recv_perception = userRecvPerception;
      }

      // 如果有收款人姓名，需要加密
      if (userName) {
        // 这里需要使用微信支付平台证书加密，暂时跳过
        // requestBody.user_name = this.encryptUserName(userName);
      }

      // 如果有回调地址
      if (notifyUrl) {
        requestBody.notify_url = notifyUrl;
      }

      // 添加场景报告信息
      if (transferSceneReportInfos && transferSceneReportInfos.length > 0) {
        // 将前端传入的场景报备信息转换为微信支付API需要的格式
        requestBody.transfer_scene_report_infos = transferSceneReportInfos.map(
          (info) => ({
            info_type: info.infoType,
            info_content: info.infoContent,
          })
        );
      } else {
        // 添加默认的场景报告信息（如果没有提供）
        requestBody.transfer_scene_report_infos = [
          {
            info_type: "转账用途",
            info_content: transferRemark,
          },
        ];
      }

      const bodyStr = JSON.stringify(requestBody);
      logger.info(`转账请求体: ${bodyStr}`);

      // 生成签名
      const authorization = this.generateAuthorizationHeader(
        "POST",
        url,
        timestamp,
        nonce,
        bodyStr
      );

      // 发送请求
      const response = await axios.post(
        `${this.apiBaseURL}${url}`,
        requestBody,
        {
          headers: {
            Authorization: authorization,
            Accept: "application/json",
            "Content-Type": "application/json",
            "Wechatpay-Serial": this.serialNo,
            "User-Agent": "wechat-backend/1.0.0",
          },
          timeout: 30000,
        }
      );

      logger.info(`转账响应: ${JSON.stringify(response.data)}`);

      return {
        success: true,
        billNo: response.data.out_bill_no,
        transferNo: response.data.transfer_bill_no,
        createTime: response.data.create_time,
        status: "success",
      };
    } catch (error) {
      logger.error("微信转账失败:", error);

      // 添加更详细的错误信息记录
      if (error.response) {
        logger.error(`微信转账API响应错误: 状态码 ${error.response.status}`);
        logger.error(`错误详情: ${JSON.stringify(error.response.data)}`);
      }

      // 如果前端明确要求使用测试模式，则使用模拟结果
      if (transferData.testMode === true) {
        logger.warn("前端请求使用测试模式，返回模拟转账结果");
        return this.generateMockTransferResult(
          transferData.outBillNo,
          transferData.transferAmount
        );
      }

      // 不再自动降级，直接抛出异常
      throw error;
    }
  }

  // 查询转账结果
  async queryTransfer(outBillNo) {
    try {
      // 检查是否为测试环境（缺少必要配置）
      if (this.isTestMode()) {
        logger.warn("缺少必要的支付配置，无法查询真实转账");
        throw new Error("系统未配置微信支付证书，无法查询真实转账");
      }

      const url = `/v3/fund-app/mch-transfer/transfer-bills/out-bill-no/${outBillNo}`;
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const nonce = this.generateNonce();

      // 生成签名
      const authorization = this.generateAuthorizationHeader(
        "GET",
        url,
        timestamp,
        nonce
      );

      // 发送请求
      const response = await axios.get(`${this.apiBaseURL}${url}`, {
        headers: {
          Authorization: authorization,
          Accept: "application/json",
          "Wechatpay-Serial": this.serialNo,
          "User-Agent": "wechat-backend/1.0.0",
        },
        timeout: 30000,
      });

      logger.info(`查询转账响应: ${JSON.stringify(response.data)}`);

      return {
        success: true,
        billNo: response.data.out_bill_no,
        transferNo: response.data.transfer_bill_no,
        status: response.data.status,
        createTime: response.data.create_time,
        finishTime: response.data.finish_time,
        transferAmount: response.data.transfer_amount,
      };
    } catch (error) {
      logger.error("查询转账失败:", error);

      // 不再自动降级，直接抛出异常
      throw error;
    }
  }

  // 检查是否为测试模式
  isTestMode() {
    return (
      !this.privateKey || !this.certificate || !this.mchId || !this.appId
      // 移除了自动进入测试模式的条件
    );
  }

  // 生成模拟转账结果
  generateMockTransferResult(outBillNo, transferAmount) {
    const mockResult = {
      success: true,
      billNo: outBillNo,
      transferNo: `MOCK_TRANSFER_${Date.now()}`,
      createTime: new Date().toISOString(),
      status: "success",
      mock: true,
      amount: transferAmount / 100, // 转换为元
    };

    logger.info(`模拟转账结果: ${JSON.stringify(mockResult)}`);
    return mockResult;
  }

  // 生成模拟查询结果
  generateMockQueryResult(outBillNo) {
    const mockResult = {
      success: true,
      billNo: outBillNo,
      transferNo: `MOCK_TRANSFER_${Date.now()}`,
      status: "success",
      createTime: new Date().toISOString(),
      finishTime: new Date().toISOString(),
      transferAmount: 1, // 1分
      mock: true,
    };

    logger.info(`模拟查询结果: ${JSON.stringify(mockResult)}`);
    return mockResult;
  }

  // 加密用户姓名（需要微信支付平台证书）
  encryptUserName(userName) {
    // TODO: 实现用户姓名加密
    // 需要使用微信支付平台证书进行加密
    logger.warn("用户姓名加密功能暂未实现");
    return userName;
  }
}

module.exports = new WechatTransferService();
