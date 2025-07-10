const express = require("express");
const Joi = require("joi");
const { v4: uuidv4 } = require("uuid");
const router = express.Router();

const { authMiddleware } = require("../middleware/auth");
const wechatService = require("../services/wechatService");
const wechatTransferService = require("../services/wechatTransferService");
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
router.get("/order/:orderNo", authMiddleware, async (req, res, next) => {
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
router.get("/orders", authMiddleware, async (req, res, next) => {
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
router.post("/notify", (req, res) => {
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

// ===== 测试接口 =====

// 创建测试订单验证 schema
const createTestOrderSchema = Joi.object({
  amount: Joi.number().positive().precision(2).default(0.01).messages({
    "number.positive": "金额必须大于0",
  }),
  description: Joi.string().default("支付功能测试订单"),
  testMode: Joi.boolean().default(true),
});

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
    const orderNo = `TEST${Date.now()}${Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, "0")}`;

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

// 微信小程序支付验证 schema
const wxMiniPaySchema = Joi.object({
  orderId: Joi.alternatives().try(Joi.number(), Joi.string()).required(),
  amount: Joi.number().positive().precision(2).default(0.01),
  total_fee: Joi.number().positive().precision(2), // 添加 total_fee 参数
  description: Joi.string().default("微信支付测试"),
});

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
    const clientIp = req.ip || req.connection.remoteAddress || "127.0.0.1";

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

// 商家转账验证 schema
const transferSchema = Joi.object({
  amount: Joi.number().positive().precision(2).default(0.1),
  transfer_remark: Joi.string().default("商家转账测试"),
  testMode: Joi.boolean().default(true),
});

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
    const outBillNo = `TRANSFER${Date.now()}${Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, "0")}`;

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
router.get("/transfer/:billNo", authMiddleware, async (req, res, next) => {
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

// 外部订单微信支付验证 schema（适用于老后端创建的订单）
const externalOrderPaySchema = Joi.object({
  orderId: Joi.alternatives().try(Joi.number(), Joi.string()).required(),
  amount: Joi.number().positive().precision(2).required(),
  total_fee: Joi.number().positive().precision(2).optional(),
  description: Joi.string().required(),
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
    const clientIp = req.ip || req.connection.remoteAddress || "127.0.0.1";

    // 生成内部订单号（用于微信支付）
    const internalOrderNo = `${isDebugMode ? 'DEBUG' : 'EXT'}${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, "0")}`;

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

module.exports = router;
