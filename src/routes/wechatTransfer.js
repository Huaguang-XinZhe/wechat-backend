const express = require("express");
const router = express.Router();

const { authMiddleware } = require("../middleware/auth");
const wechatTransferService = require("../services/wechatTransferService");
const logger = require("../utils/logger");
const {
  transferSchema,
  generateOrderNo,
} = require("../models/orderModels");

// 商家转账测试
router.post("/transferToUser", authMiddleware, async (req, res, next) => {
  try {
    const { error, value } = transferSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
        code: 400,
      });
    }

    const { amount, transfer_remark, testMode } = value;
    const user = req.user;

    // 调试日志：输出金额
    logger.info(`转账金额(元): ${amount}, 类型: ${typeof amount}`);
    logger.info(`转换后金额(分): ${Math.round(amount * 100)}`);

    // 生成转账单号
    const outBillNo = generateOrderNo("TRANSFER");

    // 构建转账数据
    const transferData = {
      outBillNo,
      // 直接使用固定值 10 分进行测试
      transferAmount: 10, // 0.1元 = 10分
      openid: user.openid,
      transferRemark: transfer_remark,
      transferSceneId: "1000", // 转账场景ID，1000 为现金营销场景
      userRecvPerception: "活动奖励", // 添加用户收款感知描述，使用"活动奖励"
      notifyUrl: process.env.TRANSFER_NOTIFY_URL, // 转账回调地址（可选）
      testMode: testMode, // 明确传递测试模式参数

      // 添加转账场景报备信息（必须）
      transferSceneReportInfos: [
        {
          infoType: "活动名称",
          infoContent: "商家转账测试活动",
        },
        {
          infoType: "奖励说明",
          infoContent: "测试转账奖励",
        },
      ],
    };

    try {
      // 调用转账接口
      const transferResult = await wechatTransferService.transferToUser(
        transferData
      );

      logger.info(
        `商家转账测试成功: ${outBillNo}, 用户: ${user.openid}, 金额: ${amount}`
      );

      res.json({
        success: true,
        message: "转账成功",
        data: {
          transferNo: transferResult.transferNo,
          billNo: transferResult.billNo,
          amount,
          status: transferResult.status,
          createTime: transferResult.createTime,
          mock: transferResult.mock || false,
          package_info: transferResult.package_info || null, // 添加 package_info 字段
        },
      });
    } catch (transferError) {
      // 捕获转账服务的错误，返回更详细的错误信息
      logger.error("商家转账测试失败:", transferError);

      // 构建详细的错误响应
      let errorMessage = "转账失败";
      let errorDetails = null;

      if (transferError.response && transferError.response.data) {
        errorMessage =
          transferError.response.data.message || "微信支付API返回错误";
        errorDetails = transferError.response.data;
      } else if (transferError.message) {
        errorMessage = transferError.message;
      }

      res.status(400).json({
        success: false,
        message: errorMessage,
        details: errorDetails,
        code: 400,
      });
    }
  } catch (error) {
    logger.error("商家转账测试失败:", error);
    next(error);
  }
});

// 查询转账结果
router.get("/query/:billNo", authMiddleware, async (req, res, next) => {
  try {
    const { billNo } = req.params;

    // 调用查询转账接口
    const queryResult = await wechatTransferService.queryTransfer(billNo);

    res.json({
      success: true,
      message: "查询成功",
      data: queryResult,
    });
  } catch (error) {
    logger.error("查询转账结果失败:", error);
    next(error);
  }
});

