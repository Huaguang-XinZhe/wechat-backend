const express = require("express");
const Joi = require("joi");
const router = express.Router();

const { authenticateToken } = require("../middleware/auth");
const User = require("../models/User");
const logger = require("../utils/logger");

// 获取用户信息
router.get("/profile", authenticateToken, async (req, res, next) => {
  try {
    const user = req.user;

    res.json({
      success: true,
      message: "获取用户信息成功",
      data: {
        user: {
          id: user.id,
          openid: user.openid,
          nickname: user.nickname,
          avatar_url: user.avatar_url,
          gender: user.gender,
          country: user.country,
          province: user.province,
          city: user.city,
          language: user.language,
          login_count: user.login_count,
          last_login_at: user.last_login_at,
          created_at: user.created_at,
        },
      },
    });
  } catch (error) {
    logger.error("获取用户信息失败:", error);
    next(error);
  }
});

// 更新用户信息验证 schema
const updateProfileSchema = Joi.object({
  nickname: Joi.string().max(50).optional(),
  avatar_url: Joi.string().uri().optional(),
  gender: Joi.number().integer().min(0).max(2).optional(),
  country: Joi.string().max(50).optional(),
  province: Joi.string().max(50).optional(),
  city: Joi.string().max(50).optional(),
  language: Joi.string().max(20).optional(),
});

// 更新用户信息
router.put("/profile", authenticateToken, async (req, res, next) => {
  try {
    // 验证请求参数
    const { error, value } = updateProfileSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
        code: 400,
      });
    }

    const user = req.user;
    const updateData = value;

    // 更新用户信息
    await user.update(updateData);

    logger.info(`用户信息更新成功: ${user.openid}`);

    res.json({
      success: true,
      message: "用户信息更新成功",
      data: {
        user: {
          id: user.id,
          openid: user.openid,
          nickname: user.nickname,
          avatar_url: user.avatar_url,
          gender: user.gender,
          country: user.country,
          province: user.province,
          city: user.city,
          language: user.language,
          updated_at: user.updated_at,
        },
      },
    });
  } catch (error) {
    logger.error("更新用户信息失败:", error);
    next(error);
  }
});

// 获取用户统计信息
router.get("/stats", authenticateToken, async (req, res, next) => {
  try {
    const user = req.user;

    // 这里可以添加更多统计信息，比如订单数量、消费金额等
    // 由于Order模型有问题，这里先返回基础统计

    const stats = {
      loginCount: user.login_count,
      lastLoginAt: user.last_login_at,
      memberSince: user.created_at,
      // 订单统计（模拟数据）
      totalOrders: 0,
      paidOrders: 0,
      totalAmount: 0,
      // 其他统计
      profileCompleteness: calculateProfileCompleteness(user),
    };

    res.json({
      success: true,
      message: "获取用户统计成功",
      data: { stats },
    });
  } catch (error) {
    logger.error("获取用户统计失败:", error);
    next(error);
  }
});

// 删除用户账号
router.delete("/account", authenticateToken, async (req, res, next) => {
  try {
    const user = req.user;

    // 软删除用户（设置为非活跃状态）
    await user.update({
      is_active: false,
      nickname: "已删除用户",
      avatar_url: null,
    });

    logger.info(`用户账号删除成功: ${user.openid}`);

    res.json({
      success: true,
      message: "账号删除成功",
      data: null,
    });
  } catch (error) {
    logger.error("删除用户账号失败:", error);
    next(error);
  }
});

// 计算用户资料完整度
function calculateProfileCompleteness(user) {
  const fields = [
    "nickname",
    "avatar_url",
    "gender",
    "country",
    "province",
    "city",
    "language",
  ];
  const filledFields = fields.filter((field) => {
    const value = user[field];
    return value !== null && value !== undefined && value !== "" && value !== 0;
  });

  return Math.round((filledFields.length / fields.length) * 100);
}

module.exports = router;
