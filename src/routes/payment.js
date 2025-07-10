const express = require("express");
const router = express.Router();

// 引入各个子模块
const ordersRouter = require("./orders");
const wechatPayRouter = require("./wechatPay");
const wechatTransferRouter = require("./wechatTransfer");
const paymentTestRouter = require("./paymentTest");
const paymentNotifyRouter = require("./paymentNotify");

// 为了兼容原有接口，先挂载具体的路由处理
router.use("/", ordersRouter);        // 处理 /create
router.use("/", wechatPayRouter);     // 处理 /wxMiniPay, /wxMiniPayExternal 等
router.use("/", wechatTransferRouter); // 处理 /transferToUser
router.use("/", paymentTestRouter);   // 处理 /createTestOrder
router.use("/", paymentNotifyRouter); // 处理 /notify

// 挂载分组路由（这些路径会有前缀）
router.use("/order", ordersRouter);
router.use("/orders", ordersRouter);
router.use("/pay", wechatPayRouter);
router.use("/transfer", wechatTransferRouter);
router.use("/test", paymentTestRouter);

module.exports = router; 