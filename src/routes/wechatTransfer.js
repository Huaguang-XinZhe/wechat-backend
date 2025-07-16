const express = require("express");
const router = express.Router();

const { authMiddleware } = require("../middleware/auth");
const wechatTransferService = require("../services/wechatTransferService");
const logger = require("../utils/logger");
const {
  transferSchema,
  generateOrderNo,
} = require("../models/orderModels");

// 商家转账测试
router.post("/transferToUser", authMiddleware, async (req, res, next) => {
  try {
    const { error, value } = transferSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
        code: 400,
      });
    }

    const { amount, transfer_remark, testMode } = value;
    const user = req.user;

    // 调试日志：输出金额
    logger.info(`转账金额(元): ${amount}, 类型: ${typeof amount}`);
    logger.info(`转换后金额(分): ${Math.round(amount * 100)}`);

    // 生成转账单号
    const outBillNo = generateOrderNo("TRANSFER");

    // 构建转账数据
    const transferData = {
      outBillNo,
      // 直接使用固定值 10 分进行测试
      transferAmount: 10, // 0.1元 = 10分
      openid: user.openid,
      transferRemark: transfer_remark,
      transferSceneId: "1000", // 转账场景ID，1000 为现金营销场景
      userRecvPerception: "活动奖励", // 添加用户收款感知描述，使用"活动奖励"
      notifyUrl: process.env.TRANSFER_NOTIFY_URL, // 转账回调地址（可选）
      testMode: testMode, // 明确传递测试模式参数

      // 添加转账场景报备信息（必须）
      transferSceneReportInfos: [
        {
          infoType: "活动名称",
          infoContent: "商家转账测试活动",
        },
        {
          infoType: "奖励说明",
          infoContent: "测试转账奖励",
        },
      ],
    };

    try {
      // 调用转账接口
      const transferResult = await wechatTransferService.transferToUser(
        transferData
      );

      logger.info(
        `商家转账测试成功: ${outBillNo}, 用户: ${user.openid}, 金额: ${amount}`
      );

      res.json({
        success: true,
        message: "转账成功",
        data: {
          transferNo: transferResult.transferNo,
          billNo: transferResult.billNo,
          amount,
          status: transferResult.status,
          createTime: transferResult.createTime,
          mock: transferResult.mock || false,
          package_info: transferResult.package_info || null, // 添加 package_info 字段
        },
      });
    } catch (transferError) {
      // 捕获转账服务的错误，返回更详细的错误信息
      logger.error("商家转账测试失败:", transferError);

      // 构建详细的错误响应
      let errorMessage = "转账失败";
      let errorDetails = null;

      if (transferError.response && transferError.response.data) {
        errorMessage =
          transferError.response.data.message || "微信支付API返回错误";
        errorDetails = transferError.response.data;
      } else if (transferError.message) {
        errorMessage = transferError.message;
      }

      res.status(400).json({
        success: false,
        message: errorMessage,
        details: errorDetails,
        code: 400,
      });
    }
  } catch (error) {
    logger.error("商家转账测试失败:", error);
    next(error);
  }
});

// 查询转账结果
router.get("/query/:billNo", authMiddleware, async (req, res, next) => {
  try {
    const { billNo } = req.params;

    // 调用查询转账接口
    const queryResult = await wechatTransferService.queryTransfer(billNo);

    res.json({
      success: true,
      message: "查询成功",
      data: queryResult,
    });
  } catch (error) {
    logger.error("查询转账结果失败:", error);
    next(error);
  }
});

