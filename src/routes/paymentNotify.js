const express = require("express");
const router = express.Router();

const wechatService = require("../services/wechatService");
const logger = require("../utils/logger");
const { orders } = require("../models/orderModels");

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

// 微信支付回调处理（JSON 格式）
router.post("/notifyJson", async (req, res, next) => {
  try {
    logger.info("收到微信支付回调:", req.body);

    // 验证微信支付回调（这里简化处理，实际应该验证签名）
    const { out_trade_no, trade_state, transaction_id } = req.body;

    if (trade_state === "SUCCESS") {
      // 查找对应的订单
      const order = orders.get(out_trade_no);
      
      if (order) {
        // 更新内部订单状态
        order.status = "paid";
        order.paidAt = new Date();
        order.transactionId = transaction_id;
        orders.set(out_trade_no, order);

        logger.info(`订单支付成功: ${out_trade_no}, 外部订单: ${order.externalOrderId}`);

        // 如果是外部订单，需要通知老后端更新订单状态
        if (order.externalOrderId) {
          try {
            // 这里应该调用老后端的API来更新订单状态
            // 由于跨服务调用，这里先记录日志，实际项目中可以使用 HTTP 请求
            logger.info(`需要通知老后端更新订单状态: 订单ID=${order.externalOrderId}, 支付方式=微信支付`);
            
            // TODO: 调用老后端的 paySuccess 接口
            // 可以使用 axios 或其他 HTTP 客户端
            /*
            const updateResult = await axios.post(`${OLD_BACKEND_URL}/order/paySuccess`, {
              orderId: order.externalOrderId,
              payType: 2
            });
            */
            
          } catch (updateError) {
            logger.error("通知老后端更新订单状态失败:", updateError);
          }
        }
      } else {
        logger.warn(`未找到订单: ${out_trade_no}`);
      }
    }

    // 返回成功响应给微信
    res.json({ code: "SUCCESS", message: "OK" });
  } catch (error) {
    logger.error("处理微信支付回调失败:", error);
    res.json({ code: "FAIL", message: error.message });
  }
});

module.exports = router; 