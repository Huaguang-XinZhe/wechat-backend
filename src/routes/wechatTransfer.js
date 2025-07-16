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
        // 完整记录回调数据，便于排查问题
        logger.info(`回调原始数据: ${jsonData}`);
        
        // 解析JSON数据
        let notifyData;
        try {
          notifyData = JSON.parse(jsonData);
          logger.info(`解析JSON数据成功: ${JSON.stringify(notifyData)}`);
        } catch (parseError) {
          logger.error(`解析JSON数据失败: ${parseError.message}`);
          return res.json({ code: "SUCCESS", message: "OK" }); // 告知微信我们已收到通知
        }
        
        // 尝试从回调数据中提取转账单号
        let outBillNo = null;
        
        // 在通知数据中寻找可能的单号字段
        if (notifyData.out_bill_no) {
          outBillNo = notifyData.out_bill_no;
        } else if (notifyData.id) {
          outBillNo = notifyData.id; // 使用通知ID作为备选
        }
        
        // 实在找不到单号，查找处理中的提现记录
        if (!outBillNo) {
          logger.info("未从回调数据中找到转账单号，将尝试更新最近的处理中记录");
          
          try {
            // 查询对应的提现记录
            const { WxWithdrawRecord } = require("../models/withdrawModel");
            
            // 查找最近的处理中记录
            const latestRecord = await WxWithdrawRecord.findOne({
              where: { status: 'PROCESSING' },
              order: [['create_time', 'DESC']]
            });
            
            if (latestRecord) {
              logger.info(`找到最近的处理中记录: ID=${latestRecord.id}, 单号=${latestRecord.out_bill_no}`);
              
              // 更新为成功状态（假设回调意味着成功）
              await latestRecord.update({
                status: 'SUCCESS',
                transfer_bill_no: notifyData.transfer_bill_no || notifyData.transaction_id || null
              });
              
              logger.info(`已将最近的处理中记录更新为成功: ${latestRecord.out_bill_no}`);
            } else {
              logger.warn("未找到处理中的提现记录");
            }
          } catch (dbError) {
            logger.error(`数据库操作失败: ${dbError.message}`);
          }
        } else {
          // 找到了单号，尝试更新对应记录
          logger.info(`从回调中提取到转账单号: ${outBillNo}`);
          
          try {
            // 查询对应的提现记录
            const { WxWithdrawRecord } = require("../models/withdrawModel");
            const withdrawRecord = await WxWithdrawRecord.findOne({
              where: { out_bill_no: outBillNo }
            });
            
            if (withdrawRecord) {
              logger.info(`找到对应的提现记录: ID=${withdrawRecord.id}, 状态=${withdrawRecord.status}`);
              
              // 如果记录还是处理中状态，更新为成功
              if (withdrawRecord.status === 'PROCESSING') {
                await withdrawRecord.update({
                  status: 'SUCCESS',
                  transfer_bill_no: notifyData.transfer_bill_no || notifyData.transaction_id || null
                });
                logger.info(`提现记录状态已更新为成功: ${outBillNo}`);
              } else {
                logger.info(`提现记录已经是终态，无需更新: ${withdrawRecord.status}`);
              }
            } else {
              logger.warn(`未找到对应单号的提现记录: ${outBillNo}`);
            }
          } catch (dbError) {
            logger.error(`更新提现记录失败: ${dbError.message}`);
          }
        }
        
        // 返回成功响应给微信
        logger.info("转账回调处理完成，返回成功");
        return res.json({ code: "SUCCESS", message: "OK" });
      } catch (error) {
        logger.error(`处理微信转账回调失败: ${error.message}`);
        // 即使出错也返回成功，避免微信重复回调
        return res.json({ code: "SUCCESS", message: "OK" });
      }
    });
  } catch (error) {
    logger.error(`微信转账回调处理异常: ${error.message}`);
    return res.json({ code: "SUCCESS", message: "OK" });
  }
});

module.exports = router; 