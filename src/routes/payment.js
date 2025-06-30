const express = require("express");
const Joi = require("joi");
const { v4: uuidv4 } = require("uuid");
const router = express.Router();

const { authenticateToken } = require("../middleware/auth");
const wechatService = require("../services/wechatService");
const logger = require("../utils/logger");

// 模拟订单和用户模型（因为Order.js创建有问题，这里临时模拟）
const orders = new Map();
const users = new Map();

// 创建支付订单验证 schema
const createOrderSchema = Joi.object({
  goodsId: Joi.string().required().messages({
    "string.empty": "商品ID不能为空",
    "any.required": "商品ID是必需的",
  }),
  goodsName: Joi.string().required().messages({
    "string.empty": "商品名称不能为空",
    "any.required": "商品名称是必需的",
  }),
  amount: Joi.number().positive().precision(2).required().messages({
    "number.positive": "金额必须大于0",
    "any.required": "金额是必需的",
  }),
  remark: Joi.string().allow("").optional(),
});

// 创建支付订单
router.post("/create", authenticateToken, async (req, res, next) => {
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
    const orderNo = `WX${Date.now()}${Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, "0")}`;

    // 获取客户端IP
    const clientIp = req.ip || req.connection.remoteAddress || "127.0.0.1";

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
router.get("/order/:orderNo", authenticateToken, async (req, res, next) => {
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
router.get("/orders", authenticateToken, async (req, res, next) => {
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

// 微信支付回调通知
router.post("/notify", async (req, res, next) => {
  try {
    // 获取原始XML数据
    let xmlData = "";
    req.on("data", (chunk) => {
      xmlData += chunk;
    });

    req.on("end", async () => {
      try {
        logger.info("收到微信支付回调通知");

        // 验证回调数据
        const notifyData = wechatService.verifyPaymentNotify(xmlData);

        if (notifyData.return_code !== "SUCCESS") {
          logger.error("微信支付回调失败:", notifyData.return_msg);
          return res.send(
            "<xml><return_code><![CDATA[FAIL]]></return_code><return_msg><![CDATA[回调处理失败]]></return_msg></xml>"
          );
        }

        if (notifyData.result_code !== "SUCCESS") {
          logger.error(
            "微信支付结果失败:",
            notifyData.err_code,
            notifyData.err_code_des
          );
          return res.send(
            "<xml><return_code><![CDATA[FAIL]]></return_code><return_msg><![CDATA[支付失败]]></return_msg></xml>"
          );
        }

        const orderNo = notifyData.out_trade_no;
        const transactionId = notifyData.transaction_id;
        const totalFee = parseInt(notifyData.total_fee) / 100; // 转换为元

        // 查找订单
        const order = orders.get(orderNo);
        if (!order) {
          logger.error(`订单不存在: ${orderNo}`);
          return res.send(
            "<xml><return_code><![CDATA[FAIL]]></return_code><return_msg><![CDATA[订单不存在]]></return_msg></xml>"
          );
        }

        // 验证金额
        if (Math.abs(order.amount - totalFee) > 0.01) {
          logger.error(
            `订单金额不匹配: ${orderNo}, 预期: ${order.amount}, 实际: ${totalFee}`
          );
          return res.send(
            "<xml><return_code><![CDATA[FAIL]]></return_code><return_msg><![CDATA[金额不匹配]]></return_msg></xml>"
          );
        }

        // 更新订单状态
        if (order.status !== "paid") {
          order.status = "paid";
          order.transactionId = transactionId;
          order.paidAt = new Date();

          orders.set(orderNo, order);

          logger.info(`订单支付成功: ${orderNo}, 交易号: ${transactionId}`);
        }

        // 返回成功响应
        res.send(
          "<xml><return_code><![CDATA[SUCCESS]]></return_code><return_msg><![CDATA[OK]]></return_msg></xml>"
        );
      } catch (error) {
        logger.error("处理微信支付回调失败:", error);
        res.send(
          "<xml><return_code><![CDATA[FAIL]]></return_code><return_msg><![CDATA[处理失败]]></return_msg></xml>"
        );
      }
    });
  } catch (error) {
    logger.error("微信支付回调处理失败:", error);
    res.send(
      "<xml><return_code><![CDATA[FAIL]]></return_code><return_msg><![CDATA[系统错误]]></return_msg></xml>"
    );
  }
});

// 取消订单
router.post("/cancel/:orderNo", authenticateToken, async (req, res, next) => {
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
