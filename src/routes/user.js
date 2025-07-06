const express = require("express");
const Joi = require("joi");
const router = express.Router();

const UserAdapterService = require("../services/userAdapterService");
const { authMiddleware, optionalAuth } = require("../middleware/auth");
const logger = require("../utils/logger");
const { UmsMember, UmsMemberWechat } = require("../models/legacy");
const { legacySequelize } = require("../config/legacyDatabase");

// 获取用户资料 schema
const getUserProfileSchema = Joi.object({
  userId: Joi.number().integer().positive().required().messages({
    "number.base": "用户ID必须是数字",
    "number.integer": "用户ID必须是整数",
    "number.positive": "用户ID必须是正数",
    "any.required": "用户ID是必需的",
  }),
});

// 获取当前用户资料
router.get("/profile", authMiddleware, async (req, res, next) => {
  try {
    const user = req.user;

    res.json({
      success: true,
      message: "获取用户资料成功",
      data: {
        user: {
          id: user.id,
          nickname: user.nickname,
          avatar_url: user.avatar_url,
          phone_number: user.phone_number,
        },
      },
    });
  } catch (error) {
    logger.error("获取用户资料失败:", error);
    next(error);
  }
});

// 获取指定用户资料
router.get("/:userId", optionalAuth, async (req, res, next) => {
  try {
    // 验证参数
    const { error, value } = getUserProfileSchema.validate({
      userId: parseInt(req.params.userId, 10),
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
        code: 400,
      });
    }

    const { userId } = value;

    // 查找用户
    const user = await UserAdapterService.findUserById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "用户不存在",
        code: 404,
      });
    }

    // 如果是自己请求自己的资料，返回完整信息
    const isSelf = req.user && req.user.id === userId;

    res.json({
      success: true,
      message: "获取用户资料成功",
      data: {
        user: {
          id: user.id,
          nickname: user.nickname,
          avatar_url: user.avatar_url,
          // 只有用户自己查看时才返回手机号
          phone_number: isSelf ? user.phone_number : undefined,
        },
      },
    });
  } catch (error) {
    logger.error("获取指定用户资料失败:", error);
    next(error);
  }
});

// 更新用户信息验证 schema
const updateProfileSchema = Joi.object({
  nickname: Joi.string().max(50).optional(),
  avatar_url: Joi.string().uri().optional(),
  phone_number: Joi.string()
    .pattern(/^1[3-9]\d{9}$/)
    .optional()
    .messages({
      "string.pattern.base": "手机号格式不正确",
    }),
});

// 更新用户信息
router.put("/profile", authMiddleware, async (req, res, next) => {
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
          phone_number: user.phone_number,
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
router.get("/stats", authMiddleware, async (req, res, next) => {
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
router.delete("/account", authMiddleware, async (req, res, next) => {
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

// 获取单个用户的邀请信息
router.get("/invite/:openid", async (req, res, next) => {
  try {
    const { openid } = req.params;

    // 查询微信用户信息
    const wechatUser = await UmsMemberWechat.findByPk(openid);

    if (!wechatUser) {
      return res.status(404).json({
        success: false,
        message: "用户不存在",
        code: 404,
      });
    }

    // 将 openid 转换为 base64 编码用于查询 ums_member 表
    const base64Openid = Buffer.from(openid).toString("base64");

    // 查询用户基本信息
    const memberUser = await UmsMember.findOne({
      where: { username: base64Openid },
    });

    if (!memberUser) {
      return res.status(404).json({
        success: false,
        message: "用户基本信息不存在",
        code: 404,
      });
    }

    res.json({
      success: true,
      message: "获取用户邀请信息成功",
      data: {
        user: {
          id: memberUser.id,
          openid: openid,
          nickname: memberUser.nickname,
          phone: memberUser.phone,
          invite_code: wechatUser.invite_code,
          invite_from: wechatUser.invite_from,
          create_time: memberUser.create_time,
        },
      },
    });
  } catch (error) {
    logger.error("获取用户邀请信息失败:", error);
    next(error);
  }
});

// 获取所有用户的邀请信息
router.get("/invite/list/all", async (req, res, next) => {
  try {
    // 使用 JOIN 查询获取所有用户的邀请信息
    const users = await legacySequelize.query(
      `SELECT 
        w.openid,
        m.id,
        m.nickname,
        m.phone,
        w.invite_from,
        w.invite_code,
        m.create_time
      FROM 
        ums_member_wechat w
      JOIN 
        ums_member m ON m.username = TO_BASE64(w.openid)
      ORDER BY 
        m.create_time DESC`,
      { type: legacySequelize.QueryTypes.SELECT }
    );

    res.json({
      success: true,
      message: "获取所有用户邀请信息成功",
      data: {
        users,
        total: users.length,
      },
    });
  } catch (error) {
    logger.error("获取所有用户邀请信息失败:", error);
    next(error);
  }
});

// 计算用户资料完整度
function calculateProfileCompleteness(user) {
  const fields = ["nickname", "avatar_url", "phone_number"];
  const filledFields = fields.filter((field) => {
    const value = user[field];
    return value !== null && value !== undefined && value !== "" && value !== 0;
  });

  return Math.round((filledFields.length / fields.length) * 100);
}

module.exports = router;
