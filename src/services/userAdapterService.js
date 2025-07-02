const { UmsMember, UmsMemberWechat } = require("../models/legacy");
const logger = require("../utils/logger");
const bcrypt = require("bcrypt");

class UserAdapterService {
  /**
   * 将 openid 转换为 base64 编码
   * @param {string} openid 原始 openid
   * @returns {string} base64 编码后的 openid
   */
  static encodeOpenidToBase64(openid) {
    if (!openid) return openid;
    return Buffer.from(openid).toString("base64");
  }

  /**
   * 将 base64 编码的 openid 解码回原始 openid
   * @param {string} base64Openid base64 编码的 openid
   * @returns {string} 原始 openid
   */
  static decodeOpenidFromBase64(base64Openid) {
    if (!base64Openid) return base64Openid;
    try {
      return Buffer.from(base64Openid, "base64").toString();
    } catch (error) {
      logger.error("解码 base64 openid 失败:", error);
      return base64Openid; // 如果解码失败，返回原值
    }
  }

  /**
   * 根据 openid 查找用户
   * @param {string} openid 微信 openid
   * @returns {Promise<Object>} 完整用户信息
   */
  static async findUserByOpenid(openid) {
    try {
      logger.info(`查找用户，输入 openid: ${openid}`);

      // 检测输入的 openid 是否已经是 base64 编码的
      let actualOpenid = openid;
      let isInputBase64 = false;

      // 检查是否是 base64 格式（长度是4的倍数，且只包含 base64 字符）
      if (
        /^[A-Za-z0-9+/]+=*$/.test(openid) &&
        openid.length % 4 === 0 &&
        openid.length > 20
      ) {
        try {
          const decoded = this.decodeOpenidFromBase64(openid);
          // 如果解码后的值看起来像是微信 openid（以 o 开头且长度合适），那么输入可能是 base64 编码的
          if (
            decoded.startsWith("o") &&
            decoded.length > 15 &&
            decoded.length < 35
          ) {
            actualOpenid = decoded;
            isInputBase64 = true;
            logger.info(
              `检测到输入是 base64 编码的 openid，解码为: ${actualOpenid}`
            );
          }
        } catch (error) {
          // 解码失败，说明不是有效的 base64，保持原值
        }
      }

      // 将实际的原始 openid 编码为 base64 用于查找用户表
      const base64Openid = this.encodeOpenidToBase64(actualOpenid);
      logger.info(
        `实际原始 openid: ${actualOpenid}, base64 username: ${base64Openid}`
      );

      // 使用实际的原始 openid 查找微信扩展表
      logger.info(`使用实际原始 openid 查找微信扩展表: ${actualOpenid}`);
      let wechatInfo = await UmsMemberWechat.findByPk(actualOpenid);

      if (!wechatInfo) {
        logger.info(`在微信扩展表中未找到用户: ${actualOpenid}`);
        return null;
      }

      logger.info(`在微信扩展表中找到用户: ${actualOpenid}`);

      // 使用 base64 编码的 openid 查找关联的用户
      logger.info(`使用 base64 username 查找用户表: ${base64Openid}`);
      const member = await UmsMember.findOne({
        where: { username: base64Openid },
      });

      if (member) {
        logger.info(`在用户表中找到用户: ${member.id}`);
        // 转换为内存用户格式，传入实际的原始 openid
        return this.toLegacyUserFormat(member, wechatInfo, actualOpenid);
      }

      logger.info(`在用户表中未找到用户`);
      return null;
    } catch (error) {
      logger.error("根据 openid 查找用户失败:", error);
      return null;
    }
  }

  /**
   * 生成密码哈希
   * @param {string} password 原始密码
   * @returns {Promise<string>} 哈希后的密码
   */
  static async hashPassword(password) {
    try {
      const saltRounds = 10;
      return await bcrypt.hash(password, saltRounds);
    } catch (error) {
      logger.error("密码哈希生成失败:", error);
      throw error;
    }
  }

