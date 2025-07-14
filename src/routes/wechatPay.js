const express = require("express");
const router = express.Router();

const { authMiddleware } = require("../middleware/auth");
const wechatService = require("../services/wechatService");
const logger = require("../utils/logger");
const {
  orders,
  wxMiniPaySchema,
  externalOrderPaySchema,
  generateOrderNo,
  getClientIp,
  users,
} = require("../models/orderModels");
const { legacySequelize } = require("../config/legacyDatabase");

// 微信小程序支付测试
router.post("/wxMiniPay", authMiddleware, async (req, res, next) => {
  try {
    const { error, value } = wxMiniPaySchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
        code: 400,
      });
    }

    const { orderId, amount, total_fee, description } = value;
    const user = req.user;

    // 打印详细调试信息
    logger.info(
      `发起微信支付请求: orderId=${orderId}, amount=${amount}, openid=${user.openid}`
    );

    // 查找订单
    let order = null;
    for (const [orderNo, orderData] of orders.entries()) {
      if (orderData.id == orderId) {
        order = orderData;
        break;
      }
    }

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "订单不存在",
        code: 404,
      });
    }

    if (order.userId !== user.id) {
      return res.status(403).json({
        success: false,
        message: "无权访问此订单",
        code: 403,
      });
    }

    // 获取客户端IP
    const clientIp = getClientIp(req);

    // 创建支付订单数据
    const orderData = {
      orderNo: order.orderNo,
      amount: total_fee || order.amount, // 优先使用 total_fee，如果没有则使用 order.amount
      description: order.goodsName,
      openid: user.openid,
      notifyUrl:
        process.env.PAYMENT_NOTIFY_URL ||
        "https://your-domain.com/api/payment/notify",
      clientIp,
    };

    // 调用微信支付接口
    const paymentResult = await wechatService.createPayOrder(orderData);

    // 更新订单
    order.prepayId = paymentResult.prepayId;
    orders.set(order.orderNo, order);

    logger.info(
      `微信支付测试订单创建成功: ${order.orderNo}, prepayId: ${paymentResult.prepayId}`
    );

    // 记录完整的支付参数以便调试
    logger.info(`生成的支付参数: ${JSON.stringify(paymentResult.payParams)}`);

    res.json({
      success: true,
      message: "获取支付参数成功",
      data: paymentResult.payParams,
    });
  } catch (error) {
    logger.error("微信支付测试失败:", error);
    next(error);
  }
});

// 外部订单微信支付接口（专门处理老后端创建的订单）
router.post("/wxMiniPayExternal", authMiddleware, async (req, res, next) => {
  try {
    const { error, value } = externalOrderPaySchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
        code: 400,
      });
    }

    const { orderId, amount, total_fee, description } = value;
    const user = req.user;
    
    // 获取请求中的token，用于后续支付回调
    const token = req.headers.authorization ? req.headers.authorization.replace('Bearer ', '') : null;
    if (token) {
      logger.info(`获取到用户token: ${token.substring(0, 20)}...`);
      
      // 保存用户token到用户会话
      if (!users.has(user.id)) {
        users.set(user.id, {
          ...user,
          token: token
        });
        logger.info(`保存用户token到会话: userId=${user.id}`);
      } else {
        // 更新现有用户的token
        const existingUser = users.get(user.id);
        users.set(user.id, {
          ...existingUser,
          token: token
        });
        logger.info(`更新用户token: userId=${user.id}`);
      }
    } else {
      logger.warn(`未找到用户token: userId=${user.id}`);
    }

    // 检测是否为调试模式（金额为 0.1 元）
    const isDebugMode = amount === 0.1 || total_fee === 0.1;
    const finalAmount = total_fee || amount;

    // 打印详细调试信息
    logger.info(
      `发起外部订单微信支付请求: orderId=${orderId}, amount=${amount}, total_fee=${total_fee}, finalAmount=${finalAmount}, isDebugMode=${isDebugMode}, description=${description}, openid=${user.openid}`
    );

    // 调试模式特殊提示
    if (isDebugMode) {
      logger.info(`🔧 检测到调试模式支付，金额: ${finalAmount} 元`);
    }

    // 获取客户端IP
    const clientIp = getClientIp(req);

    // 生成内部订单号（用于微信支付）
    const internalOrderNo = generateOrderNo(isDebugMode ? 'DEBUG' : 'EXT');

    // 创建支付订单数据
    const orderData = {
      orderNo: internalOrderNo,
      amount: finalAmount,
      description: description,
      openid: user.openid,
      notifyUrl:
        process.env.PAYMENT_NOTIFY_URL ||
        "https://your-domain.com/api/payment/notify",
      clientIp,
    };

    // 调用微信支付接口
    const paymentResult = await wechatService.createPayOrder(orderData);

    // 记录订单映射关系（外部订单ID -> 内部订单号）
    const externalOrder = {
      externalOrderId: orderId,
      internalOrderNo: internalOrderNo,
      userId: user.id,
      openid: user.openid,
      amount: finalAmount,
      description: description,
      status: "pending",
      prepayId: paymentResult.prepayId,
      clientIp,
      isDebugMode: isDebugMode, // 标记是否为调试模式
      createdAt: new Date(),
    };

    // 保存外部订单映射
    orders.set(internalOrderNo, externalOrder);

    logger.info(
      `外部订单微信支付创建成功: 外部订单=${orderId}, 内部订单=${internalOrderNo}, prepayId: ${paymentResult.prepayId}, 调试模式: ${isDebugMode}`
    );

    // 记录完整的支付参数以便调试
    logger.info(`生成的支付参数: ${JSON.stringify(paymentResult.payParams)}`);

    res.json({
      success: true,
      message: "获取支付参数成功",
      data: {
        ...paymentResult.payParams,
        debugMode: isDebugMode, // 返回调试模式标识
      },
    });
  } catch (error) {
    logger.error("外部订单微信支付失败:", error);
    next(error);
  }
});

