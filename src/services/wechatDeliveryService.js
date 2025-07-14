const axios = require('axios');
const logger = require('../utils/logger');

/**
 * 上传物流信息到微信
 * @param {Object} params 物流信息参数
 * @returns {Promise<Object>} 上传结果
 */
async function uploadShippingInfo(params) {
  try {
    const {
      transactionId,
      expressCompany,
      trackingNo,
      itemDesc = '订单商品',
      consignorContact = '138****0000',
      openid
    } = params;

    logger.info(`添加物流信息: 交易号=${transactionId}, 物流公司=${expressCompany}, 运单号=${trackingNo}`);

    // 获取微信access_token
    const wechatService = require('./wechatService');
    const accessToken = await wechatService.getAccessToken();
    logger.info(`成功获取access_token: ${accessToken.substring(0, 10)}...`);

    // 构建请求URL
    const url = `https://api.weixin.qq.com/wxa/sec/order/upload_shipping_info?access_token=${accessToken}`;
    logger.info(`开始调用微信API: ${url}`);

    // 获取当前时间，格式为ISO 8601，带时区信息
    const now = new Date();
    const uploadTime = now.toISOString().replace('Z', '+08:00');

    // 构建请求数据
    const requestData = {
      order_key: {
        order_number_type: 2, // 2表示微信交易单号
        transaction_id: transactionId // 微信支付交易单号
      },
      delivery_mode: 1, // 1表示物流配送
      logistics_type: 1, // 1表示国内物流
      shipping_list: [
        {
          tracking_no: trackingNo, // 运单号
          express_company: expressCompany, // 物流公司代码，直接使用前端传来的代码
          item_desc: itemDesc, // 商品描述
          contact: {
            consignor_contact: consignorContact // 发件人联系方式
          }
        }
      ],
      upload_time: uploadTime,
      payer: {
        openid: openid // 用户openid
      }
    };

    logger.info(`请求数据: ${JSON.stringify(requestData)}`);

    // 发送请求
    const response = await axios.post(url, requestData);
    logger.info(`微信API响应: ${JSON.stringify(response.data)}`);

    // 检查响应
    if (response.data.errcode === 0) {
      logger.info('物流信息上传成功');
      return {
        success: true,
        data: response.data,
        message: '物流信息上传成功'
      };
    } else {
      logger.error(`微信接口错误: ${response.data.errcode} - ${response.data.errmsg}`);
      return {
        success: false,
        data: response.data,
        message: `微信接口错误: ${response.data.errmsg}`
      };
    }
  } catch (error) {
    logger.error(`上传物流信息失败: ${error.message}`);
    logger.error(error.stack);
    return {
      success: false,
      message: `上传物流信息失败: ${error.message}`
    };
  }
}

/**
 * 获取物流查询token
 * @param {Object} params 物流信息参数
 * @returns {Promise<Object>} 获取结果
 */
async function getLogisticsToken(params) {
  try {
    const {
      transactionId,
      expressCompany,
      trackingNo,
      openid
    } = params;

    logger.info(`获取物流查询token: 交易号=${transactionId}, 物流公司=${expressCompany}, 运单号=${trackingNo}`);

    // 获取微信access_token
    const wechatService = require('./wechatService');
    const accessToken = await wechatService.getAccessToken();
    logger.info(`成功获取access_token: ${accessToken.substring(0, 10)}...`);

    // 构建请求URL
    const url = `https://api.weixin.qq.com/cgi-bin/express/delivery/open_msg/trace_waybill?access_token=${accessToken}`;
    logger.info(`开始调用微信物流查询API: ${url}`);

    // 构建请求数据
    const requestData = {
      order_id: transactionId, // 交易单号
      delivery_id: expressCompany, // 快递公司ID
      waybill_id: trackingNo, // 运单号
      openid: openid, // 用户openid
      biz_id: process.env.WX_BIZ_ID || 'mall_logistics' // 商户ID，需要在微信后台申请
    };

    logger.info(`请求数据: ${JSON.stringify(requestData)}`);

    // 发送请求
    const response = await axios.post(url, requestData);
    logger.info(`微信物流查询API响应: ${JSON.stringify(response.data)}`);

    // 检查响应
    if (response.data.errcode === 0) {
      logger.info('获取物流查询token成功');
      return {
        success: true,
        data: {
          waybillToken: response.data.waybill_token
        },
        message: '获取物流查询token成功'
      };
    } else {
      logger.error(`微信接口错误: ${response.data.errcode} - ${response.data.errmsg}`);
      return {
        success: false,
        data: response.data,
        message: `微信接口错误: ${response.data.errmsg}`
      };
    }
  } catch (error) {
    logger.error(`获取物流查询token失败: ${error.message}`);
    logger.error(error.stack);
    return {
      success: false,
      message: `获取物流查询token失败: ${error.message}`
    };
  }
}

module.exports = {
  uploadShippingInfo,
  getLogisticsToken
}; 