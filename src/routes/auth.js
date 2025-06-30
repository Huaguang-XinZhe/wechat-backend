const express = require("express");
const jwt = require("jsonwebtoken");
const Joi = require("joi");
const router = express.Router();

// const User = require("../models/User"); // 数据库版本
const User = require("../models/MemoryUser"); // 内存存储版本
const wechatService = require("../services/wechatService");
const logger = require("../utils/logger");
const { authenticateToken } = require("../middleware/auth");

// 登录验证 schema - 简化为只需要 code
const loginSchema = Joi.object({
  code: Joi.string().required().messages({
    "string.empty": "code 不能为空",
    "any.required": "code 是必需的",
  }),
});

// 用户资料更新 schema
const updateProfileSchema = Joi.object({
  userInfo: Joi.object({
    nickName: Joi.string().allow(""),
    avatarUrl: Joi.string().allow(""),
    gender: Joi.number().integer().min(0).max(2).default(0),
    country: Joi.string().allow(""),
    province: Joi.string().allow(""),
    city: Joi.string().allow(""),
    language: Joi.string().allow(""),
  }).required(),
});

// 微信登录 - 按照官方时序图实现
router.post("/login", async (req, res, next) => {
  try {
    // 验证请求参数
    const { error, value } = loginSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
        code: 400,
      });
    }

    const { code } = value;

    // 第三步：通过 code 获取 openid 和 session_key
    const wechatAuth = await wechatService.code2Session(code);

    // 查找或创建用户
    let user = await User.findByOpenid(wechatAuth.openid);

    if (user) {
      // 更新现有用户的登录信息
      const updateData = {
        session_key: wechatAuth.session_key,
        last_login_at: new Date(),
      };

      await user.update(updateData);
      // 增加登录次数
      await User.updateLoginInfo(wechatAuth.openid);
    } else {
      // 创建新用户 - 使用默认信息
      const defaultNickname = `用户${wechatAuth.openid.slice(-6)}`;

      user = await User.create({
        openid: wechatAuth.openid,
        unionid: wechatAuth.unionid,
        session_key: wechatAuth.session_key,
        nickname: defaultNickname,
        avatar_url: "",
        gender: 0,
        country: "",
        province: "",
        city: "",
        language: "",
        last_login_at: new Date(),
        login_count: 1,
      });
    }

    // 生成 JWT token
    const token = jwt.sign(
      {
        userId: user.id,
        openid: user.openid,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: process.env.JWT_EXPIRES_IN || "7d",
      }
    );

    logger.info(`用户登录成功: ${user.openid}`);

    // 第四步：返回自定义登录态
    res.json({
      success: true,
      message: "登录成功",
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
        },
        token,
        tokenType: "Bearer",
      },
    });
  } catch (error) {
    logger.error("用户登录失败:", error);

    // 根据错误类型返回不同的错误信息
    if (error.message.includes("微信接口错误")) {
      return res.status(400).json({
        success: false,
        message: "微信登录验证失败，请重试",
        code: 400,
      });
    }

    next(error);
  }
});

// 更新用户资料
router.post("/updateProfile", authenticateToken, async (req, res, next) => {
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

    const { userInfo } = value;
    const userId = req.user.userId;

    // 查找用户
    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "用户不存在",
        code: 404,
      });
    }

    // 更新用户信息
    const updateData = {
      nickname: userInfo.nickName || user.nickname,
      avatar_url: userInfo.avatarUrl || user.avatar_url,
      gender: userInfo.gender !== undefined ? userInfo.gender : user.gender,
      country: userInfo.country || user.country,
      province: userInfo.province || user.province,
      city: userInfo.city || user.city,
      language: userInfo.language || user.language,
    };

    await user.update(updateData);

    logger.info(`用户资料更新成功: ${user.openid}`);

    res.json({
      success: true,
      message: "用户资料更新成功",
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
        },
      },
    });
  } catch (error) {
    logger.error("用户资料更新失败:", error);
    next(error);
  }
});

// 刷新 token
router.post("/refresh", async (req, res, next) => {
  try {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "缺少访问令牌",
        code: 401,
      });
    }

    // 验证 token（忽略过期）
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      ignoreExpiration: true,
    });

    // 查找用户
    const user = await User.findByPk(decoded.userId);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "用户不存在",
        code: 401,
      });
    }

    // 生成新的 token
    const newToken = jwt.sign(
      {
        userId: user.id,
        openid: user.openid,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: process.env.JWT_EXPIRES_IN || "7d",
      }
    );

    res.json({
      success: true,
      message: "Token 刷新成功",
      data: {
        token: newToken,
        tokenType: "Bearer",
      },
    });
  } catch (error) {
    logger.error("Token 刷新失败:", error);
    next(error);
  }
});

// 验证 token 有效性
router.post("/verify", authenticateToken, async (req, res) => {
  // authenticateToken 已经验证了 token 的有效性
  res.json({
    success: true,
    message: "Token 有效",
    data: {
      user: req.user,
    },
  });
});

module.exports = router;
