const express = require('express');
const router = express.Router();
const wechatService = require('../services/wechatService');
const logger = require('../utils/logger');
const { authMiddleware } = require('../middleware/auth');

/**
 * @api {get} /api/wx-delivery/companies 获取物流公司列表
 * @apiName GetDeliveryCompanies
 * @apiGroup WxDelivery
 * @apiDescription 获取微信支持的物流公司列表
 *
 * @apiSuccess {Number} errcode 错误码，0表示成功
 * @apiSuccess {Array} delivery_list 物流公司列表
 * @apiSuccess {Number} count 物流公司数量
 */
router.get('/companies', authMiddleware, async (req, res) => {
  try {
    // 获取access_token
    const accessToken = await wechatService.getAccessToken();
    
    // 调用微信获取物流公司列表API
    const result = await wechatService.getDeliveryCompanies(accessToken);
    
    res.json(result);
  } catch (error) {
    logger.error('获取物流公司列表失败:', error);
    res.status(500).json({
      errcode: -1,
      errmsg: `获取物流公司列表失败: ${error.message}`
    });
  }
});

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
router.post('/add', authMiddleware, async (req, res) => {
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
    
    // 调用微信添加物流信息API
    const result = await wechatService.addDeliveryInfo(accessToken, {
      order_id,
      delivery_id,
      waybill_id
    });
    
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