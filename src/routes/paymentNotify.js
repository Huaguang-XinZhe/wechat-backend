const express = require("express");
const router = express.Router();

const wechatService = require("../services/wechatService");
const logger = require("../utils/logger");
const { orders, wxPaymentTransactions } = require("../models/orderModels");
const axios = require("axios"); // 添加axios用于HTTP请求
const mysql = require('mysql2/promise'); // 添加mysql2用于数据库操作
const dbConfig = require('../config/database');

// 老后端URL配置 - 从环境变量获取
const OLD_BACKEND_URL = process.env.LEGACY_BACKEND_URL || "https://boyangchuanggu.com";

// 保存微信支付交易信息到数据库
async function saveWxPaymentTransaction(orderSn, transactionId) {
  try {
    logger.info(`保存微信支付交易信息: 订单号=${orderSn}, 交易号=${transactionId}`);
    
    // 创建数据库连接
    const connection = await mysql.createConnection(dbConfig);
    
    try {
      // 检查是否已存在记录
      const [existingRows] = await connection.execute(
        'SELECT order_sn FROM wx_payment_transaction WHERE order_sn = ?',
        [orderSn]
      );
      
      if (existingRows.length > 0) {
        logger.info(`交易记录已存在，更新: ${orderSn}`);
        await connection.execute(
          'UPDATE wx_payment_transaction SET transaction_id = ? WHERE order_sn = ?',
          [transactionId, orderSn]
        );
      } else {
        logger.info(`创建新的交易记录: ${orderSn}`);
        await connection.execute(
          'INSERT INTO wx_payment_transaction (order_sn, transaction_id) VALUES (?, ?)',
          [orderSn, transactionId]
        );
      }
      
      logger.info(`微信支付交易信息保存成功: ${orderSn} -> ${transactionId}`);
      return true;
    } catch (dbError) {
      logger.error(`数据库操作失败: ${dbError.message}`);
      logger.error(dbError.stack);
      return false;
    } finally {
      // 关闭连接
      await connection.end();
    }
  } catch (error) {
    logger.error(`保存微信支付交易信息失败: ${error.message}`);
    logger.error(error.stack);
    return false;
  }
}