  /**
   * 根据手机号查找用户
   * @param {string} phone 手机号
   * @returns {Promise<Object>} 完整用户信息
   */
  static async findUserByPhone(phone) {
    try {
      // 查找用户表
      const member = await UmsMember.findOne({
        where: { phone },
      });

      if (!member) {
        return null;
      }

      // 查找关联的微信信息 - 需要通过 username 反向查找
      // member.username 是 base64 编码的 openid，需要解码后查找微信表
      const originalOpenid = this.decodeOpenidFromBase64(member.username);
      const wechatInfo = await UmsMemberWechat.findByPk(originalOpenid);

      // 转换为内存用户格式
      return this.toLegacyUserFormat(member, wechatInfo, originalOpenid);
    } catch (error) {
      logger.error("根据手机号查找用户失败:", error);
      return null;
    }
  }

  /**
   * 根据用户ID查找用户
   * @param {number} id 用户ID
   * @returns {Promise<Object>} 完整用户信息
   */
  static async findUserById(id) {
    try {
      // 查找用户表
      const member = await UmsMember.findByPk(id);

      if (!member) {
        return null;
      }

      // 查找关联的微信信息 - 需要通过 username 反向查找
      // member.username 是 base64 编码的 openid，需要解码后查找微信表
      const originalOpenid = this.decodeOpenidFromBase64(member.username);
      const wechatInfo = await UmsMemberWechat.findByPk(originalOpenid);

      // 转换为内存用户格式
      return this.toLegacyUserFormat(member, wechatInfo, originalOpenid);
    } catch (error) {
      logger.error("根据ID查找用户失败:", error);
      return null;
    }
  }

  /**
   * 创建或更新用户
   * @param {Object} userData 用户数据
   * @returns {Promise<Object>} 创建或更新后的完整用户信息
   */
  static async createOrUpdateUser(userData) {
    try {
      let member = null;
      let wechatInfo = null;
      let isNewUser = false;
      let base64Openid = null;

      // 根据 openid 查找微信扩展信息
      if (userData.openid) {
        base64Openid = this.encodeOpenidToBase64(userData.openid);
        logger.debug(
          `查找用户，原始 openid: ${userData.openid}, base64 username: ${base64Openid}`
        );
        // 微信扩展表使用原始 openid 作为主键
        wechatInfo = await UmsMemberWechat.findByPk(userData.openid);
      }

      // 如果找到微信信息，查找对应的用户
      if (wechatInfo) {
        member = await UmsMember.findOne({
          where: { username: base64Openid },
        });
      }

      // 如果没找到用户但有手机号，尝试根据手机号查找用户
      if (!member && userData.phone_number) {
        member = await UmsMember.findOne({
          where: { phone: userData.phone_number },
        });
      }

      // 开始事务
      const transaction = await UmsMember.sequelize.transaction();

      try {
        // 如果没找到用户，创建新用户
        if (!member) {
          // 生成默认密码的哈希
          const defaultPassword = "member123"; // 使用固定的默认密码
          const passwordHash = await this.hashPassword(defaultPassword);

          // 使用 base64 编码的 openid 作为用户名
          const username = base64Openid || `wx_user_${Date.now()}`;
          logger.info(`创建新用户，使用 base64 用户名: ${username}`);

          // 创建主表用户
          member = await UmsMember.create(
            {
              username: username,
              password: passwordHash, // 设置哈希后的密码
              nickname: userData.nickname || "",
              phone: userData.phone_number || null,
              icon: userData.avatar_url || null,
              status: userData.is_active ? 1 : 0,
              create_time: new Date(),
              source_type: 1, // 微信小程序来源
            },
            { transaction }
          );
          isNewUser = true;
        } else {
          // 更新用户信息
          await member.update(
            {
              nickname: userData.nickname || member.nickname,
              phone: userData.phone_number || member.phone,
              icon: userData.avatar_url || member.icon,
              status:
                userData.is_active !== undefined
                  ? userData.is_active
                    ? 1
                    : 0
                  : member.status,
            },
            { transaction }
          );
        }

        // 处理微信扩展信息
        if (wechatInfo) {
          // 更新微信信息
          await wechatInfo.update(
            {
              invite_code: userData.invite_code || wechatInfo.invite_code,
              invite_from: userData.invite_from || wechatInfo.invite_from,
              inviter_id: userData.inviter_id || wechatInfo.inviter_id,
            },
            { transaction }
          );
        } else if (userData.openid) {
          // 为新用户生成邀请码
          const inviteCode =
            userData.invite_code || (await this.generateInviteCode());
          logger.info(`为新用户 ${userData.openid} 生成邀请码: ${inviteCode}`);

          // 创建新的微信信息，openid 字段保持原始值
          const wechatData = {
            openid: userData.openid, // 使用原始 openid
            invite_code: inviteCode, // 使用生成的邀请码
            invite_from: userData.invite_from || null,
            inviter_id: userData.inviter_id || null,
          };
          logger.info(
            `准备创建微信扩展信息，数据: ${JSON.stringify(wechatData)}`
          );

          wechatInfo = await UmsMemberWechat.create(wechatData, {
            transaction,
          });

          logger.info(
            `微信扩展信息创建完成，实际保存的数据: openid=${wechatInfo.openid}, invite_from=${wechatInfo.invite_from}, invite_code=${wechatInfo.invite_code}`
          );
        }

        // 提交事务
        await transaction.commit();

        // 转换为内存用户格式，传入原始 openid
        const legacyUser = this.toLegacyUserFormat(
          member,
          wechatInfo,
          userData.openid
        );
        legacyUser.isNewUser = isNewUser;

        return legacyUser;
      } catch (error) {
        // 回滚事务
        await transaction.rollback();
        throw error;
      }
    } catch (error) {
      logger.error("创建或更新用户失败:", error);
      throw error;
    }
  }

