const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const mysql = require('mysql2/promise');
const { authMiddleware } = require('../middleware/auth');

// 使用老系统数据库配置
const dbConfig = {
  host: process.env.LEGACY_DB_HOST || '1.117.227.184',
  port: process.env.LEGACY_DB_PORT || 3306,
  user: process.env.LEGACY_DB_USER || 'root',
  password: process.env.LEGACY_DB_PASSWORD || '59sgYlQuiXoE',
  database: process.env.LEGACY_DB_NAME || 'mall',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

// 根据订单号获取微信支付交易信息
router.get('/transaction/order/:orderSn', authMiddleware, async (req, res) => {
  try {
    const { orderSn } = req.params;
    logger.info(`根据订单号获取微信支付交易信息: ${orderSn}`);
    
    // 创建数据库连接
    const connection = await mysql.createConnection(dbConfig);
    
    // 查询wx_payment_transaction表获取交易信息
    const [transactionRows] = await connection.execute(
      'SELECT * FROM wx_payment_transaction WHERE order_sn = ? LIMIT 1',
      [orderSn]
    );
    
    // 如果找不到交易信息，尝试从订单表获取用户信息
    if (transactionRows.length === 0) {
      // 查询订单表获取用户信息
      const [orderRows] = await connection.execute(
        'SELECT member_username FROM oms_order WHERE order_sn = ? LIMIT 1',
        [orderSn]
      );
      
      await connection.end();
      
      if (orderRows.length === 0) {
        logger.warn(`未找到订单信息: ${orderSn}`);
        return res.status(404).json({
          code: 404,
          message: '未找到订单信息'
        });
      }
      
      // 返回订单信息，但没有交易ID
      logger.info(`找到订单信息，但无交易ID: ${orderSn}`);
      return res.json({
        code: 200,
        data: {
          order_sn: orderSn,
          transaction_id: '',
          openid: orderRows[0].member_username ? atob(orderRows[0].member_username) : ''
        },
        message: '获取成功，但未找到交易ID'
      });
    }
    
    // 查询订单表获取用户信息
    const [orderRows] = await connection.execute(
      'SELECT member_username FROM oms_order WHERE order_sn = ? LIMIT 1',
      [orderSn]
    );
    
    await connection.end();
    
    // 组合数据返回
    const transactionData = transactionRows[0];
    const openid = orderRows.length > 0 && orderRows[0].member_username ? 
      atob(orderRows[0].member_username) : '';
    
    logger.info(`成功获取订单交易信息: ${orderSn}`);
    return res.json({
      code: 200,
      data: {
        order_sn: orderSn,
        transaction_id: transactionData.transaction_id,
        openid: openid
      },
      message: '获取成功'
    });
  } catch (error) {
    logger.error(`获取订单交易信息失败: ${error.message}`);
    logger.error(error.stack);
    return res.status(500).json({
      code: 500,
      message: '服务器错误'
    });
  }
});

// 根据用户openid获取订单和交易信息
router.get('/transaction/user/:openid', authMiddleware, async (req, res) => {
  try {
    const { openid } = req.params;
    logger.info(`根据用户openid获取订单和交易信息: ${openid}`);
    
    // 创建数据库连接
    const connection = await mysql.createConnection(dbConfig);
    
    // 对openid进行base64编码，用于查询oms_order表
    const encodedOpenid = Buffer.from(openid).toString('base64');
    
    // 查询订单表获取订单信息
    const [orderRows] = await connection.execute(
      'SELECT order_sn FROM oms_order WHERE member_username = ? ORDER BY create_time DESC LIMIT 1',
      [encodedOpenid]
    );
    
    if (orderRows.length === 0) {
      await connection.end();
      logger.warn(`未找到用户订单信息: ${openid}`);
      return res.status(404).json({
        code: 404,
        message: '未找到用户订单信息'
      });
    }
    
    const orderSn = orderRows[0].order_sn;
    
    // 查询wx_payment_transaction表获取交易信息
    const [transactionRows] = await connection.execute(
      'SELECT * FROM wx_payment_transaction WHERE order_sn = ? LIMIT 1',
      [orderSn]
    );
    
    await connection.end();
    
    if (transactionRows.length === 0) {
      logger.warn(`未找到订单交易信息: ${orderSn}`);
      return res.json({
        code: 200,
        data: {
          order_sn: orderSn,
          transaction_id: '',
          openid: openid
        },
        message: '获取成功，但未找到交易ID'
      });
    }
    
    logger.info(`成功获取用户订单交易信息: ${openid}, 订单号: ${orderSn}`);
    return res.json({
      code: 200,
      data: {
        order_sn: orderSn,
        transaction_id: transactionRows[0].transaction_id,
        openid: openid
      },
      message: '获取成功'
    });
  } catch (error) {
    logger.error(`获取用户订单交易信息失败: ${error.message}`);
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
    
    // 更新老系统订单的物流信息
    const [result] = await connection.execute(
      'UPDATE oms_order SET delivery_company = ?, delivery_sn = ?, delivery_time = NOW(), status = 2 WHERE order_sn = ?',
      [expressCompany, trackingNo, orderSn]
    );
    
    await connection.end();
    
    if (result.affectedRows === 0) {
      logger.warn(`未找到订单: ${orderSn}`);
      return res.status(404).json({
        code: 404,
        message: '未找到订单'
      });
    }
    
    logger.info(`物流信息提交成功: ${orderSn}`);
    return res.json({
      code: 200,
      data: {
        delivery_id: `WX_${Date.now()}`,
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

// 获取物流轨迹信息
router.get('/logistics/track', authMiddleware, async (req, res) => {
  try {
    const { orderSn } = req.query;
    
    if (!orderSn) {
      return res.status(400).json({
        code: 400,
        message: '缺少订单编号参数'
      });
    }
    
    logger.info(`获取物流轨迹信息: 订单号=${orderSn}`);
    
    // 创建数据库连接
    const connection = await mysql.createConnection(dbConfig);
    
    // 查询订单物流信息
    const [orderRows] = await connection.execute(
      'SELECT delivery_company, delivery_sn FROM oms_order WHERE order_sn = ? LIMIT 1',
      [orderSn]
    );
    
    await connection.end();
    
    if (orderRows.length === 0) {
      logger.warn(`未找到订单物流信息: ${orderSn}`);
      return res.status(404).json({
        code: 404,
        message: '未找到订单物流信息'
      });
    }
    
    const deliveryCompany = orderRows[0].delivery_company;
    const deliverySn = orderRows[0].delivery_sn;
    
    if (!deliveryCompany || !deliverySn) {
      logger.warn(`订单未发货: ${orderSn}`);
      return res.status(400).json({
        code: 400,
        message: '订单未发货'
      });
    }
    
    // 这里应该调用物流查询API获取轨迹，但目前使用模拟数据
    const mockTrackData = {
      deliveryCompany: deliveryCompany,
      deliverySn: deliverySn,
      path_item_list: [
        {
          action_msg: '已签收，签收人为本人',
          action_time: Math.floor(Date.now() / 1000)
        },
        {
          action_msg: '派送中，请保持电话畅通',
          action_time: Math.floor(Date.now() / 1000) - 3600
        },
        {
          action_msg: '快件已到达派送点',
          action_time: Math.floor(Date.now() / 1000) - 7200
        },
        {
          action_msg: '快件在运输中',
          action_time: Math.floor(Date.now() / 1000) - 86400
        },
        {
          action_msg: '快件已被揽收',
          action_time: Math.floor(Date.now() / 1000) - 172800
        }
      ]
    };
    
    logger.info(`成功获取物流轨迹信息: ${orderSn}`);
    return res.json({
      code: 200,
      data: mockTrackData,
      message: '获取成功'
    });
  } catch (error) {
    logger.error(`获取物流轨迹信息失败: ${error.message}`);
    logger.error(error.stack);
    return res.status(500).json({
      code: 500,
      message: '服务器错误'
    });
  }
});

module.exports = router; 