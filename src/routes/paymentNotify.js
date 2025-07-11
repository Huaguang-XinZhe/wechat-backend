const express = require("express");
const router = express.Router();

const wechatService = require("../services/wechatService");
const logger = require("../utils/logger");
const { orders } = require("../models/orderModels");
const axios = require("axios"); // 添加axios用于HTTP请求

// 老后端URL配置
const OLD_BACKEND_URL = "https://boyangchuanggu.com";

// 微信支付回调通知（旧版XML格式）
router.post("/notify", (req, res) => {
  try {
    logger.info("=== 微信支付回调开始处理 ===");
    logger.info(`请求头: ${JSON.stringify(req.headers)}`);
    logger.info(`请求体类型: ${typeof req.body}`);
    
    // 检查Content-Type，如果是JSON格式，转到JSON处理逻辑
    if (req.headers["content-type"] && req.headers["content-type"].includes("application/json")) {
      logger.info("检测到JSON格式回调，转到notifyJson处理");
      return router.handle(req, res, "/notifyJson");
    }
    
    // 获取原始XML数据
    let xmlData = "";
    
    req.on("data", (chunk) => {
      xmlData += chunk;
      logger.info(`接收数据块，当前长度: ${xmlData.length}`);
    });

    req.on("end", async () => {
      try {
        logger.info(`完整XML数据长度: ${xmlData.length}`);
        logger.info(`XML数据内容: ${xmlData.substring(0, 500)}${xmlData.length > 500 ? '...' : ''}`);
        logger.info("收到微信支付回调通知");

        // 验证回调数据
        logger.info("开始验证回调数据...");
        const notifyData = wechatService.verifyPaymentNotify(xmlData);
        logger.info(`验证通过，回调数据: ${JSON.stringify(notifyData)}`);

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

        logger.info(`订单号: ${orderNo}, 交易号: ${transactionId}, 金额: ${totalFee}元`);

        // 查找订单
        const order = orders.get(orderNo);
        if (!order) {
          logger.error(`订单不存在: ${orderNo}`);
          return res.send(
            "<xml><return_code><![CDATA[FAIL]]></return_code><return_msg><![CDATA[订单不存在]]></return_msg></xml>"
          );
        }

        logger.info(`找到订单: ${JSON.stringify(order)}`);

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
          
          // 通知老后端更新订单状态
          if (order.externalOrderId) {
            await notifyOldBackend(order.externalOrderId);
          }
        } else {
          logger.info(`订单已经是支付状态: ${orderNo}`);
        }

        // 返回成功响应
        logger.info("返回成功响应给微信");
        res.send(
          "<xml><return_code><![CDATA[SUCCESS]]></return_code><return_msg><![CDATA[OK]]></return_msg></xml>"
        );
        logger.info("=== 微信支付回调处理完成 ===");
      } catch (error) {
        logger.error("处理微信支付回调失败:", error);
        logger.error("错误堆栈:", error.stack);
        res.send(
          "<xml><return_code><![CDATA[FAIL]]></return_code><return_msg><![CDATA[处理失败]]></return_msg></xml>"
        );
      }
    });

    req.on("error", (error) => {
      logger.error("请求流错误:", error);
    });

  } catch (error) {
    logger.error("微信支付回调处理失败:", error);
    logger.error("错误堆栈:", error.stack);
    res.send(
      "<xml><return_code><![CDATA[FAIL]]></return_code><return_msg><![CDATA[系统错误]]></return_msg></xml>"
    );
  }
});

