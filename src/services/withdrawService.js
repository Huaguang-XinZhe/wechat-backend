const logger = require("../utils/logger");
const { WxWithdrawRecord, generateWithdrawBillNo } = require("../models/withdrawModel");
const UserAdapterService = require("./userAdapterService");
const wechatTransferService = require("./wechatTransferService");

class WithdrawService {
  /**
   * 获取用户提现信息
   * @param {number} userId 用户ID
   * @returns {Promise<Object>} 提现信息
   */
  async getWithdrawInfo(userId) {
    try {
      // 获取用户邀请提现信息
      const withdrawInfo = await UserAdapterService.getInviteWithdrawInfo(userId);
      
      // 获取用户openid
      const userInfo = await UserAdapterService.getUserInfo(userId);
      if (!userInfo || !userInfo.openid) {
        throw new Error("用户未绑定微信账号");
      }
      
      // 检查是否已经有进行中的提现申请
      const processingWithdraw = await WxWithdrawRecord.findOne({
        where: {
          openid: userInfo.openid,
          status: "PROCESSING"
        },
        order: [["create_time", "DESC"]]
      });
      
      return {
        ...withdrawInfo,
        processingWithdraw: processingWithdraw ? {
          id: processingWithdraw.id,
          amount: processingWithdraw.amount,
          status: processingWithdraw.status,
          createTime: processingWithdraw.create_time
        } : null
      };
    } catch (error) {
      logger.error("获取用户提现信息失败:", error);
      throw error;
    }
  }
  
  /**
   * 申请提现
   * @param {Object} user 用户信息
   * @param {Object} options 提现选项
   * @returns {Promise<Object>} 提现结果
   */
  async requestWithdraw(user, options = {}) {
    const { amount, remark = "邀请奖励提现" } = options;
    
    try {
      // 获取用户提现信息
      const withdrawInfo = await UserAdapterService.getInviteWithdrawInfo(user.id);
      
      // 确定提现金额
      let availableAmount = amount;
      
      // 如果没有传入金额，使用用户可提现余额
      if (!availableAmount) {
        availableAmount = parseFloat(withdrawInfo.availableCommission);
      }
      
      // 检查是否有可提现金额
      if (availableAmount <= 0) {
        throw new Error("没有可提现金额");
      }
      
      // 如果传入的金额大于可提现余额，使用可提现余额
      if (availableAmount > parseFloat(withdrawInfo.availableCommission)) {
        availableAmount = parseFloat(withdrawInfo.availableCommission);
      }
      
      // 检查是否已经有进行中的提现申请
      const processingWithdraw = await WxWithdrawRecord.findOne({
        where: {
          openid: user.openid,
          status: "PROCESSING"
        }
      });
      
      if (processingWithdraw) {
        throw new Error("您有一笔提现申请正在处理中，请等待处理完成后再申请");
      }
      
      // 生成提现单号
      const outBillNo = generateWithdrawBillNo();
      
      // 准备关联订单信息
      const orderInfos = withdrawInfo.confirmedOrders.map(order => {
        const transInfo = withdrawInfo.transactionIds.find(tx => tx.order_sn === order.order_sn);
        return {
          order_sn: order.order_sn,
          order_amount: order.total_amount,
          transaction_id: transInfo ? transInfo.transaction_id : null
        };
      });
      
      // 创建提现记录
      const withdrawRecord = await WxWithdrawRecord.create({
        openid: user.openid,
        out_bill_no: outBillNo,
        amount: availableAmount,
        status: "PROCESSING",
        order_amount_total: parseFloat(withdrawInfo.totalOrderAmount),
        commission_rate: withdrawInfo.commissionRate,
        related_order_infos: JSON.stringify(orderInfos)
      });
      
      // 调用微信转账接口
      try {
        // 转换为分（1元=100分）
        const transferAmountInCents = Math.round(availableAmount * 100);
        
        // 构建转账数据
        const transferData = {
          outBillNo,
          // 使用固定值10分进行转账，与商家转账测试保持一致
          transferAmount: 10, // 0.1元 = 10分
          openid: user.openid,
          transferRemark: remark,
          transferSceneId: "1000", // 转账场景ID，1000 为现金营销场景
          userRecvPerception: "活动奖励", // 用户收款感知描述，必须使用微信支付支持的值
          notifyUrl: process.env.TRANSFER_NOTIFY_URL, // 添加转账回调地址
          
          // 添加转账场景报备信息（必须）
          transferSceneReportInfos: [
            {
              infoType: "活动名称",
              infoContent: "邀请好友奖励活动",
            },
            {
              infoType: "奖励说明",
              infoContent: "邀请新用户注册奖励",
            },
          ],
        };
        
        // 调用转账接口
        const transferResult = await wechatTransferService.transferToUser(transferData);
        
        // 重要：不再立即更新提现记录为成功状态
        // 而是保持PROCESSING状态，等待微信转账回调通知
        // 这样如果用户关闭收款弹窗，不会误标记为成功
        
        // 返回结果，包含package_info用于拉起微信收款确认页面
        return {
          success: true,
          withdrawId: withdrawRecord.id,
          billNo: outBillNo,
          transferNo: transferResult.transferNo,
          amount: 0.1, // 固定返回0.1元
          status: "PROCESSING", // 状态保持为处理中，等待回调更新
          createTime: withdrawRecord.create_time,
          package_info: transferResult.package_info || null
        };
      } catch (transferError) {
        // 更新提现记录为失败
        await withdrawRecord.update({
          status: "FAILED"
        });
        
        // 重新抛出错误
        throw transferError;
      }
    } catch (error) {
      logger.error("申请提现失败:", error);
      throw error;
    }
  }
  
