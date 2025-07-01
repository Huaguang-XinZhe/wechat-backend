// 邀请码功能 API 测试脚本
const axios = require("axios");

const BASE_URL = "http://localhost:3000";

// 测试用的微信用户信息
const mockUsers = [
  {
    openid: "mock_openid_001",
    userInfo: {
      nickName: "商户用户",
      avatarUrl: "https://example.com/avatar1.jpg",
      gender: 1,
      country: "中国",
      province: "北京",
      city: "北京",
      language: "zh_CN",
    },
  },
  {
    openid: "mock_openid_002",
    userInfo: {
      nickName: "普通用户1",
      avatarUrl: "https://example.com/avatar2.jpg",
      gender: 2,
      country: "中国",
      province: "上海",
      city: "上海",
      language: "zh_CN",
    },
  },
  {
    openid: "mock_openid_003",
    userInfo: {
      nickName: "普通用户2",
      avatarUrl: "https://example.com/avatar3.jpg",
      gender: 1,
      country: "中国",
      province: "广东",
      city: "深圳",
      language: "zh_CN",
    },
  },
];

// HTTP 请求配置
const requestConfig = {
  headers: {
    "Content-Type": "application/json",
    "ngrok-skip-browser-warning": "true",
  },
};

// 存储测试过程中的数据
let merchantToken = "";
let merchantInviteCode = "";
let userTokens = [];

// 日志函数
function log(title, data) {
  console.log(`\n=== ${title} ===`);
  console.log(JSON.stringify(data, null, 2));
}

// 错误处理函数
function handleError(error, context) {
  console.error(`\n❌ ${context} 失败:`);
  if (error.response) {
    console.error("Status:", error.response.status);
    console.error("Data:", error.response.data);
  } else {
    console.error("Error:", error.message);
  }
}