  /**
   * 验证邀请码
   * @param {string} inviteCode 邀请码
   * @returns {Promise<Object>} 验证结果
   */
  static async validateInviteCode(inviteCode) {
    try {
      logger.info(`验证邀请码: ${inviteCode}`);

      // 检查系统默认邀请码
      if (inviteCode === "AAA") {
        logger.info(`系统邀请码 AAA 验证通过`);
        // 可以在这里添加逻辑限制系统邀请码的使用次数
        return {
          valid: true,
          isSystemCode: true,
          inviteUserInfo: null,
        };
      }

      // 查找用户邀请码
      const wechatInfo = await UmsMemberWechat.findOne({
        where: { invite_code: inviteCode },
      });

      if (wechatInfo) {
        // 查找邀请人
        const inviter = await UmsMember.findByPk(wechatInfo.inviter_id);

        if (inviter) {
          return {
            valid: true,
            isSystemCode: false,
            inviteUserInfo: {
              id: inviter.id,
              nickName: inviter.nickname,
            },
          };
        }
      }

      return {
        valid: false,
        isSystemCode: false,
        inviteUserInfo: null,
      };
    } catch (error) {
      logger.error("验证邀请码失败:", error);
      return {
        valid: false,
        isSystemCode: false,
        inviteUserInfo: null,
      };
    }
  }

  /**
   * 生成邀请码
   * @returns {Promise<string>} 生成的邀请码
   */
  static async generateInviteCode() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let code;
    let isUnique = false;

    while (!isUnique) {
      code = "";
      for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }

      // 验证是否已存在
      const existing = await UmsMemberWechat.findOne({
        where: { invite_code: code },
      });

