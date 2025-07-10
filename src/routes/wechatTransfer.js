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

module.exports = router; 