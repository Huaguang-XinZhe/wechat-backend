const express = require("express");
const router = express.Router();

const { authMiddleware } = require("../middleware/auth");
const logger = require("../utils/logger");
const {
  orders,
  createTestOrderSchema,
  generateOrderNo,
} = require("../models/orderModels");

// 创建测试订单
router.post("/createTestOrder", authMiddleware, async (req, res, next) => {
  try {
    const { error, value } = createTestOrderSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
        code: 400,
      });
    }

    const { amount, description, testMode } = value;
    const user = req.user;

    // 生成测试订单号
    const orderNo = generateOrderNo("TEST");

    // 创建测试订单
    const order = {
      id: Date.now(),
      orderNo,
      userId: user.id,
      openid: user.openid,
      goodsId: "test_goods",
      goodsName: description,
      amount,
      status: "pending",
      testMode: true,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30分钟后过期
    };

    orders.set(orderNo, order);

    logger.info(`创建测试订单成功: ${orderNo}, 用户: ${user.openid}`);

    res.json({
      success: true,
      message: "创建测试订单成功",
      data: {
        id: order.id,
        orderSn: orderNo,
        amount,
        description,
        status: order.status,
        createdAt: order.createdAt,
        expiresAt: order.expiresAt,
      },
    });
  } catch (error) {
    logger.error("创建测试订单失败:", error);
    next(error);
  }
});

module.exports = router; 