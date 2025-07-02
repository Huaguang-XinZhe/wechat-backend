const express = require("express");
const Joi = require("joi");
const router = express.Router();

const UserAdapterService = require("../services/userAdapterService");
const JwtService = require("../services/jwtService");
const wechatService = require("../services/wechatService");
const logger = require("../utils/logger");
const { legacyAuthMiddleware } = require("../middleware/legacyAuth");

// 登录验证 schema - 简化版本
const loginSchema = Joi.object({
  code: Joi.string().required().messages({
    "string.empty": "code 不能为空",
    "any.required": "code 是必需的",
  }),
  inviteCode: Joi.string().optional(), // 可选的邀请码
});

// 手机号登录 schema
const phoneLoginSchema = Joi.object({
  code: Joi.string().required().messages({
    "string.empty": "code 不能为空",
    "any.required": "code 是必需的",
  }),
  encryptedData: Joi.string().required().messages({
    "string.empty": "encryptedData 不能为空",
    "any.required": "encryptedData 是必需的",
  }),
  iv: Joi.string().required().messages({
    "string.empty": "iv 不能为空",
    "any.required": "iv 是必需的",
  }),
  inviteCode: Joi.string().optional(), // 可选的邀请码
});

// 邀请码验证 schema
const validateInviteCodeSchema = Joi.object({
  inviteCode: Joi.string().required().messages({
    "string.empty": "邀请码不能为空",
    "any.required": "邀请码是必需的",
  }),
});

// 用户资料更新 schema - 简化版本
const updateProfileSchema = Joi.object({
  nickname: Joi.string().optional(),
  avatar_url: Joi.string().optional(),
  phone_number: Joi.string()
    .pattern(/^1[3-9]\d{9}$/)
    .optional(),
});

// 格式化用户信息返回数据
function formatUserResponse(user) {
  return {
    id: user.id,
    nickname: user.nickname,
    avatar_url: user.avatar_url,
    phone_number: user.phone_number,
    login_count: user.login_count,
    last_login_at: user.last_login_at,
  };
}

// 手机号一键登录
router.post("/phoneLogin", async (req, res, next) => {
  try {
    // 验证请求参数
    const { error, value } = phoneLoginSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        code: 400,
        message: error.details[0].message,
        data: null,
      });
    }

    const { code, encryptedData, iv, inviteCode } = value;

    // 通过 code 获取 openid 和 session_key
    const wechatAuth = await wechatService.code2Session(code);

    // 解密手机号信息
    const phoneInfo = await wechatService.decryptData(
      wechatAuth.session_key,
      encryptedData,
      iv
    );

    if (!phoneInfo || !phoneInfo.phoneNumber) {
      return res.status(400).json({
        code: 400,
        message: "获取手机号失败",
        data: null,
      });
    }

    // 根据 openid 查找用户
    let user = await UserAdapterService.findUserByOpenid(wechatAuth.openid);

    if (!user) {
      // 尝试根据手机号查找用户
      user = await UserAdapterService.findUserByPhone(phoneInfo.phoneNumber);
    }

    if (user) {
      // 已注册用户，更新登录信息和手机号
      const updateData = {
        session_key: wechatAuth.session_key,
        phone_number: phoneInfo.phoneNumber,
        last_login_at: new Date(),
      };

      user = await UserAdapterService.createOrUpdateUser({
        ...user,
        ...updateData,
      });

      // 生成 token
      const token = JwtService.generateToken(user);

      logger.info(
        `用户手机号登录成功: ${user.openid}, 手机号: ${phoneInfo.phoneNumber}`
      );

      return res.json({
        code: 200,
        message: "登录成功",
        data: {
          isNewUser: false,
          token,
          userInfo: formatUserResponse(user),
          inviteCode: user.invite_code,
          inviteFrom: user.invite_from,
        },
      });
    } else {
      // 新用户，需要注册
      if (!inviteCode) {
        return res.status(400).json({
          code: 400,
          message: "新用户注册需要邀请码",
          data: {
            isNewUser: true,
            needInviteCode: true,
          },
        });
      }

      // 验证邀请码
      const validation = await UserAdapterService.validateInviteCode(
        inviteCode
      );
      if (!validation.valid) {
        return res.status(400).json({
          code: 400,
          message: validation.isSystemCode
            ? "系统邀请码已被使用"
            : "邀请码无效",
          data: null,
        });
      }

      // 生成用户邀请码
      const userInviteCode = await UserAdapterService.generateInviteCode();

      // 创建用户
      const defaultNickname = `用户${wechatAuth.openid.slice(-6)}`;

      const userData = {
        openid: wechatAuth.openid,
        session_key: wechatAuth.session_key,
        nickname: defaultNickname,
        avatar_url: "",
        phone_number: phoneInfo.phoneNumber,
        last_login_at: new Date(),
        login_count: 1,
        invite_code: userInviteCode,
        invite_from: inviteCode,
        inviter_id: validation.inviteUserInfo
          ? validation.inviteUserInfo.id
          : null,
      };

      const newUser = await UserAdapterService.createOrUpdateUser(userData);

      // 生成 token
      const token = JwtService.generateToken(newUser);

      logger.info(
        `用户手机号注册成功: ${newUser.openid}, 手机号: ${phoneInfo.phoneNumber}, 邀请码: ${inviteCode}`
      );

      return res.json({
        code: 200,
        message: "注册成功",
        data: {
          isNewUser: true,
          token,
          userInfo: formatUserResponse(newUser),
          inviteCode: newUser.invite_code,
          inviteFrom: newUser.invite_from,
        },
      });
    }
  } catch (error) {
    logger.error("手机号登录失败:", error);

    if (error.message.includes("微信接口错误")) {
      return res.status(400).json({
        code: 400,
        message: "微信登录验证失败，请重试",
        data: null,
      });
    }

    next(error);
  }
});

