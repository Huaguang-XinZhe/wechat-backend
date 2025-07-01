// 内存存储的用户模型 - 单例模式
class MemoryUser {
  constructor() {
    // 如果已经有实例，返回现有实例
    if (MemoryUser.instance) {
      return MemoryUser.instance;
    }

    // 内存存储：用户数据
    this.users = new Map();
    // 邀请码映射：邀请码 -> 用户ID
    this.inviteCodes = new Map();
    // 邀请关系：被邀请用户ID -> 邀请人用户ID
    this.inviteRelations = new Map();
    // 用于生成用户ID的计数器
    this.userIdCounter = 1;

    // 初始化系统默认邀请码
    this.systemInviteCode = "AAA";
    this.systemInviteCodeUsed = false;

    // 保存实例
    MemoryUser.instance = this;
  }

  // 生成6位随机邀请码
  generateInviteCode() {
    const chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    // 确保不重复
    if (this.inviteCodes.has(result)) {
      return this.generateInviteCode();
    }
    return result;
  }

  // 验证邀请码是否有效
  async validateInviteCode(inviteCode) {
    // 检查系统默认邀请码
    if (inviteCode === this.systemInviteCode) {
      return {
        valid: !this.systemInviteCodeUsed,
        isSystemCode: true,
        inviteUserInfo: null,
      };
    }

    // 检查用户邀请码
    const inviterUserId = this.inviteCodes.get(inviteCode);
    if (inviterUserId) {
      const inviterUser = this.users.get(inviterUserId);
      return {
        valid: true,
        isSystemCode: false,
        inviteUserInfo: {
          id: inviterUser.id,
          nickName: inviterUser.nickname,
        },
      };
    }

    return {
      valid: false,
      isSystemCode: false,
      inviteUserInfo: null,
    };
  }

  // 根据 openid 查找用户
  async findByOpenid(openid) {
    for (const [id, user] of this.users) {
      if (user.openid === openid) {
        return user;
      }
    }
    return null;
  }

  // 根据 ID 查找用户
  async findByPk(id) {
    return this.users.get(id) || null;
  }

  // 创建新用户
  async create(userData) {
    const userId = this.userIdCounter++;
    const now = new Date();

    // 生成用户邀请码
    const userInviteCode = this.generateInviteCode();

    const user = {
      id: userId,
      openid: userData.openid,
      unionid: userData.unionid || null,
      session_key: userData.session_key,
      nickname: userData.nickname || "",
      avatar_url: userData.avatar_url || "",
      phone_number: userData.phone_number || "",
      login_count: userData.login_count || 1,
      last_login_at: userData.last_login_at || now,
      created_at: now,
      updated_at: now,
      is_active: userData.is_active !== undefined ? userData.is_active : true,

      // 邀请码相关字段
      invite_code: userInviteCode, // 用户的分享邀请码
      invite_from: userData.invite_from || null, // 注册时使用的邀请码
      inviter_id: userData.inviter_id || null, // 邀请人ID

      // 添加更新方法
      update: async (updateData) => {
        Object.keys(updateData).forEach((key) => {
          if (
            key !== "id" &&
            key !== "openid" &&
            key !== "created_at" &&
            key !== "invite_code"
          ) {
            user[key] = updateData[key];
          }
        });
        user.updated_at = new Date();
        return user;
      },
    };

    this.users.set(userId, user);

    // 注册用户邀请码映射
    this.inviteCodes.set(userInviteCode, userId);

    // 如果有邀请人，记录邀请关系
    if (userData.inviter_id) {
      this.inviteRelations.set(userId, userData.inviter_id);
    }

    return user;
  }

  // 通过邀请码创建用户
  async createWithInviteCode(userData, inviteCode) {
    // 验证邀请码
    const validation = await this.validateInviteCode(inviteCode);
    if (!validation.valid) {
      throw new Error("邀请码无效");
    }

    // 准备用户数据
    const createData = {
      ...userData,
      invite_from: inviteCode,
      inviter_id: validation.isSystemCode
        ? null
        : this.inviteCodes.get(inviteCode),
    };

    // 如果使用系统邀请码，标记为已使用
    if (validation.isSystemCode) {
      this.systemInviteCodeUsed = true;
    }

    return await this.create(createData);
  }

  // 更新登录信息
  async updateLoginInfo(openid) {
    const user = await this.findByOpenid(openid);
    if (user) {
      user.login_count = (user.login_count || 0) + 1;
      user.last_login_at = new Date();
      user.updated_at = new Date();
      return user;
    }
    return null;
  }

  // 获取用户的邀请统计
  async getInviteStats(userId) {
    let invitedCount = 0;
    for (const [inviteeId, inviterId] of this.inviteRelations) {
      if (inviterId === userId) {
        invitedCount++;
      }
    }
    return {
      invitedCount,
      inviteCode: this.users.get(userId)?.invite_code,
    };
  }

  // 获取用户邀请的用户列表
  async getInvitedUsers(userId) {
    const invitedUsers = [];
    for (const [inviteeId, inviterId] of this.inviteRelations) {
      if (inviterId === userId) {
        const invitee = this.users.get(inviteeId);
        if (invitee) {
          invitedUsers.push({
            id: invitee.id,
            nickname: invitee.nickname,
            avatar_url: invitee.avatar_url,
            created_at: invitee.created_at,
          });
        }
      }
    }
    return invitedUsers;
  }

  // 获取所有用户（调试用）
  getAllUsers() {
    return Array.from(this.users.values());
  }

  // 清空所有用户（调试用）
  clearAll() {
    this.users.clear();
    this.inviteCodes.clear();
    this.inviteRelations.clear();
    this.userIdCounter = 1;
    this.systemInviteCodeUsed = false;
  }

  // 获取用户统计信息
  getStats() {
    return {
      totalUsers: this.users.size,
      lastUserId: this.userIdCounter - 1,
      totalInviteCodes: this.inviteCodes.size,
      systemInviteCodeUsed: this.systemInviteCodeUsed,
      totalInviteRelations: this.inviteRelations.size,
    };
  }

  // 获取邀请码相关统计（调试用）
  getInviteCodeStats() {
    return {
      systemInviteCode: this.systemInviteCode,
      systemInviteCodeUsed: this.systemInviteCodeUsed,
      userInviteCodes: Array.from(this.inviteCodes.entries()),
      inviteRelations: Array.from(this.inviteRelations.entries()),
    };
  }
}

// 创建单例实例
const memoryUserInstance = new MemoryUser();

module.exports = memoryUserInstance;