      isUnique = !existing;
    }

    return code;
  }

  /**
   * 获取邀请统计
   * @param {number} userId 用户ID
   * @returns {Promise<Object>} 邀请统计信息
   */
  static async getInviteStats(userId) {
    try {
      // 查找用户的用户名
      const member = await UmsMember.findByPk(userId);

      if (!member) {
        logger.debug(`未找到用户: ${userId}`);
        return {
          invitedCount: 0,
          inviteCode: null,
        };
      }

      logger.debug(`找到用户: ${member.id}, username: ${member.username}`);

      // username 存储的是 base64 编码的 openid，需要解码后查找微信信息
      const base64Openid = member.username;
      const originalOpenid = this.decodeOpenidFromBase64(base64Openid);
      logger.debug(
        `查找微信信息，base64 username: ${base64Openid}, 原始 openid: ${originalOpenid}`
      );
      const wechatInfo = await UmsMemberWechat.findByPk(originalOpenid);

      if (!wechatInfo) {
        logger.debug(`未找到微信信息: ${originalOpenid}`);
        return {
          invitedCount: 0,
          inviteCode: null,
        };
      }

      logger.debug(
        `找到微信信息: ${wechatInfo.openid}, invite_code: ${wechatInfo.invite_code}`
      );

      // 查找被邀请的用户数量
      const invitedCount = await UmsMemberWechat.count({
        where: { inviter_id: userId },
      });

      logger.debug(`被邀请用户数量: ${invitedCount}`);

      return {
        invitedCount,
        inviteCode: wechatInfo.invite_code,
      };
    } catch (error) {
      logger.error("获取邀请统计失败:", error);
      return {
        invitedCount: 0,
        inviteCode: null,
      };
    }
  }

  /**
   * 将老系统用户数据转换为内存用户格式
   * @param {Object} member 主表用户数据
   * @param {Object} wechatInfo 微信扩展表数据
   * @param {string} originalOpenid 原始 openid
   * @returns {Object} 转换后的用户数据
   */
  static toLegacyUserFormat(member, wechatInfo, originalOpenid) {
    if (!member) return null;

    // 创建一个包含内存用户所需所有字段的对象
    const user = {
      id: member.id,
      openid: originalOpenid,
      nickname: member.nickname || "",
      avatar_url: member.icon || "",
      phone_number: member.phone || "",
      created_at: member.create_time,
      is_active: member.status === 1,

      // 邀请码相关字段
      invite_code: wechatInfo ? wechatInfo.invite_code : null,
      invite_from: wechatInfo ? wechatInfo.invite_from : null,
      inviter_id: wechatInfo ? wechatInfo.inviter_id : null,

      // 添加更新方法模拟内存用户的行为
      update: async (updateData) => {
        // 在这里实现更新逻辑，或者直接调用 createOrUpdateUser
        const updatedUser = await this.createOrUpdateUser({
          ...user,
          ...updateData,
        });

        // 更新当前对象的属性
        Object.keys(updatedUser).forEach((key) => {
          if (key !== "update") {
            user[key] = updatedUser[key];
          }
        });

        return user;
      },
    };

    return user;
  }

  /**
   * 列出用户（用于调试）
   * @param {number} limit 最大返回数量
   * @returns {Promise<Array>} 用户列表
   */
  static async listUsers(limit = 20) {
    try {
      // 查询主表用户
      const members = await UmsMember.findAll({
        limit,
        order: [["id", "DESC"]],
      });

      // 组装结果
      const users = [];
      for (const member of members) {
        // 查找对应的微信信息，member.username 是 base64 编码的 openid
        const originalOpenid = this.decodeOpenidFromBase64(member.username);
        const wechatInfo = await UmsMemberWechat.findByPk(originalOpenid);
        if (wechatInfo || member) {
          users.push(
            this.toLegacyUserFormat(member, wechatInfo, originalOpenid)
          );
        }
      }

      return users;
    } catch (error) {
      logger.error("列出用户失败:", error);
      return [];
    }
  }

  /**
   * 清空开发环境的用户数据（仅在开发环境中可用）
   * @returns {Promise<boolean>} 是否成功
   */
  static async clearAllDevelopmentUsers() {
    if (process.env.NODE_ENV !== "development") {
      logger.error("尝试在非开发环境清空用户数据");
      return false;
    }

    try {
      // 开始事务
      const transaction = await UmsMember.sequelize.transaction();

      try {
        // 清空微信扩展表
        await UmsMemberWechat.destroy({
          where: {},
          truncate: true,
          cascade: true,
          transaction,
        });

        // 仅删除来自微信小程序的用户（source_type = 1）
        await UmsMember.destroy({
          where: { source_type: 1 },
          transaction,
        });

        // 提交事务
        await transaction.commit();

        logger.info("开发环境用户数据已清空");
        return true;
      } catch (error) {
        // 回滚事务
        await transaction.rollback();
        throw error;
      }
    } catch (error) {
      logger.error("清空开发环境用户数据失败:", error);
      return false;
    }
  }
}

module.exports = UserAdapterService;
