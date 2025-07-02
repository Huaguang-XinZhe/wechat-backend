const express = require("express");
const router = express.Router();

// 简单的支付状态查询
router.get("/status", (req, res) => {
  res.json({ status: "ok" });
});

// 简单的创建订单接口
router.post("/create-simple", (req, res) => {
  res.json({
    orderNo: `TEST${Date.now()}`,
    message: "测试订单创建成功",
  });
});

module.exports = router;
