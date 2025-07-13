const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const mysql = require('mysql2/promise');
const { authMiddleware } = require('../middleware/auth');

// 数据库连接配置
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'wechat_miniprogram',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

// 根据用户openid获取微信支付交易信息
router.get('/transaction/:openid', authMiddleware, async (req, res) => {
  try {
    const { openid } = req.params;
    logger.info(`根据用户openid获取微信支付交易信息: ${openid}`);
    
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
router.post('/submit', authMiddleware, async (req, res) => {
  try {
    const { orderSn, transactionId, openid, expressCompany, trackingNo, itemDesc = '订单商品', consignorContact = '138****0000' } = req.body;
    
    if (!transactionId || !openid || !expressCompany || !trackingNo) {
      return res.status(400).json({
        code: 400,
        message: '缺少必要参数'
      });
    }
    
    logger.info(`提交微信物流信息: 订单号=${orderSn}, 交易号=${transactionId}, 物流公司=${expressCompany}, 运单号=${trackingNo}`);
    
    // 创建数据库连接
    const connection = await mysql.createConnection(dbConfig);
    
    // 记录物流信息到数据库
    const [result] = await connection.execute(
      'INSERT INTO wx_delivery_info (order_sn, transaction_id, openid, express_company, tracking_no, item_desc, consignor_contact, status, create_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())',
      [orderSn, transactionId, openid, expressCompany, trackingNo, itemDesc, consignorContact, 'CREATED']
    );
    
    await connection.end();
    
    const deliveryId = result.insertId;
    
    logger.info(`物流信息提交成功: ${orderSn}, ID=${deliveryId}`);
    return res.json({
      code: 200,
      data: {
        delivery_id: deliveryId,
        out_order_no: orderSn,
        express_company: expressCompany,
        tracking_no: trackingNo,
        status: 'CREATED',
        create_time: new Date().toISOString()
      },
      message: '物流信息提交成功'
    });
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