// 测试流程
async function runTests() {
  try {
    console.log("🚀 开始测试邀请码功能...\n");

    // 1. 检查系统状态
    console.log("1. 检查系统状态");
    const statusResponse = await axios.get(
      `${BASE_URL}/api/debug/status`,
      requestConfig
    );
    log("系统状态", statusResponse.data);

    // 2. 验证系统默认邀请码
    console.log("\n2. 验证系统默认邀请码 AAA");
    const validateSystemCodeResponse = await axios.post(
      `${BASE_URL}/api/auth/validateInviteCode`,
      {
        inviteCode: "AAA",
      },
      requestConfig
    );
    log("系统邀请码验证结果", validateSystemCodeResponse.data);

    // 3. 商户通过系统邀请码注册
    console.log("\n3. 商户通过系统邀请码 AAA 注册");
    const merchantRegisterResponse = await axios.post(
      `${BASE_URL}/api/auth/registerWithInviteCode`,
      {
        openid: mockUsers[0].openid,
        userInfo: mockUsers[0].userInfo,
        inviteCode: "AAA",
      },
      requestConfig
    );
    log("商户注册结果", merchantRegisterResponse.data);

    if (merchantRegisterResponse.data.code === 200) {
      merchantToken = merchantRegisterResponse.data.data.token;
      merchantInviteCode = merchantRegisterResponse.data.data.inviteCode;
      console.log(`✅ 商户注册成功，邀请码: ${merchantInviteCode}`);
    }

    // 4. 再次验证系统邀请码（应该失效）
    console.log("\n4. 再次验证系统邀请码（应该已失效）");
    const validateSystemCodeAgainResponse = await axios.post(
      `${BASE_URL}/api/auth/validateInviteCode`,
      {
        inviteCode: "AAA",
      },
      requestConfig
    );
    log("系统邀请码再次验证结果", validateSystemCodeAgainResponse.data);

    // 5. 验证商户邀请码
    console.log("\n5. 验证商户邀请码");
    const validateMerchantCodeResponse = await axios.post(
      `${BASE_URL}/api/auth/validateInviteCode`,
      {
        inviteCode: merchantInviteCode,
      },
      requestConfig
    );
    log("商户邀请码验证结果", validateMerchantCodeResponse.data);

    // 6. 第一个用户通过商户邀请码注册
    console.log("\n6. 用户1 通过商户邀请码注册");
    const user1RegisterResponse = await axios.post(
      `${BASE_URL}/api/auth/registerWithInviteCode`,
      {
        openid: mockUsers[1].openid,
        userInfo: mockUsers[1].userInfo,
        inviteCode: merchantInviteCode,
      },
      requestConfig
    );
    log("用户1注册结果", user1RegisterResponse.data);

    if (user1RegisterResponse.data.code === 200) {
      userTokens.push(user1RegisterResponse.data.data.token);
      console.log("✅ 用户1注册成功");
    }

    // 7. 第二个用户通过商户邀请码注册
    console.log("\n7. 用户2 通过商户邀请码注册");
    const user2RegisterResponse = await axios.post(
      `${BASE_URL}/api/auth/registerWithInviteCode`,
      {
        openid: mockUsers[2].openid,
        userInfo: mockUsers[2].userInfo,
        inviteCode: merchantInviteCode,
      },
      requestConfig
    );
    log("用户2注册结果", user2RegisterResponse.data);

    if (user2RegisterResponse.data.code === 200) {
      userTokens.push(user2RegisterResponse.data.data.token);
      console.log("✅ 用户2注册成功");
    }

    // 8. 查看商户的邀请统计
    console.log("\n8. 查看商户的邀请统计");
    const merchantStatsResponse = await axios.get(
      `${BASE_URL}/api/auth/inviteStats`,
      {
        headers: {
          ...requestConfig.headers,
          Authorization: `Bearer ${merchantToken}`,
        },
      }
    );
    log("商户邀请统计", merchantStatsResponse.data);

    // 9. 测试用户重复注册
    console.log("\n9. 测试用户1重复注册（应该失败）");
    try {
      const duplicateRegisterResponse = await axios.post(
        `${BASE_URL}/api/auth/registerWithInviteCode`,
        {
          openid: mockUsers[1].openid,
          userInfo: mockUsers[1].userInfo,
          inviteCode: merchantInviteCode,
        },
        requestConfig
      );
      log("重复注册结果", duplicateRegisterResponse.data);
    } catch (error) {
      console.log("✅ 重复注册被正确拒绝");
      log("重复注册错误", error.response?.data || error.message);
    }

    // 10. 测试无效邀请码
    console.log("\n10. 测试无效邀请码");
    try {
      const invalidCodeResponse = await axios.post(
        `${BASE_URL}/api/auth/validateInviteCode`,
        {
          inviteCode: "INVALID123",
        },
        requestConfig
      );
      log("无效邀请码验证结果", invalidCodeResponse.data);
    } catch (error) {
      log("无效邀请码错误", error.response?.data || error.message);
    }

    // 11. 查看所有用户信息（调试）
    console.log("\n11. 查看所有用户信息（调试）");
    const allUsersResponse = await axios.get(
      `${BASE_URL}/api/debug/users`,
      requestConfig
    );
    log("所有用户信息", allUsersResponse.data);

    // 12. 查看邀请码统计（调试）
    console.log("\n12. 查看邀请码统计（调试）");
    const inviteCodesResponse = await axios.get(
      `${BASE_URL}/api/debug/invite-codes`,
      requestConfig
    );
    log("邀请码统计", inviteCodesResponse.data);

    console.log("\n🎉 所有测试完成！");
  } catch (error) {
    handleError(error, "测试流程");
  }
}

// 清理测试数据
async function cleanup() {
  try {
    console.log("\n🧹 清理测试数据...");
    const clearResponse = await axios.delete(
      `${BASE_URL}/api/debug/clear`,
      requestConfig
    );
    log("清理结果", clearResponse.data);
    console.log("✅ 测试数据已清理");
  } catch (error) {
    handleError(error, "清理数据");
  }
}

// 主函数
async function main() {
  console.log("邀请码功能完整测试");
  console.log("请确保后端服务已启动 (npm run dev)");
  console.log("测试地址:", BASE_URL);

  // 等待用户确认
  await new Promise((resolve) => {
    const readline = require("readline");
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question("\n按回车键开始测试...", () => {
      rl.close();
      resolve();
    });
  });

  // 清理之前的数据
  await cleanup();

  // 运行测试
  await runTests();

  console.log("\n测试完成！你可以通过以下方式查看详细信息:");
  console.log(`- 系统状态: GET ${BASE_URL}/api/debug/status`);
  console.log(`- 用户列表: GET ${BASE_URL}/api/debug/users`);
  console.log(`- 邀请码统计: GET ${BASE_URL}/api/debug/invite-codes`);
}

// 运行测试
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  runTests,
  cleanup,
  BASE_URL,
  mockUsers,
};