// 手动更新外部订单状态接口
router.post("/updateExternalOrderStatus", authMiddleware, async (req, res, next) => {
  try {
    const { orderId, payType = 2 } = req.body;
    const user = req.user;

    logger.info(`手动更新外部订单状态: orderId=${orderId}, payType=${payType}, userId=${user.id}`);

    // 查找对应的外部订单
    let targetOrder = null;
    for (const [internalOrderNo, order] of orders.entries()) {
      if (order.externalOrderId == orderId && order.userId === user.id) {
        targetOrder = order;
        break;
      }
    }

    if (!targetOrder) {
      return res.status(404).json({
        success: false,
        message: "订单不存在或无权限访问",
        code: 404,
      });
    }

    // 更新订单状态
    targetOrder.status = "paid";
    targetOrder.paidAt = new Date();
    orders.set(targetOrder.internalOrderNo, targetOrder);

    logger.info(`外部订单状态更新成功: 外部订单=${orderId}, 内部订单=${targetOrder.internalOrderNo}`);

    res.json({
      success: true,
      message: "订单状态更新成功",
      data: {
        orderId: targetOrder.externalOrderId,
        internalOrderNo: targetOrder.internalOrderNo,
        status: targetOrder.status,
        paidAt: targetOrder.paidAt,
      },
    });
  } catch (error) {
    logger.error("手动更新外部订单状态失败:", error);
    next(error);
  }
});



// 获取微信交易单号 - 用于微信确认收货组件
router.get("/getWxTransactionId/:orderSn", authMiddleware, async (req, res, next) => {
  try {
    const { orderSn } = req.params;
    const user = req.user;

    if (!orderSn) {
      return res.status(400).json({
        success: false,
        message: "订单编号不能为空",
        code: 400,
      });
    }

    logger.info(`获取微信交易单号: orderSn=${orderSn}, userId=${user.id}`);

    // 查询数据库获取交易单号
    try {
      // 查询订单支付信息 - 从 wx_payment_transaction 表获取
      const [orderPayInfo] = await legacySequelize.query(
        `SELECT transaction_id FROM wx_payment_transaction WHERE order_sn = ? LIMIT 1`,
        {
          replacements: [orderSn],
          type: legacySequelize.QueryTypes.SELECT,
        }
      );

      if (!orderPayInfo || !orderPayInfo.transaction_id) {
        logger.warn(`未找到订单 ${orderSn} 的交易单号`);
        return res.status(404).json({
          success: false,
          message: "未找到订单的交易单号",
          code: 404,
        });
      }

      logger.info(`成功获取订单 ${orderSn} 的交易单号: ${orderPayInfo.transaction_id}`);

      // 返回交易单号
      return res.json({
        success: true,
        message: "获取交易单号成功",
        data: {
          transaction_id: orderPayInfo.transaction_id,
        },
      });
    } catch (dbError) {
      logger.error(`查询订单 ${orderSn} 的交易单号失败:`, dbError);
      
      // 如果是测试环境或开发环境，返回模拟的交易单号
      if (process.env.NODE_ENV !== 'production') {
        logger.info(`非生产环境，返回模拟的交易单号`);
        return res.json({
          success: true,
          message: "获取交易单号成功（模拟）",
          data: {
            transaction_id: `4200001234567890${Date.now().toString().slice(-8)}`,
          },
        });
      }
      
      return res.status(500).json({
        success: false,
        message: "查询交易单号失败",
        code: 500,
      });
    }
  } catch (error) {
    logger.error("获取微信交易单号失败:", error);
    next(error);
  }
});

module.exports = router; 