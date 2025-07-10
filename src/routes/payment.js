const express = require("express");
const router = express.Router();

// 引入各个子模块
const ordersRouter = require("./orders");
const wechatPayRouter = require("./wechatPay");
const wechatTransferRouter = require("./wechatTransfer");
const paymentTestRouter = require("./paymentTest");
const paymentNotifyRouter = require("./paymentNotify");

// 挂载订单相关路由
router.use("/order", ordersRouter);
router.use("/orders", ordersRouter);

// 挂载微信支付相关路由
router.use("/pay", wechatPayRouter);

// 挂载微信转账相关路由
router.use("/transfer", wechatTransferRouter);

// 挂载测试相关路由
router.use("/test", paymentTestRouter);

// 挂载回调处理路由
router.use("/", paymentNotifyRouter);

// 为了兼容原有接口，保留一些直接挂载的路由
router.use("/create", ordersRouter);
router.use("/wxMiniPay", wechatPayRouter);
router.use("/wxMiniPayExternal", wechatPayRouter);
router.use("/updateExternalOrderStatus", wechatPayRouter);
router.use("/transferToUser", wechatTransferRouter);
router.use("/createTestOrder", paymentTestRouter);

module.exports = router; 