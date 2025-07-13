const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const mysql = require('mysql2/promise');
const dbConfig = require('../config/database');
const wechatDeliveryService = require('../services/wechatDeliveryService');
const auth = require('../middleware/auth');

// 根据用户账号获取微信支付交易信息
router.get('/transaction/:encodedOpenid', auth, async (req, res) => {
  try {
    const { encodedOpenid } = req.params;
    logger.info(`根据用户账号获取微信支付交易信息: ${encodedOpenid}`);
    
    // Base64解码获取openid
    let openid;
    try {
      openid = Buffer.from(encodedOpenid, 'base64').toString('utf-8');
      logger.info(`解码后的openid: ${openid}`);
    } catch (error) {
      logger.error(`解码openid失败: ${error.message}`);
      return res.status(400).json({
        code: 400,
        message: '无效的用户账号编码'
      });
    }
    
    // 创建数据库连接
    const connection = await mysql.createConnection(dbConfig);
    
    // 查询交易信息
    const [rows] = await connection.execute(
      'SELECT * FROM wx_payment_transaction WHERE openid = ? ORDER BY transaction_id DESC LIMIT 1',
      [openid]
    );
    
    await connection.end();
    
    if (rows.length === 0) {
      logger.warn(`未找到用户交易信息: ${openid}`);
      return res.status(404).json({
        code: 404,
        message: '未找到用户交易信息'
      });
    }
    
    logger.info(`成功获取用户交易信息: ${openid}`);
    return res.json({
      code: 200,
      data: rows[0],
      message: '获取成功'
    });
  } catch (error) {
    logger.error(`获取用户交易信息失败: ${error.message}`);
    logger.error(error.stack);
    return res.status(500).json({
      code: 500,
      message: '服务器错误'
    });
  }
});

// 提交微信物流信息
router.post('/submit', auth, async (req, res) => {
  try {
    const { orderSn, transactionId, openid, expressCompany, trackingNo, itemDesc = '订单商品', consignorContact = '138****0000' } = req.body;
    
    if (!transactionId || !openid || !expressCompany || !trackingNo) {
      return res.status(400).json({
        code: 400,
        message: '缺少必要参数'
      });
    }
    
    logger.info(`提交微信物流信息: 订单号=${orderSn}, 交易号=${transactionId}, 物流公司=${expressCompany}, 运单号=${trackingNo}`);
    
    // 调用微信物流服务
    const result = await wechatDeliveryService.uploadShippingInfo({
      transactionId: transactionId,
      orderSn: orderSn,
      expressCompany: expressCompany,
      trackingNo: trackingNo,
      itemDesc: itemDesc,
      consignorContact: consignorContact,
      openid: openid
    });
    
    if (result.success) {
      logger.info(`微信物流信息提交成功: ${orderSn}`);
      return res.json({
        code: 200,
        data: result.data,
        message: '物流信息提交成功'
      });
    } else {
      logger.error(`微信物流信息提交失败: ${result.message}`);
      return res.status(400).json({
        code: 400,
        message: result.message
      });
    }
  } catch (error) {
    logger.error(`提交微信物流信息失败: ${error.message}`);
    logger.error(error.stack);
    return res.status(500).json({
      code: 500,
      message: '服务器错误'
    });
  }
});

module.exports = router; 