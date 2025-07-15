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
      
      // 检查是否已经有进行中的提现申请
      const processingWithdraw = await WxWithdrawRecord.findOne({
        where: {
          member_id: userId,
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
    const { testMode = false, remark = "邀请奖励提现" } = options;
    
    try {
      // 获取用户提现信息
      const withdrawInfo = await UserAdapterService.getInviteWithdrawInfo(user.id);
      
      // 检查是否有可提现金额
      const availableAmount = parseFloat(withdrawInfo.availableCommission);
      if (availableAmount <= 0) {
        throw new Error("没有可提现金额");
      }
      
      // 检查是否已经有进行中的提现申请
      const processingWithdraw = await WxWithdrawRecord.findOne({
        where: {
          member_id: user.id,
          status: "PROCESSING"
        }
      });
      
      if (processingWithdraw) {
        throw new Error("您有一笔提现申请正在处理中，请等待处理完成后再申请");
      }
      
      // 生成提现单号
      const outBillNo = generateWithdrawBillNo();
      
      // 创建提现记录
      const withdrawRecord = await WxWithdrawRecord.create({
        member_id: user.id,
        openid: user.openid,
        out_bill_no: outBillNo,
        amount: availableAmount,
        status: "PROCESSING",
        remark: remark,
        order_amount_total: parseFloat(withdrawInfo.totalOrderAmount),
        commission_rate: withdrawInfo.commissionRate,
        related_orders: JSON.stringify(withdrawInfo.confirmedOrders.map(order => order.order_sn)),
        related_trans_ids: JSON.stringify(withdrawInfo.transactionIds.map(tx => ({ 
          order_sn: tx.order_sn, 
          transaction_id: tx.transaction_id 
        })))
      });
      
      // 调用微信转账接口
      try {
        // 转换为分（1元=100分）
        const transferAmountInCents = Math.round(availableAmount * 100);
        
        // 构建转账数据
        const transferData = {
          outBillNo,
          transferAmount: transferAmountInCents,
          openid: user.openid,
          transferRemark: remark,
          transferSceneId: "1000", // 转账场景ID，1000 为现金营销场景
          userRecvPerception: "邀请奖励", // 用户收款感知描述
          testMode: testMode, // 测试模式参数
          
          // 添加转账场景报备信息
          transferSceneReportInfos: [
            {
              infoType: "活动名称",
              infoContent: "邀请好友奖励",
            },
            {
              infoType: "奖励说明",
              infoContent: "邀请好友注册奖励",
            },
          ],
        };
        
        // 调用转账接口
        const transferResult = await wechatTransferService.transferToUser(transferData);
        
        // 更新提现记录
        await withdrawRecord.update({
          status: "SUCCESS",
          transfer_bill_no: transferResult.transferNo || null
        });
        
        return {
          success: true,
          withdrawId: withdrawRecord.id,
          billNo: outBillNo,
          transferNo: transferResult.transferNo,
          amount: availableAmount.toFixed(2),
          status: "SUCCESS",
          createTime: withdrawRecord.create_time,
          mock: transferResult.mock || false,
          packageInfo: transferResult.package_info || null
        };
      } catch (transferError) {
        // 更新提现记录为失败
        await withdrawRecord.update({
          status: "FAILED",
          remark: `转账失败: ${transferError.message || "未知错误"}`
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
   * 获取用户提现记录
   * @param {number} userId 用户ID
   * @param {Object} options 查询选项
   * @returns {Promise<Array>} 提现记录列表
   */
  async getWithdrawRecords(userId, options = {}) {
    const { limit = 10, offset = 0 } = options;
    
    try {
      const records = await WxWithdrawRecord.findAndCountAll({
        where: {
          member_id: userId
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
          updateTime: record.update_time,
          remark: record.remark
        }))
      };
    } catch (error) {
      logger.error("获取用户提现记录失败:", error);
      throw error;
    }
  }
}

module.exports = new WithdrawService(); 