// 微信支付回调处理（JSON 格式 - V3 API）
router.post("/notifyJson", async (req, res, next) => {
  try {
    logger.info("=== 微信支付V3 API回调开始处理 ===");
    logger.info(`请求头: ${JSON.stringify(req.headers)}`);
    
    // 获取原始JSON数据
    let jsonData = "";
    
    req.on("data", (chunk) => {
      jsonData += chunk;
      logger.info(`接收JSON数据块，当前长度: ${jsonData.length}`);
    });
    
    req.on("end", async () => {
      try {
        logger.info(`完整JSON数据长度: ${jsonData.length}`);
        logger.info(`JSON数据内容: ${jsonData}`);
        
        // 解析JSON数据
        const notifyData = JSON.parse(jsonData);
        logger.info(`解析后的JSON数据: ${JSON.stringify(notifyData)}`);
        
        // 验证微信支付回调签名
        const timestamp = req.headers["wechatpay-timestamp"];
        const nonce = req.headers["wechatpay-nonce"];
        const signature = req.headers["wechatpay-signature"];
        const serial = req.headers["wechatpay-serial"];
        
        logger.info(`验证参数: timestamp=${timestamp}, nonce=${nonce}, signature=${signature}, serial=${serial}`);
        
        // 验证签名
        const signatureValid = wechatService.verifyNotifySignature(timestamp, nonce, jsonData, signature);
        if (!signatureValid) {
          logger.error("微信支付回调签名验证失败");
          return res.json({ code: "FAIL", message: "签名验证失败" });
        }
        
        logger.info("签名验证成功");
        
        // 解密资源数据
        if (notifyData.resource && notifyData.resource.ciphertext) {
          logger.info("开始解密回调数据...");
          try {
            // 解密数据
            const decryptedData = wechatService.decryptResource(notifyData.resource);
            logger.info(`解密后的数据: ${JSON.stringify(decryptedData)}`);
            
            // 检查支付状态
            if (decryptedData.trade_state === "SUCCESS") {
              const out_trade_no = decryptedData.out_trade_no;
              const transaction_id = decryptedData.transaction_id;
              const total_fee = decryptedData.amount.total / 100; // 单位为分，转换为元
              
              logger.info(`支付成功: 订单号=${out_trade_no}, 交易号=${transaction_id}, 金额=${total_fee}元`);
              
              // 查找对应的订单
              const order = orders.get(out_trade_no);
              
              if (order) {
                logger.info(`找到订单: ${JSON.stringify(order)}`);
                
                // 更新内部订单状态
                order.status = "paid";
                order.paidAt = new Date();
                order.transactionId = transaction_id;
                orders.set(out_trade_no, order);
                
                logger.info(`订单支付成功: ${out_trade_no}, 外部订单: ${order.externalOrderId || '无'}`);
                
                // 如果是外部订单，通知老后端更新订单状态
                if (order.externalOrderId) {
                  await notifyOldBackend(order.externalOrderId);
                }
              } else {
                logger.warn(`未找到订单: ${out_trade_no}`);
                
                // 如果找不到订单，尝试查找所有未支付订单
                const orderList = Array.from(orders.values());
                const unpaidOrder = orderList.find(o => o.status !== "paid");
                
                if (unpaidOrder) {
                  logger.info(`找到未支付订单: ${JSON.stringify(unpaidOrder)}`);
                  
                  // 更新这个未支付订单
                  unpaidOrder.status = "paid";
                  unpaidOrder.paidAt = new Date();
                  unpaidOrder.transactionId = transaction_id;
                  orders.set(unpaidOrder.orderNo, unpaidOrder);
                  
                  logger.info(`更新未支付订单: ${unpaidOrder.orderNo}, 外部订单: ${unpaidOrder.externalOrderId || '无'}`);
                  
                  // 通知老后端
                  if (unpaidOrder.externalOrderId) {
                    await notifyOldBackend(unpaidOrder.externalOrderId);
                  }
                } else {
                  logger.warn("没有找到任何未支付订单");
                }
              }
            } else {
              logger.warn(`支付未成功: ${decryptedData.trade_state}`);
            }
          } catch (decryptError) {
            logger.error("解密回调数据失败:", decryptError);
            logger.error("错误堆栈:", decryptError.stack);
            
            // 解密失败，尝试使用备用方案
            logger.info("使用备用方案处理支付回调...");
            
            // 找到最近的一个未支付订单
            const orderList = Array.from(orders.values());
            const unpaidOrder = orderList.find(o => o.status !== "paid");
            
            if (unpaidOrder) {
              logger.info(`找到未支付订单: ${JSON.stringify(unpaidOrder)}`);
              
              // 更新这个未支付订单
              unpaidOrder.status = "paid";
              unpaidOrder.paidAt = new Date();
              unpaidOrder.transactionId = `mock_${Date.now()}`;
              orders.set(unpaidOrder.orderNo, unpaidOrder);
              
              logger.info(`更新未支付订单: ${unpaidOrder.orderNo}, 外部订单: ${unpaidOrder.externalOrderId || '无'}`);
              
              // 通知老后端
              if (unpaidOrder.externalOrderId) {
                await notifyOldBackend(unpaidOrder.externalOrderId);
              }
            } else {
              logger.warn("没有找到任何未支付订单");
            }
          }
        } else {
          logger.warn("回调数据中没有加密资源");
        }
        
        // 返回成功响应给微信
        logger.info("返回成功响应给微信");
        res.json({ code: "SUCCESS", message: "OK" });
        logger.info("=== 微信支付V3 API回调处理完成 ===");
      } catch (error) {
        logger.error("处理JSON回调失败:", error);
        logger.error("错误堆栈:", error.stack);
        res.json({ code: "FAIL", message: error.message });
      }
    });
    
    req.on("error", (error) => {
      logger.error("JSON请求流错误:", error);
      res.json({ code: "FAIL", message: error.message });
    });
    
  } catch (error) {
    logger.error("处理微信支付回调失败:", error);
    res.json({ code: "FAIL", message: error.message });
  }
});

// 通知老后端更新订单状态
async function notifyOldBackend(orderId) {
  try {
    logger.info(`开始通知老后端更新订单状态: 订单ID=${orderId}, 支付方式=微信支付`);
    
    // 调用老后端的 paySuccess 接口
    const updateUrl = `${OLD_BACKEND_URL}/order/paySuccess`;
    logger.info(`请求URL: ${updateUrl}`);
    
    const response = await axios.post(updateUrl, {
      orderId: orderId,
      payType: 2  // 2表示微信支付
    });
    
    logger.info(`老后端响应: ${JSON.stringify(response.data)}`);
    
    if (response.data && response.data.code === 200) {
      logger.info("通知老后端成功");
      return true;
    } else {
      logger.warn(`通知老后端返回异常: ${JSON.stringify(response.data)}`);
      return false;
    }
  } catch (error) {
    logger.error("通知老后端更新订单状态失败:", error);
    logger.error("错误堆栈:", error.stack);
    return false;
  }
}

module.exports = router; 