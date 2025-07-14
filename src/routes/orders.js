const express = require("express");
const router = express.Router();

const { authMiddleware } = require("../middleware/auth");
const wechatService = require("../services/wechatService");
const logger = require("../utils/logger");
const {
  orders,
  createOrderSchema,
  generateOrderNo,
  getClientIp,
} = require("../models/orderModels");
const { legacySequelize } = require("../config/legacyDatabase");

// 创建支付订单
router.post("/create", authMiddleware, async (req, res, next) => {
  try {
    // 验证请求参数
    const { error, value } = createOrderSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
        code: 400,
      });
    }

    const { goodsId, goodsName, amount, remark } = value;
    const user = req.user;

    // 生成订单号
    const orderNo = generateOrderNo("WX");

    // 获取客户端IP
    const clientIp = getClientIp(req);

    // 创建支付订单数据
    const orderData = {
      orderNo,
      amount,
      description: goodsName,
      openid: user.openid,
      notifyUrl:
        process.env.PAYMENT_NOTIFY_URL ||
        "https://your-domain.com/api/payment/notify",
      clientIp,
    };

    // 调用微信支付接口
    const paymentResult = await wechatService.createPayOrder(orderData);

    // 保存订单到数据库（这里模拟保存）
    const order = {
      id: Date.now(),
      orderNo,
      userId: user.id,
      openid: user.openid,
      goodsId,
      goodsName,
      amount,
      status: "pending",
      prepayId: paymentResult.prepayId,
      remark,
      clientIp,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30分钟后过期
    };

    orders.set(orderNo, order);

    logger.info(`创建支付订单成功: ${orderNo}, 用户: ${user.openid}`);

    res.json({
      success: true,
      message: "创建支付订单成功",
      data: {
        orderNo,
        amount,
        goodsName,
        payParams: paymentResult.payParams,
        expiresAt: order.expiresAt,
      },
    });
  } catch (error) {
    logger.error("创建支付订单失败:", error);
    next(error);
  }
});

// 查询订单状态
router.get("/:orderNo", authMiddleware, async (req, res, next) => {
  try {
    const { orderNo } = req.params;
    const user = req.user;

    // 查找订单（这里从模拟数据中查找）
    const order = orders.get(orderNo);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "订单不存在",
        code: 404,
      });
    }

    // 验证订单归属
    if (order.userId !== user.id) {
      return res.status(403).json({
        success: false,
        message: "无权访问此订单",
        code: 403,
      });
    }

    res.json({
      success: true,
      message: "查询成功",
      data: {
        orderNo: order.orderNo,
        goodsName: order.goodsName,
        amount: order.amount,
        status: order.status,
        createdAt: order.createdAt,
        paidAt: order.paidAt,
        expiresAt: order.expiresAt,
      },
    });
  } catch (error) {
    logger.error("查询订单失败:", error);
    next(error);
  }
});

// 获取用户订单列表
router.get("/", authMiddleware, async (req, res, next) => {
  try {
    const user = req.user;
    const { page = 1, limit = 10, status } = req.query;

    // 从模拟数据中筛选用户订单
    let userOrders = Array.from(orders.values()).filter(
      (order) => order.userId === user.id
    );

    if (status) {
      userOrders = userOrders.filter((order) => order.status === status);
    }

    // 排序
    userOrders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // 分页
    const offset = (page - 1) * limit;
    const paginatedOrders = userOrders.slice(offset, offset + parseInt(limit));

    res.json({
      success: true,
      message: "查询成功",
      data: {
        orders: paginatedOrders.map((order) => ({
          orderNo: order.orderNo,
          goodsName: order.goodsName,
          amount: order.amount,
          status: order.status,
          createdAt: order.createdAt,
          paidAt: order.paidAt,
        })),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: userOrders.length,
          pages: Math.ceil(userOrders.length / limit),
        },
      },
    });
  } catch (error) {
    logger.error("查询订单列表失败:", error);
    next(error);
  }
});

// 取消订单
router.post("/cancel/:orderNo", authMiddleware, async (req, res, next) => {
  try {
    const { orderNo } = req.params;
    const user = req.user;

    const order = orders.get(orderNo);

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
        message: "无权操作此订单",
        code: 403,
      });
    }

    if (order.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: "订单状态不允许取消",
        code: 400,
      });
    }

    // 更新订单状态
    order.status = "cancelled";
    order.cancelledAt = new Date();
    orders.set(orderNo, order);

    logger.info(`订单取消成功: ${orderNo}`);

    res.json({
      success: true,
      message: "订单取消成功",
      data: {
        orderNo,
        status: order.status,
        cancelledAt: order.cancelledAt,
      },
    });
  } catch (error) {
    logger.error("取消订单失败:", error);
    next(error);
  }
});

module.exports = router; 