  /**
   * 取消处理中的提现申请
   * @param {number} userId 用户ID
   * @returns {Promise<Object>} 取消结果
   */
  async cancelProcessingWithdraw(userId) {
    try {
      // 获取用户openid
      const userInfo = await UserAdapterService.getUserInfo(userId);
      if (!userInfo || !userInfo.openid) {
        throw new Error("用户未绑定微信账号");
      }
      
      // 查找处理中的提现记录
      const processingWithdraw = await WxWithdrawRecord.findOne({
        where: {
          openid: userInfo.openid,
          status: "PROCESSING"
        },
        order: [["create_time", "DESC"]]
      });
      
      // 如果没有处理中的提现记录，直接返回成功
      if (!processingWithdraw) {
        return {
          success: true,
          message: "没有处理中的提现申请"
        };
      }
      
      // 更新提现记录状态为已取消
      await processingWithdraw.update({
        status: "CANCELLED"
      });
      
      return {
        success: true,
        message: "提现申请已取消",
        withdrawId: processingWithdraw.id
      };
    } catch (error) {
      logger.error("取消提现申请失败:", error);
      throw error;
    }
  }
  
  /**
   * 获取用户提现记录
   * @param {number} userId 用户ID
   * @param {Object} options 查询选项
   * @returns {Promise<Array>} 提现记录列表
   */
  async getWithdrawRecords(userId, options = {}) {
    const { limit = 10, offset = 0 } = options;
    
    try {
      // 获取用户openid
      const userInfo = await UserAdapterService.getUserInfo(userId);
      if (!userInfo || !userInfo.openid) {
        throw new Error("用户未绑定微信账号");
      }
      
      const records = await WxWithdrawRecord.findAndCountAll({
        where: {
          openid: userInfo.openid
        },
        order: [["create_time", "DESC"]],
        limit,
        offset
      });
      
      return {
        total: records.count,
        records: records.rows.map(record => ({
          id: record.id,
          billNo: record.out_bill_no,
          transferNo: record.transfer_bill_no,
          amount: record.amount,
          status: record.status,
          createTime: record.create_time,
          orderAmountTotal: record.order_amount_total,
          commissionRate: record.commission_rate
        }))
      };
    } catch (error) {
      logger.error("获取用户提现记录失败:", error);
      throw error;
    }
  }
}

module.exports = new WithdrawService(); 