// 微信转账回调通知 - 不需要身份验证
router.post("/transfer/notify", async (req, res) => {
  try {
    const ip = req.headers['x-real-ip'] || req.ip;
    const requestId = `notify-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    
    logger.info(`=== 微信转账回调开始处理 [${requestId}] - ${ip} ===`);
    
    // 获取回调ID，用于幂等处理
    let notificationId = null;
    
    // 直接处理请求体，不使用事件监听方式
    let jsonData = '';
    
    // 如果请求体已经是JSON对象（express可能已经解析）
    if (req.body && typeof req.body === 'object') {
      jsonData = JSON.stringify(req.body);
      notificationId = req.body.id;
      logger.info(`请求体已被解析为对象 [${requestId}]`);
    } 
    // 如果请求体是字符串
    else if (req.body && typeof req.body === 'string') {
      jsonData = req.body;
      try {
        const parsed = JSON.parse(jsonData);
        notificationId = parsed.id;
      } catch (e) {}
      logger.info(`请求体是字符串 [${requestId}]`);
    }
    // 如果请求体为空，尝试使用原始请求体
    else if (req.rawBody) {
      jsonData = req.rawBody;
      try {
        const parsed = JSON.parse(jsonData);
        notificationId = parsed.id;
      } catch (e) {}
      logger.info(`使用原始请求体 [${requestId}]`);
    }
    // 如果以上都没有，记录错误
    else {
      logger.error(`无法获取请求体 [${requestId}]`);
      return res.json({ code: "SUCCESS", message: "OK" }); // 告知微信我们已收到通知
    }
    
    // 检查是否已处理过该通知
    if (notificationId && router.post("/transfer/notify").processedNotifications) {
      if (router.post("/transfer/notify").processedNotifications[notificationId]) {
        logger.info(`检测到重复通知 [${requestId}]: ${notificationId}，直接返回成功`);
        return res.json({ code: "SUCCESS", message: "OK" });
      }
    }
    
    logger.info(`完整JSON数据长度 [${requestId}]: ${jsonData.length}`);
    // 完整记录回调数据，便于排查问题（生产环境可考虑脱敏）
    logger.info(`回调原始数据 [${requestId}]: ${jsonData}`);
    
    // 解析JSON数据
    let notifyData;
    try {
      notifyData = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;
      logger.info(`解析JSON数据成功 [${requestId}]`);
      
      // 验证签名 - 从请求头获取签名信息
      const wechatpaySerial = req.headers['wechatpay-serial'];
      const wechatpaySignature = req.headers['wechatpay-signature'];
      const wechatpayTimestamp = req.headers['wechatpay-timestamp'];
      const wechatpayNonce = req.headers['wechatpay-nonce'];
      
      logger.info(`签名信息 [${requestId}]: Serial=${wechatpaySerial}, Timestamp=${wechatpayTimestamp}, Nonce=${wechatpayNonce}`);
      
      // 验证签名 - 如果有签名信息则进行验证
      if (wechatpaySignature && wechatpayTimestamp && wechatpayNonce) {
        try {
          const wechatService = require("../services/wechatService");
          const isSignValid = await wechatService.verifySignature(
            wechatpaySignature,
            wechatpayTimestamp,
            wechatpayNonce,
            typeof jsonData === 'string' ? jsonData : JSON.stringify(jsonData),
            wechatpaySerial
          );
          
          if (!isSignValid) {
            logger.error(`签名验证失败 [${requestId}]`);
            // 签名验证失败时，按照文档要求返回4XX状态码
            return res.status(400).json({ code: "FAIL", message: "签名验证失败" });
          }
          
          logger.info(`签名验证成功 [${requestId}]`);
        } catch (signError) {
          logger.error(`签名验证异常 [${requestId}]: ${signError.message}`);
          // 签名验证异常时，按照文档要求返回4XX状态码
          return res.status(400).json({ code: "FAIL", message: "签名验证异常" });
        }
      } else {
        logger.warn(`未提供完整的签名信息 [${requestId}]，跳过签名验证`);
      }
    } catch (parseError) {
      logger.error(`解析JSON数据失败 [${requestId}]: ${parseError.message}`);
      return res.json({ code: "SUCCESS", message: "OK" }); // 告知微信我们已收到通知
    }
    
    // 尝试从回调数据或嵌套资源中提取转账单号和状态
    let outBillNo = null;
    let transferBillNo = null;
    let state = null;
    let transferDetail = null;
    
    // 如果存在加密资源，尝试解密
    if (notifyData.resource) {
      logger.info(`回调包含resource字段 [${requestId}]: ${JSON.stringify(notifyData.resource)}`);
      
      // 如果有解密后的数据（resource.ciphertext），尝试解析
      if (notifyData.resource.ciphertext && notifyData.resource.associated_data && notifyData.resource.nonce) {
        try {
          // 尝试解密资源数据
          const wechatService = require("../services/wechatService");
          const decryptedData = wechatService.decryptResource(notifyData.resource);
          
          if (decryptedData) {
            logger.info(`资源解密成功 [${requestId}]: ${JSON.stringify(decryptedData)}`);
            transferDetail = decryptedData;
            
            // 从解密数据中提取信息 - 注意字段名是 out_bill_no 和 state
            if (decryptedData.out_bill_no) {
              outBillNo = decryptedData.out_bill_no;
              logger.info(`从解密数据中提取到单号 [${requestId}]: ${outBillNo}`);
            }
            
            if (decryptedData.transfer_bill_no) {
              transferBillNo = decryptedData.transfer_bill_no;
              logger.info(`从解密数据中提取到微信单号 [${requestId}]: ${transferBillNo}`);
            }
            
            // 根据文档，状态字段名是 state 而不是 status
            if (decryptedData.state) {
              state = decryptedData.state;
              logger.info(`从解密数据中提取到状态 [${requestId}]: ${state}`);
            }
          }
        } catch (decryptError) {
          logger.error(`资源解密失败 [${requestId}]: ${decryptError.message}`);
        }
      }
    }
    
    // 如果解密后仍未获取到单号，尝试从原始数据中提取
    if (!outBillNo) {
      if (notifyData.out_bill_no) {
        outBillNo = notifyData.out_bill_no;
        logger.info(`从原始数据中提取到单号 [${requestId}]: ${outBillNo}`);
      } else if (notifyData.id) {
        outBillNo = notifyData.id;
        logger.info(`使用通知ID作为单号 [${requestId}]: ${outBillNo}`);
      }
    }
    
    // 如果依然没有找到单号，但有对应的业务ID
    if (!outBillNo && notifyData.summary) {
      logger.info(`尝试从summary中提取信息 [${requestId}]: ${notifyData.summary}`);
    }
    
    // 获取处理结果状态 - 优先使用解密后的state字段
    if (!state) {
      state = notifyData.state || 'SUCCESS';
      logger.info(`使用原始数据中的状态 [${requestId}]: ${state}`);
    }
    
    // 如果没找到单号，查找处理中的提现记录
    if (!outBillNo) {
      logger.info(`未从回调数据中找到转账单号 [${requestId}]，将尝试更新最近的处理中记录`);
      await router.post("/transfer/notify")._handleLatestProcessingRecord(requestId, state);
    } else {
      // 找到了单号，实现幂等处理
      await router.post("/transfer/notify")._handleWithdrawRecordWithBillNo(
        requestId, 
        outBillNo, 
        state, 
        {
          transfer_bill_no: transferBillNo,
          ...transferDetail
        }
      );
    }
    
    // 记录已处理的通知ID，避免重复处理
    if (notificationId) {
      if (!router.post("/transfer/notify").processedNotifications) {
        router.post("/transfer/notify").processedNotifications = {};
      }
      
      // 记录通知ID和处理时间
      router.post("/transfer/notify").processedNotifications[notificationId] = {
        processedAt: new Date().toISOString(),
        outBillNo,
        state
      };
      
      // 限制缓存大小，避免内存泄漏
      const maxCacheSize = 1000;
      const keys = Object.keys(router.post("/transfer/notify").processedNotifications);
      if (keys.length > maxCacheSize) {
        // 删除最旧的记录
        delete router.post("/transfer/notify").processedNotifications[keys[0]];
      }
    }
    
    // 返回成功响应给微信
    logger.info(`转账回调处理完成 [${requestId}]，返回成功`);
    return res.json({ code: "SUCCESS", message: "OK" });
  } catch (error) {
    logger.error(`处理微信转账回调失败: ${error.message}`);
    // 即使出错也返回成功，避免微信重复回调
    return res.json({ code: "SUCCESS", message: "OK" });
  }
});

// 处理最近的处理中提现记录
router.post("/transfer/notify")._handleLatestProcessingRecord = async function(requestId, state) {
  try {
    // 检查是否已处理过该请求
    if (!router.post("/transfer/notify").processedRequests) {
      router.post("/transfer/notify").processedRequests = {};
    }
    
    // 使用requestId作为缓存键，避免短时间内重复处理同一请求
    const cacheKey = `latest_${requestId}`;
    if (router.post("/transfer/notify").processedRequests[cacheKey]) {
      logger.info(`该请求已处理过 [${requestId}], 跳过处理`);
      return;
    }
    
    // 查询对应的提现记录
    const { WxWithdrawRecord } = require("../models/withdrawModel");
    
    // 查找最近的处理中记录
    const latestRecord = await WxWithdrawRecord.findOne({
      where: { status: 'PROCESSING' },
      order: [['create_time', 'DESC']]
    });
    
    if (latestRecord) {
      logger.info(`找到最近的处理中记录 [${requestId}]: ID=${latestRecord.id}, 单号=${latestRecord.out_bill_no}`);
      
      // 记录处理结果
      router.post("/transfer/notify").processedRequests[cacheKey] = {
        processedAt: new Date().toISOString(),
        recordId: latestRecord.id,
        outBillNo: latestRecord.out_bill_no
      };
      
      // 如果已经在processedBillNos中记录过，则跳过处理
      if (router.post("/transfer/notify").processedBillNos && 
          router.post("/transfer/notify").processedBillNos[latestRecord.out_bill_no]) {
        logger.info(`该单号已处理过 [${requestId}]: ${latestRecord.out_bill_no}, 跳过处理`);
        return;
      }
      
      // 幂等处理 - 更新为成功状态
      if (state.toUpperCase() === 'SUCCESS') {
        // 更新状态，使用事务确保原子性
        await WxWithdrawRecord.update(
          {
            status: 'SUCCESS',
            transfer_bill_no: `AUTO_${Date.now()}`
          },
          {
            where: {
              id: latestRecord.id,
              status: 'PROCESSING' // 条件确保只有处理中的记录才会被更新
            }
          }
        );
        
        // 再次查询确认状态已更新
        const updatedRecord = await WxWithdrawRecord.findByPk(latestRecord.id);
        logger.info(`提现记录更新结果 [${requestId}]: ID=${updatedRecord.id}, 状态=${updatedRecord.status}`);
        
        // 记录到processedBillNos中
        if (!router.post("/transfer/notify").processedBillNos) {
          router.post("/transfer/notify").processedBillNos = {};
        }
        router.post("/transfer/notify").processedBillNos[latestRecord.out_bill_no] = {
          processedAt: new Date().toISOString(),
          result: 'updated_via_latest',
          newStatus: 'SUCCESS'
        };
      } else if (state.toUpperCase() === 'FAIL') {
        // 处理失败状态
        await WxWithdrawRecord.update(
          {
            status: 'FAILED',
            transfer_bill_no: `AUTO_FAIL_${Date.now()}`
          },
          {
            where: {
              id: latestRecord.id,
              status: 'PROCESSING'
            }
          }
        );
        
        const updatedRecord = await WxWithdrawRecord.findByPk(latestRecord.id);
        logger.info(`提现记录更新为失败 [${requestId}]: ID=${updatedRecord.id}, 状态=${updatedRecord.status}`);
        
        // 记录到processedBillNos中
        if (!router.post("/transfer/notify").processedBillNos) {
          router.post("/transfer/notify").processedBillNos = {};
        }
        router.post("/transfer/notify").processedBillNos[latestRecord.out_bill_no] = {
          processedAt: new Date().toISOString(),
          result: 'updated_via_latest',
          newStatus: 'FAILED'
        };
      }
    } else {
      logger.warn(`未找到处理中的提现记录 [${requestId}]`);
      
      // 记录处理结果
      router.post("/transfer/notify").processedRequests[cacheKey] = {
        processedAt: new Date().toISOString(),
        result: 'no_processing_record_found'
      };
    }
    
    // 限制缓存大小，避免内存泄漏
    const maxCacheSize = 100;
    const keys = Object.keys(router.post("/transfer/notify").processedRequests);
    if (keys.length > maxCacheSize) {
      // 删除最旧的记录
      delete router.post("/transfer/notify").processedRequests[keys[0]];
    }
  } catch (dbError) {
    logger.error(`数据库操作失败 [${requestId}]: ${dbError.message}`);
  }
};

// 根据单号处理提现记录（幂等处理）
router.post("/transfer/notify")._handleWithdrawRecordWithBillNo = async function(requestId, outBillNo, state, transferDetail) {
  try {
    logger.info(`处理指定单号的提现记录 [${requestId}]: ${outBillNo}, 状态=${state}`);
    
    // 检查是否已处理过该单号
    if (!router.post("/transfer/notify").processedBillNos) {
      router.post("/transfer/notify").processedBillNos = {};
    }
    
    // 如果已处理过该单号，直接返回
    if (router.post("/transfer/notify").processedBillNos[outBillNo]) {
      logger.info(`该单号已处理过 [${requestId}]: ${outBillNo}, 跳过处理`);
      return;
    }
    
    // 查询对应的提现记录
    const { WxWithdrawRecord } = require("../models/withdrawModel");
    const withdrawRecord = await WxWithdrawRecord.findOne({
      where: { out_bill_no: outBillNo }
    });
    
    if (withdrawRecord) {
      logger.info(`找到对应的提现记录 [${requestId}]: ID=${withdrawRecord.id}, 当前状态=${withdrawRecord.status}`);
      
      // 幂等处理 - 只有在处理中状态才会更新
      if (withdrawRecord.status === 'PROCESSING') {
        let newStatus = withdrawRecord.status;
        
        // 根据微信支付文档中的状态映射到我们系统的状态
        if (state.toUpperCase() === 'SUCCESS') {
          newStatus = 'SUCCESS';
        } else if (state.toUpperCase() === 'FAIL' || state.toUpperCase() === 'CANCELLED') {
          newStatus = 'FAILED';
        }
        
        if (newStatus !== withdrawRecord.status) {
          // 条件更新，确保幂等性
          const [updatedCount] = await WxWithdrawRecord.update(
            {
              status: newStatus,
              transfer_bill_no: transferDetail.transfer_bill_no || `NOTIFY_${Date.now()}`
            },
            {
              where: {
                id: withdrawRecord.id,
                status: 'PROCESSING' // 条件确保只有处理中的记录才会被更新
              }
            }
          );
          
          logger.info(`提现记录状态更新结果 [${requestId}]: 影响行数=${updatedCount}, 新状态=${newStatus}`);
          
          // 记录处理结果
          router.post("/transfer/notify").processedBillNos[outBillNo] = {
            processedAt: new Date().toISOString(),
            result: updatedCount > 0 ? 'updated' : 'no_change',
            newStatus
          };
        } else {
          logger.info(`提现记录状态无需更新 [${requestId}]: 当前状态=${withdrawRecord.status}`);
          
          // 记录处理结果
          router.post("/transfer/notify").processedBillNos[outBillNo] = {
            processedAt: new Date().toISOString(),
            result: 'no_change_needed'
          };
        }
      } else {
        logger.info(`提现记录已经是终态 [${requestId}]: ${withdrawRecord.status}, 无需更新`);
        
        // 记录处理结果
        router.post("/transfer/notify").processedBillNos[outBillNo] = {
          processedAt: new Date().toISOString(),
          result: 'already_final_state',
          status: withdrawRecord.status
        };
      }
    } else {
      logger.warn(`未找到对应单号的提现记录 [${requestId}]: ${outBillNo}`);
      
      // 记录处理结果
      router.post("/transfer/notify").processedBillNos[outBillNo] = {
        processedAt: new Date().toISOString(),
        result: 'record_not_found'
      };
    }
    
    // 限制缓存大小，避免内存泄漏
    const maxCacheSize = 1000;
    const keys = Object.keys(router.post("/transfer/notify").processedBillNos);
    if (keys.length > maxCacheSize) {
      // 删除最旧的记录
      delete router.post("/transfer/notify").processedBillNos[keys[0]];
    }
  } catch (dbError) {
    logger.error(`更新提现记录失败 [${requestId}]: ${dbError.message}`);
  }
};

module.exports = router;