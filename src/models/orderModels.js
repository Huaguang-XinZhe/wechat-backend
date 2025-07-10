const Joi = require("joi");

// 模拟订单和用户模型（因为Order.js创建有问题，这里临时模拟）
const orders = new Map();
const users = new Map();

// 验证 schema
const createOrderSchema = Joi.object({
  goodsId: Joi.string().required().messages({
    "string.empty": "商品ID不能为空",
    "any.required": "商品ID是必需的",
  }),
  goodsName: Joi.string().required().messages({
    "string.empty": "商品名称不能为空",
    "any.required": "商品名称是必需的",
  }),
  amount: Joi.number().positive().precision(2).required().messages({
    "number.positive": "金额必须大于0",
    "any.required": "金额是必需的",
  }),
  remark: Joi.string().allow("").optional(),
});

const createTestOrderSchema = Joi.object({
  amount: Joi.number().positive().precision(2).default(0.01).messages({
    "number.positive": "金额必须大于0",
  }),
  description: Joi.string().default("支付功能测试订单"),
  testMode: Joi.boolean().default(true),
});

const wxMiniPaySchema = Joi.object({
  orderId: Joi.alternatives().try(Joi.number(), Joi.string()).required(),
  amount: Joi.number().positive().precision(2).default(0.01),
  total_fee: Joi.number().positive().precision(2),
  description: Joi.string().default("微信支付测试"),
});

const transferSchema = Joi.object({
  amount: Joi.number().positive().precision(2).default(0.1),
  transfer_remark: Joi.string().default("商家转账测试"),
  testMode: Joi.boolean().default(true),
});

const externalOrderPaySchema = Joi.object({
  orderId: Joi.alternatives().try(Joi.number(), Joi.string()).required(),
  amount: Joi.number().positive().precision(2).required(),
  total_fee: Joi.number().positive().precision(2).optional(),
  description: Joi.string().required(),
});

// 工具函数
const generateOrderNo = (prefix = "WX") => {
  return `${prefix}${Date.now()}${Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0")}`;
};

const getClientIp = (req) => {
  return req.ip || req.connection.remoteAddress || "127.0.0.1";
};

module.exports = {
  orders,
  users,
  createOrderSchema,
  createTestOrderSchema,
  wxMiniPaySchema,
  transferSchema,
  externalOrderPaySchema,
  generateOrderNo,
  getClientIp,
}; 