// 验证邀请码
router.post("/validateInviteCode", async (req, res, next) => {
  try {
    // 验证请求参数
    const { error, value } = validateInviteCodeSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        code: 400,
        message: error.details[0].message,
        data: null,
      });
    }

    const { inviteCode } = value;

    // 验证邀请码
    const validation = await UserAdapterService.validateInviteCode(inviteCode);

    if (validation.valid) {
      res.json({
        code: 200,
        message: "邀请码有效",
        data: {
          valid: true,
          inviteUserInfo: validation.inviteUserInfo,
        },
      });
    } else {
      res.json({
        code: 400,
        message: validation.isSystemCode ? "系统邀请码已被使用" : "邀请码无效",
        data: {
          valid: false,
          inviteUserInfo: null,
        },
      });
    }
  } catch (error) {
    logger.error("邀请码验证失败:", error);
    next(error);
  }
});

// 更新用户资料
router.post("/updateProfile", legacyAuthMiddleware, async (req, res, next) => {
  try {
    // 验证请求参数
    const { error, value } = updateProfileSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        code: 400,
        message: error.details[0].message,
        data: null,
      });
    }

    const { nickname, avatar_url, phone_number } = value;
    const user = req.user;

    if (!user) {
      return res.status(404).json({
        code: 404,
        message: "用户不存在",
        data: null,
      });
    }

    // 更新用户信息
    const updateData = {
      nickname: nickname || user.nickname,
      avatar_url: avatar_url || user.avatar_url,
      phone_number: phone_number || user.phone_number,
    };

    const updatedUser = await UserAdapterService.createOrUpdateUser({
      ...user,
      ...updateData,
    });

    logger.info(`用户资料更新成功: ${user.openid}`);

    res.json({
      code: 200,
      message: "用户资料更新成功",
      data: {
        userInfo: formatUserResponse(updatedUser),
      },
    });
  } catch (error) {
    logger.error("用户资料更新失败:", error);
    next(error);
  }
});

// 验证 Token
router.post("/verify", legacyAuthMiddleware, async (req, res, next) => {
  try {
    const user = req.user;

    res.json({
      success: true,
      message: "Token 验证成功",
      data: {
        userInfo: formatUserResponse(user),
        inviteCode: user.invite_code,
        inviteFrom: user.invite_from,
      },
    });
  } catch (error) {
    logger.error("Token 验证失败:", error);
    next(error);
  }
});

// 获取邀请统计信息
router.get("/inviteStats", legacyAuthMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const stats = await UserAdapterService.getInviteStats(userId);

    res.json({
      success: true,
      message: "获取邀请统计成功",
      data: {
        inviteCode: stats.inviteCode,
        invitedCount: stats.invitedCount,
      },
    });
  } catch (error) {
    logger.error("获取邀请统计失败:", error);
    next(error);
  }
});

module.exports = router;
