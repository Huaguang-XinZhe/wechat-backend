const express = require("express");
const router = express.Router();

const { authMiddleware } = require("../middleware/auth");
const withdrawService = require("../services/withdrawService");
const logger = require("../utils/logger");
const { withdrawRequestSchema } = require("../models/withdrawModel");
const UserAdapterService = require("../services/userAdapterService");

// 获取提现信息
router.get("/info", authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.id;
    
    // 获取提现信息
    const withdrawInfo = await withdrawService.getWithdrawInfo(userId);
    
    res.json({
      success: true,
      message: "获取提现信息成功",
      data: withdrawInfo
    });
  } catch (error) {
    logger.error("获取提现信息失败:", error);
    next(error);
  }
});

// 预验证提现金额
router.post("/verify", authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.id;
    
    // 获取用户提现信息
    const withdrawInfo = await UserAdapterService.getInviteWithdrawInfo(userId);
    
    // 准备关联订单信息
    const orderInfos = withdrawInfo.confirmedOrders.map(order => {
      const transInfo = withdrawInfo.transactionIds.find(tx => tx.order_sn === order.order_sn);
      return {
        order_sn: order.order_sn,
        order_amount: order.pay_amount,
        transaction_id: transInfo ? transInfo.transaction_id : null
      };
    });
    
    // 调用验证服务
    const verificationResult = await withdrawService.verifyOrdersAndCalculateAmount(
      orderInfos,
      withdrawInfo.commissionRate
    );
    
    // 构建响应
    const response = {
      success: true,
      message: "验证成功",
      data: {
        estimatedAmount: parseFloat(withdrawInfo.availableCommission),
        verifiedAmount: verificationResult.verifiedCommissionAmount,
        verifiedOrderCount: verificationResult.verifiedOrderCount,
        totalOrderCount: orderInfos.length,
        verificationDetails: verificationResult.success ? {
          verifiedOrders: verificationResult.verifiedOrders,
          unverifiedOrders: verificationResult.unverifiedOrders
        } : null
      }
    };
    
    // 如果验证金额与预估金额不同，添加提示信息
    if (verificationResult.success && verificationResult.verifiedCommissionAmount < parseFloat(withdrawInfo.availableCommission)) {
      response.message = `根据微信订单验证，实际可提现金额为¥${verificationResult.verifiedCommissionAmount.toFixed(2)}`;
    }
    
    res.json(response);
  } catch (error) {
    logger.error("预验证提现金额失败:", error);
    res.status(400).json({
      success: false,
      message: error.message || "预验证提现金额失败",
      code: 400,
    });
  }
});

// 申请提现
router.post("/request", authMiddleware, async (req, res, next) => {
  try {
    const { error, value } = withdrawRequestSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
        code: 400,
      });
    }
    
    const user = req.user;
    const { amount, transfer_remark, is_partial } = value;
    
    try {
      // 调用提现服务
      const withdrawResult = await withdrawService.requestWithdraw(user, {
        amount,
        remark: transfer_remark || "邀请好友奖励活动",
        is_partial // 传递部分提现标志，但不会传递给微信API
      });
      
      // 构建响应，包含验证信息
      const response = {
        success: true,
        message: "提现申请已提交",
        data: withdrawResult
      };
      
      // 如果有验证结果，添加更详细的提示
      if (withdrawResult.verification) {
        const { estimatedAmount, verifiedAmount } = withdrawResult.verification;
        if (verifiedAmount < estimatedAmount) {
          response.message = `提现申请已提交，根据微信订单验证，实际可提现金额为¥${verifiedAmount.toFixed(2)}`;
        }
      }
      
      res.json(response);
    } catch (withdrawError) {
      // 捕获提现服务的错误，返回更详细的错误信息
      logger.error("提现申请失败:", withdrawError);
      
      // 构建详细的错误响应
      let errorMessage = "提现失败";
      let errorDetails = null;
      
      if (withdrawError.response && withdrawError.response.data) {
        errorMessage = withdrawError.response.data.message || "微信支付API返回错误";
        errorDetails = withdrawError.response.data;
      } else if (withdrawError.message) {
        errorMessage = withdrawError.message;
      }
      
      res.status(400).json({
        success: false,
        message: errorMessage,
        details: errorDetails,
        code: 400,
      });
    }
  } catch (error) {
    logger.error("提现申请处理失败:", error);
    next(error);
  }
});

// 取消提现申请
router.post("/cancel", authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.id;
    
    // 调用提现服务取消处理中的提现
    const cancelResult = await withdrawService.cancelProcessingWithdraw(userId);
    
    res.json({
      success: true,
      message: "提现申请已取消",
      data: cancelResult
    });
  } catch (error) {
    logger.error("取消提现申请失败:", error);
    res.status(400).json({
      success: false,
      message: error.message || "取消提现申请失败",
      code: 400,
    });
  }
});

// 获取提现记录
router.get("/records", authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { limit = 10, offset = 0 } = req.query;
    
    // 获取提现记录
    const records = await withdrawService.getWithdrawRecords(userId, {
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
    
    res.json({
      success: true,
      message: "获取提现记录成功",
      data: records
    });
  } catch (error) {
    logger.error("获取提现记录失败:", error);
    next(error);
  }
});

module.exports = router; 