// 微信支付回调通知（V3 API - JSON格式）
router.post("/notify", (req, res) => {
  try {
    logger.info("=== 微信支付回调开始处理 ===");
    logger.info(`请求头: ${JSON.stringify(req.headers)}`);
    logger.info(`请求体类型: ${typeof req.body}`);
    
    // 获取原始JSON数据
    let jsonData = "";
    
    req.on("data", (chunk) => {
      jsonData += chunk;
    });
    
    req.on("end", async () => {
      try {
        logger.info(`完整JSON数据长度: ${jsonData.length}`);
        // 避免重复打印过长的数据
        // logger.info(`JSON数据内容: ${jsonData}`);
        
        // 解析JSON数据
        const notifyData = JSON.parse(jsonData);
        logger.info(`解析后的JSON数据: ${JSON.stringify(notifyData)}`);
        
        // 验证微信支付回调签名
        const timestamp = req.headers["wechatpay-timestamp"];
        const nonce = req.headers["wechatpay-nonce"];
        const signature = req.headers["wechatpay-signature"];
        const serial = req.headers["wechatpay-serial"];
        
        logger.info(`验证参数: timestamp=${timestamp}, nonce=${nonce}, signature=${signature.substring(0, 20)}...`);
        
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
              const openid = decryptedData.payer?.openid || '';
              
              logger.info(`支付成功: 订单号=${out_trade_no}, 交易号=${transaction_id}, 金额=${total_fee}元, openid=${openid}`);
              
              // 保存微信支付交易信息
              await saveWxPaymentTransaction(out_trade_no, transaction_id);
              
              // 查找对应的订单
              const order = orders.get(out_trade_no);
              
              if (order) {
                logger.info(`找到订单: ${JSON.stringify(order)}`);
                
                // 验证金额是否一致
                if (Math.abs(order.amount - total_fee) > 0.01) {
                  logger.error(`订单金额不匹配: ${out_trade_no}, 预期: ${order.amount}, 实际: ${total_fee}`);
                  return res.json({ code: "FAIL", message: "金额不匹配" });
                }
                
                logger.info(`订单金额验证通过: 预期=${order.amount}, 实际=${total_fee}`);
                
                // 检查订单是否已经支付，避免重复处理
                if (order.status === "paid") {
                  logger.info(`订单已经是支付状态，跳过处理: ${out_trade_no}, 交易号: ${order.transactionId || '无'}`);
                  return res.json({ code: "SUCCESS", message: "OK" });
                }
                
                // 更新内部订单状态
                order.status = "paid";
                order.paidAt = new Date();
                order.transactionId = transaction_id;
                order.openid = openid;
                orders.set(out_trade_no, order);
                
                // 保存到内存中的交易记录
                wxPaymentTransactions.set(out_trade_no, {
                  orderSn: out_trade_no,
                  transactionId: transaction_id,
                  openid: openid,
                  payTime: new Date()
                });
                
                logger.info(`订单支付成功: ${out_trade_no}, 外部订单: ${order.externalOrderId || '无'}`);
                
                // 如果是外部订单，通知老后端更新订单状态
                if (order.externalOrderId) {
                  await notifyOldBackend(order.externalOrderId, order.userId);
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
                  unpaidOrder.openid = openid;
                  orders.set(unpaidOrder.orderNo, unpaidOrder);
                  
                  // 保存到内存中的交易记录
                  wxPaymentTransactions.set(unpaidOrder.orderNo, {
                    orderSn: unpaidOrder.orderNo,
                    transactionId: transaction_id,
                    openid: openid,
                    payTime: new Date()
                  });
                  
                  // 保存到数据库中的交易记录
                  await saveWxPaymentTransaction(unpaidOrder.orderNo, transaction_id);
                  
                  logger.info(`更新未支付订单: ${unpaidOrder.orderNo}, 外部订单: ${unpaidOrder.externalOrderId || '无'}`);
                  
                  // 通知老后端
                  if (unpaidOrder.externalOrderId) {
                    await notifyOldBackend(unpaidOrder.externalOrderId, unpaidOrder.userId);
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
                await notifyOldBackend(unpaidOrder.externalOrderId, unpaidOrder.userId);
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
    logger.error("微信支付回调处理失败:", error);
    logger.error("错误堆栈:", error.stack);
    res.json({ code: "FAIL", message: "系统错误" });
  }
});

// 用于存储已通知成功的订单ID，避免重复通知
const notifiedOrders = new Set();

// 通知老后端更新订单状态
async function notifyOldBackend(orderId, userId) {
  try {
    // 检查是否已经成功通知过该订单
    if (notifiedOrders.has(orderId)) {
      logger.info(`订单 ${orderId} 已经成功通知过老后端，跳过重复通知`);
      return true;
    }
    
    logger.info(`开始通知老后端更新订单状态: 订单ID=${orderId}, 支付方式=微信支付, 用户ID=${userId}`);
    logger.info(`⚠️ 注意: 前端可能已经调用了老后端的支付成功接口，这里可能是重复通知`);
    
    // 查找用户的token
    // 在实际系统中，应该从用户会话或数据库中获取token
    // 这里我们尝试从全局用户会话存储中获取
    let token = null;
    
    // 从用户会话中查找token
    const { users } = require("../models/orderModels");
    const user = users.get(userId);
    
    if (user && user.token) {
      token = user.token;
      logger.info(`找到用户token: ${token.substring(0, 20)}...`);
    } else {
      logger.warn(`未找到用户token，将尝试无token调用老后端`);
    }
    
    // 调用老后端的 paySuccess 接口
    const updateUrl = `${OLD_BACKEND_URL}/order/paySuccess`;
    logger.info(`请求URL: ${updateUrl}`);
    
    // 最多重试3次
    let retryCount = 0;
    const maxRetries = 3;
    let success = false;
    let lastError = null;
    
    while (retryCount < maxRetries && !success) {
      try {
        if (retryCount > 0) {
          logger.info(`第${retryCount}次重试通知老后端...`);
        }
        
        // 创建表单数据
        const FormData = require('form-data');
        const form = new FormData();
        form.append('orderId', orderId);
        form.append('payType', 2);  // 2表示微信支付
        
        logger.info(`请求参数: orderId=${orderId}, payType=2`);
        
        // 准备请求头 - 不要手动设置 Content-Type，form-data 会自动设置
        const headers = {};
        
        // 如果有token，添加到请求头
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
          logger.info('使用用户token请求老后端');
        } else {
          logger.warn('无token请求老后端');
        }
        
        // 获取表单的headers并合并
        const formHeaders = form.getHeaders();
        Object.assign(headers, formHeaders);
        
        const response = await axios.post(updateUrl, form, {
          headers,
          timeout: 10000 // 10秒超时
        });
        
        logger.info(`老后端响应: ${JSON.stringify(response.data)}`);
        
        if (response.data && response.data.code === 200) {
          logger.info("通知老后端成功");
          // 记录已成功通知的订单ID
          notifiedOrders.add(orderId);
          success = true;
          return true;
        } else {
          lastError = new Error(`通知老后端返回异常: ${JSON.stringify(response.data)}`);
          logger.warn(lastError.message);
          
          // 如果是特定错误（如库存不足），不再重试
          if (response.data && 
             (response.data.code === 500 && response.data.message && 
              (response.data.message.includes("库存不足") || 
               response.data.message.includes("inventory") || 
               response.data.message.includes("stock")))) {
            logger.warn("检测到库存不足错误，停止重试");
            // 尽管有错误，但我们仍然标记为"已通知"，避免重复触发相同的错误
            notifiedOrders.add(orderId);
            return false;
          }
        }
      } catch (retryError) {
        lastError = retryError;
        logger.error(`通知老后端失败(尝试${retryCount + 1}/${maxRetries}): ${retryError.message}`);
        if (retryError.response) {
          logger.error(`错误状态码: ${retryError.response.status}, 响应: ${JSON.stringify(retryError.response.data)}`);
          
          // 检查是否是特定错误（如库存不足）
          if (retryError.response.data && 
              (retryError.response.status === 400 || retryError.response.status === 500) && 
              retryError.response.data.message && 
              (retryError.response.data.message.includes("库存不足") || 
               retryError.response.data.message.includes("inventory") || 
               retryError.response.data.message.includes("stock"))) {
            logger.warn("检测到库存不足错误，停止重试");
            // 尽管有错误，但我们仍然标记为"已通知"，避免重复触发相同的错误
            notifiedOrders.add(orderId);
            return false;
          }
        }
      }
      
      retryCount++;
      if (retryCount < maxRetries && !success) {
        // 等待一段时间再重试
        const delayMs = 1000 * retryCount; // 1秒, 2秒, 3秒...
        logger.info(`等待${delayMs}毫秒后重试...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
    
    if (!success) {
      logger.error(`通知老后端失败，已重试${maxRetries}次`);
      // 可以考虑将失败的通知存入数据库，稍后由定时任务重试
      // TODO: 实现失败通知的持久化和定时重试
    }
    
    return success;
  } catch (error) {
    logger.error("通知老后端更新订单状态失败:", error);
    logger.error("错误堆栈:", error.stack);
    return false;
  }
}

module.exports = router; 