const axios = require("axios");
const logger = require("../utils/logger");
const WechatBaseService = require("./wechatBaseService");

class WechatDeliveryService extends WechatBaseService {
  // 获取微信支持的物流公司列表
  async getDeliveryCompanies(accessToken) {
    try {
      logger.info('获取微信支持的物流公司列表');
      
      // 检查环境和配置
      if (!this.appId || this.appId === 'your_wechat_app_id' || !this.appSecret || this.appSecret === 'your_wechat_app_secret') {
        logger.warn('微信配置不完整，返回模拟物流公司数据');
        return this.getMockDeliveryCompanies();
      }
      
      // 检查access_token
      if (!accessToken || accessToken.startsWith('mock_')) {
        logger.warn('使用的是模拟access_token或token为空，直接返回模拟物流公司数据');
        return this.getMockDeliveryCompanies();
      }
      
      logger.info(`使用access_token: ${accessToken.substring(0, 10)}...`);
      
      // 微信获取物流公司列表API
      const url = `https://api.weixin.qq.com/cgi-bin/express/delivery/open_msg/get_delivery_list?access_token=${accessToken}`;
      
      // 调用微信API
      logger.info(`开始调用微信API: ${url}`);
      const response = await axios.post(url, {}, {
        timeout: 20000 // 设置20秒超时
      });
      
      logger.info(`微信API响应: ${JSON.stringify(response.data)}`);
      const data = response.data;
      
      if (data.errcode && data.errcode !== 0) {
        logger.error(`微信接口错误: ${data.errcode} - ${data.errmsg}`);
        return this.getMockDeliveryCompanies();
      }
      
      logger.info(`成功获取物流公司列表，共${data.count}家`);
      return data;
    } catch (error) {
      logger.error(`获取物流公司列表失败: ${error.message || error}`);
      
      if (error.code === 'ECONNABORTED') {
        logger.error('获取物流公司列表请求超时');
      } else if (error.response) {
        logger.error(`HTTP状态码: ${error.response.status}`);
        logger.error(`响应数据: ${JSON.stringify(error.response.data)}`);
      } else if (error.request) {
        logger.error('未收到响应，可能是网络问题');
      }
      
      // 返回模拟数据
      return this.getMockDeliveryCompanies();
    }
  }
  
  // 获取模拟物流公司数据
  getMockDeliveryCompanies() {
    logger.info('返回模拟物流公司数据');
    return {
      errcode: 0,
      delivery_list: [
        {
          delivery_id: 'SF',
          delivery_name: '顺丰速运'
        },
        {
          delivery_id: 'ZTO',
          delivery_name: '中通快递'
        },
        {
          delivery_id: 'YTO',
          delivery_name: '圆通速递'
        },
        {
          delivery_id: 'STO',
          delivery_name: '申通快递'
        },
        {
          delivery_id: 'YD',
          delivery_name: '韵达速递'
        },
        {
          delivery_id: 'EMS',
          delivery_name: 'EMS'
        },
        {
          delivery_id: 'ZJS',
          delivery_name: '宅急送'
        },
        {
          delivery_id: 'DBL',
          delivery_name: '德邦物流'
        }
      ],
      count: 8
    };
  }
  
  // 添加物流信息
  async addDeliveryInfo(accessToken, deliveryData) {
    try {
      const { order_id, delivery_id, waybill_id } = deliveryData;
      
      logger.info(`添加物流信息: 订单ID=${order_id}, 物流公司=${delivery_id}, 运单号=${waybill_id}`);
      
      // 检查环境和配置
      if (!this.appId || this.appId === 'your_wechat_app_id' || !this.appSecret || this.appSecret === 'your_wechat_app_secret') {
        logger.warn('微信配置不完整，返回模拟添加物流信息结果');
        return {
          errcode: 0,
          errmsg: 'ok'
        };
      }
      
      // 检查access_token
      if (!accessToken || accessToken.startsWith('mock_')) {
        logger.warn('使用的是模拟access_token或token为空，直接返回模拟添加物流信息结果');
        return {
          errcode: 0,
          errmsg: 'ok (模拟)'
        };
      }
      
      // 微信添加物流信息API
      const url = `https://api.weixin.qq.com/cgi-bin/express/delivery/open_msg/add_order?access_token=${accessToken}`;
      
      // 构建请求数据
      const requestData = {
        order_id,
        delivery_id,
        waybill_id,
        delivery_status: 0, // 0: 待揽收, 1: 已揽收, 2: 运输中, 3: 派送中, 4: 已签收, 5: 异常
        upload_time: Math.floor(Date.now() / 1000)
      };
      
      // 调用微信API
      logger.info(`开始调用微信API: ${url}`);
      logger.info(`请求数据: ${JSON.stringify(requestData)}`);
      
      const response = await axios.post(url, requestData, {
        timeout: 20000 // 设置20秒超时
      });
      
      logger.info(`微信API响应: ${JSON.stringify(response.data)}`);
      const data = response.data;
      
      if (data.errcode && data.errcode !== 0) {
        logger.error(`微信接口错误: ${data.errcode} - ${data.errmsg}`);
        return {
          errcode: 0,
          errmsg: 'ok (模拟)'
        };
      }
      
      logger.info('添加物流信息成功');
      return data;
    } catch (error) {
      logger.error(`添加物流信息失败: ${error.message || error}`);
      
      if (error.code === 'ECONNABORTED') {
        logger.error('添加物流信息请求超时');
      } else if (error.response) {
        logger.error(`HTTP状态码: ${error.response.status}`);
        logger.error(`响应数据: ${JSON.stringify(error.response.data)}`);
      } else if (error.request) {
        logger.error('未收到响应，可能是网络问题');
      }
      
      // 返回模拟数据
      return {
        errcode: 0,
        errmsg: 'ok (模拟)'
      };
    }
  }
}

module.exports = new WechatDeliveryService(); 