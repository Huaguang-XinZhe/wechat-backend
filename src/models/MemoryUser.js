// 内存存储的用户模型
class MemoryUser {
  constructor() {
    // 内存存储：用户数据
    this.users = new Map();
    // 用于生成用户ID的计数器
    this.userIdCounter = 1;
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

    const user = {
      id: userId,
      openid: userData.openid,
      unionid: userData.unionid || null,
      session_key: userData.session_key,
      nickname: userData.nickname || "",
      avatar_url: userData.avatar_url || "",
      gender: userData.gender || 0,
      country: userData.country || "",
      province: userData.province || "",
      city: userData.city || "",
      language: userData.language || "",
      login_count: userData.login_count || 1,
      last_login_at: userData.last_login_at || now,
      created_at: now,
      updated_at: now,
      // 添加更新方法
      update: async (updateData) => {
        Object.keys(updateData).forEach((key) => {
          if (key !== "id" && key !== "openid" && key !== "created_at") {
            user[key] = updateData[key];
          }
        });
        user.updated_at = new Date();
        return user;
      },
    };

    this.users.set(userId, user);
    return user;
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

  // 获取所有用户（调试用）
  getAllUsers() {
    return Array.from(this.users.values());
  }

  // 清空所有用户（调试用）
  clearAll() {
    this.users.clear();
    this.userIdCounter = 1;
  }

  // 获取用户统计信息
  getStats() {
    return {
      totalUsers: this.users.size,
      lastUserId: this.userIdCounter - 1,
    };
  }
}

// 创建单例实例
const memoryUserInstance = new MemoryUser();

module.exports = memoryUserInstance;