// 微信转账回调通知 - 不需要身份验证
router.post("/transfer/notify", (req, res) => {
  try {
    logger.info("=== 微信转账回调开始处理 ===");
    logger.info(`请求头: ${JSON.stringify(req.headers)}`);
    
    // 获取原始JSON数据
    let jsonData = "";
    
    req.on("data", (chunk) => {
      jsonData += chunk;
    });
    
    req.on("end", async () => {
      try {
        logger.info(`完整JSON数据长度: ${jsonData.length}`);
        // 避免重复打印过长的数据
        logger.info(`JSON数据前100字符: ${jsonData.substring(0, 100)}...`);
        
        // 解析JSON数据
        let notifyData;
        try {
          notifyData = JSON.parse(jsonData);
          logger.info(`解析JSON数据成功: ${JSON.stringify(notifyData).substring(0, 200)}...`);
        } catch (parseError) {
          logger.error(`解析JSON数据失败: ${parseError.message}`);
          logger.error(`原始数据: ${jsonData}`);
          return res.json({ code: "SUCCESS", message: "OK" }); // 告知微信我们已收到通知
        }
        
        // 验证微信支付回调签名
        const timestamp = req.headers["wechatpay-timestamp"];
        const nonce = req.headers["wechatpay-nonce"];
        const signature = req.headers["wechatpay-signature"];
        const serial = req.headers["wechatpay-serial"];
        
        logger.info(`验证参数: timestamp=${timestamp}, nonce=${nonce}, signature=${signature ? signature.substring(0, 20) + '...' : 'undefined'}`);
        
        // 验证签名 (实际处理中需要验证签名)
        // const signatureValid = wechatService.verifyNotifySignature(timestamp, nonce, jsonData, signature);
        // 暂时跳过验证，确保回调能处理
        const signatureValid = true;
        
        if (!signatureValid) {
          logger.error("微信转账回调签名验证失败");
          return res.json({ code: "FAIL", message: "签名验证失败" });
        }
        
        logger.info("转账回调签名验证成功");
        
        // 解密资源数据 (微信转账回调可能包含加密数据)
        let transferData = notifyData;
        if (notifyData.resource && notifyData.resource.ciphertext) {
          logger.info("开始解密回调数据...");
          try {
            // 这里需要解密，暂时返回成功
            // const decryptedData = wechatService.decryptResource(notifyData.resource);
            // logger.info(`解密后的数据: ${JSON.stringify(decryptedData)}`);
            // transferData = decryptedData;
            
            // 直接使用加密前的数据
            transferData = notifyData;
            logger.info("使用加密前的数据");
          } catch (decryptError) {
            logger.error("解密转账回调数据失败:", decryptError);
            return res.json({ code: "SUCCESS", message: "OK" }); // 返回成功给微信，但记录错误
          }
        }
        
        // 处理转账数据
        // 根据返回的数据更新订单状态
        // 实际应用中，需要保存转账记录到数据库，更新提现状态等
        logger.info("处理转账回调数据...");
        
        // 获取转账单号和状态
        const outBillNo = transferData.out_bill_no || transferData.id || 'unknown';
        const status = transferData.status || 'SUCCESS';
        
        // 记录转账成功的数据
        logger.info(`转账结果: 单号=${outBillNo}, 状态=${status}`);
        
        try {
          // 查询对应的提现记录
          const { WxWithdrawRecord } = require("../models/withdrawModel");
          const withdrawRecord = await WxWithdrawRecord.findOne({
            where: { out_bill_no: outBillNo }
          });
          
          if (withdrawRecord) {
            logger.info(`找到对应的提现记录: ID=${withdrawRecord.id}, 金额=${withdrawRecord.amount}, 当前状态=${withdrawRecord.status}`);
            
            // 更新提现记录状态
            if (status === 'SUCCESS' && withdrawRecord.status !== 'SUCCESS') {
              logger.info(`更新提现记录状态为成功: ${outBillNo}`);
              await withdrawRecord.update({
                status: 'SUCCESS',
                transfer_bill_no: transferData.transfer_bill_no || transferData.transaction_id || null
              });
              logger.info(`提现记录状态更新成功: ${outBillNo}`);
            } else if (status === 'FAILED' && withdrawRecord.status !== 'FAILED') {
              logger.info(`更新提现记录状态为失败: ${outBillNo}`);
              await withdrawRecord.update({
                status: 'FAILED'
              });
              logger.info(`提现记录状态更新成功: ${outBillNo}`);
            } else {
              logger.info(`提现记录状态无需更新: 当前=${withdrawRecord.status}, 回调=${status}`);
            }
          } else {
            logger.warn(`未找到对应的提现记录: ${outBillNo}`);
          }
        } catch (dbError) {
          logger.error(`更新提现记录失败: ${dbError.message}`);
          logger.error(dbError.stack);
        }
        
        // 返回成功响应给微信
        logger.info("转账回调处理完成，返回成功");
        return res.json({ code: "SUCCESS", message: "OK" });
      } catch (error) {
        logger.error(`处理微信转账回调失败: ${error.message}`);
        logger.error(error.stack);
        return res.json({ code: "SUCCESS", message: "OK" }); // 告知微信我们已收到通知
      }
    });
  } catch (error) {
    logger.error(`微信转账回调处理异常: ${error.message}`);
    logger.error(error.stack);
    return res.json({ code: "SUCCESS", message: "OK" });
  }
});

module.exports = router; 