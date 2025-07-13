const express = require('express');
const router = express.Router();
const wechatService = require('../services/wechatService');
const logger = require('../utils/logger');
const { authMiddleware } = require('../middleware/auth');
const jwt = require('jsonwebtoken');

/**
 * 管理员认证中间件
 * 验证管理员token，允许管理后台访问微信API
 */
const adminAuthMiddleware = (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: '未提供认证token',
        code: 401
      });
    }

    // 解析token，不验证签名
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;
    const decoded = jwt.decode(token);
    
    if (!decoded) {
      return res.status(401).json({
        success: false,
        message: '无效的token',
        code: 401
      });
    }

    // 检查是否是管理员token
    if (decoded.sub === 'admin') {
      // 是管理员token，允许通过
      logger.info('管理员访问微信API');
      next();
    } else {
      // 不是管理员token，尝试普通用户验证
      authMiddleware(req, res, next);
    }
  } catch (error) {
    logger.error('管理员认证中间件错误:', error);
    return res.status(500).json({
      success: false,
      message: '服务器内部错误',
      code: 500
    });
  }
};

/**
 * @api {post} /api/wx-delivery/add 添加物流信息
 * @apiName AddDelivery
 * @apiGroup WxDelivery
 * @apiDescription 添加物流信息
 * 
 * @apiParam {String} order_id 订单ID
 * @apiParam {String} delivery_id 快递公司ID
 * @apiParam {String} waybill_id 运单号
 */
router.post('/add', adminAuthMiddleware, async (req, res) => {
  try {
    const { order_id, delivery_id, waybill_id } = req.body;
    
    // 参数验证
    if (!order_id || !delivery_id || !waybill_id) {
      return res.status(400).json({
        errcode: 400,
        errmsg: '缺少必要参数'
      });
    }
    
    // 获取access_token
    const accessToken = await wechatService.getAccessToken();
    
    // 检查是否为模拟token（以mock_开头）
    if (accessToken.startsWith('mock_')) {
      logger.info('检测到模拟access_token，直接返回模拟添加物流信息结果');
      return res.json({
        errcode: 0,
        errmsg: 'ok (模拟)'
      });
    }
    
    // 构建物流信息数据
    const deliveryData = {
      order_id,
      delivery_id,
      waybill_id
    };
    
    // 调用微信添加物流信息API
    const result = await wechatService.addDeliveryInfo(accessToken, deliveryData);
    
    res.json(result);
  } catch (error) {
    logger.error('添加物流信息失败:', error);
    res.status(500).json({
      errcode: -1,
      errmsg: `添加物流信息失败: ${error.message}`
    });
  }
});

module.exports = router; 