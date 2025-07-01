const axios = require("axios");

// 测试配置
const BASE_URL = "http://localhost:3000";
const TEST_INVITE_CODE = "AAA"; // 系统默认邀请码

// 测试手机号一键登录 API
async function testPhoneLoginAPI() {
  console.log("=== 测试手机号一键登录 API ===\n");

  try {
    // 1. 测试新用户手机号登录（需要邀请码）
    console.log("1. 测试新用户手机号登录（需要邀请码）");
    const userCode = "test_code_same_user"; // 使用相同的 code 来模拟同一用户
    const newUserResponse = await axios.post(
      `${BASE_URL}/api/auth/phoneLogin`,
      {
        code: userCode,
        encryptedData: "mock_encrypted_data",
        iv: "mock_iv",
        inviteCode: TEST_INVITE_CODE,
      }
    );

    console.log("新用户注册结果:");
    console.log("- Status:", newUserResponse.status);
    console.log("- Code:", newUserResponse.data.code);
    console.log("- Message:", newUserResponse.data.message);
    console.log("- IsNewUser:", newUserResponse.data.data.isNewUser);
    console.log("- Token:", newUserResponse.data.data.token ? "✓" : "✗");
    console.log("- 手机号:", newUserResponse.data.data.userInfo.phone_number);
    console.log("- 邀请码:", newUserResponse.data.data.inviteCode);
    console.log("");

    // 2. 测试老用户手机号登录（使用相同的 code，不需要邀请码）
    console.log("2. 测试老用户手机号登录（不需要邀请码）");
    const existingUserResponse = await axios.post(
      `${BASE_URL}/api/auth/phoneLogin`,
      {
        code: userCode, // 使用相同的 code
        encryptedData: "mock_encrypted_data",
        iv: "mock_iv",
      }
    );

    console.log("老用户登录结果:");
    console.log("- Status:", existingUserResponse.status);
    console.log("- Code:", existingUserResponse.data.code);
    console.log("- Message:", existingUserResponse.data.message);
    console.log("- IsNewUser:", existingUserResponse.data.data.isNewUser);
    console.log("- Token:", existingUserResponse.data.data.token ? "✓" : "✗");
    console.log(
      "- 手机号:",
      existingUserResponse.data.data.userInfo.phone_number
    );
    console.log("");

    // 3. 测试使用 token 获取用户信息
    console.log("3. 测试使用 token 获取用户信息");
    const token = newUserResponse.data.data.token;
    const profileResponse = await axios.get(`${BASE_URL}/api/user/profile`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    console.log("用户信息:");
    console.log("- Status:", profileResponse.status);
    console.log("- User ID:", profileResponse.data.data.user.id);
    console.log("- 昵称:", profileResponse.data.data.user.nickname);
    console.log("- 手机号:", profileResponse.data.data.user.phone_number);
    console.log("- OpenID: *** (已隐藏，不返回给前端)");
    console.log("");

    // 4. 测试更新用户信息（包含手机号）
    console.log("4. 测试更新用户信息");
    const updateResponse = await axios.put(
      `${BASE_URL}/api/user/profile`,
      {
        nickname: "测试用户手机号",
        phone_number: "13900139000",
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    console.log("更新结果:");
    console.log("- Status:", updateResponse.status);
    console.log("- 新昵称:", updateResponse.data.data.user.nickname);
    console.log("- 新手机号:", updateResponse.data.data.user.phone_number);
    console.log("");

    console.log("✅ 所有手机号登录测试通过！");
  } catch (error) {
    if (error.response) {
      console.error("❌ API 错误:");
      console.error("- Status:", error.response.status);
      console.error("- Code:", error.response.data?.code);
      console.error("- Message:", error.response.data?.message);
      console.error("- Data:", error.response.data?.data);
    } else {
      console.error("❌ 网络错误:", error.message);
    }
  }
}

// 测试新用户无邀请码的情况
async function testNewUserWithoutInviteCode() {
  console.log("=== 测试新用户无邀请码的情况 ===\n");

  try {
    const response = await axios.post(`${BASE_URL}/api/auth/phoneLogin`, {
      code: "test_code_no_invite",
      encryptedData: "mock_encrypted_data",
      iv: "mock_iv",
      // 不提供 inviteCode
    });

    console.log("不应该到达这里");
  } catch (error) {
    if (error.response && error.response.status === 400) {
      console.log("✅ 正确拒绝了没有邀请码的新用户");
      console.log("- Message:", error.response.data.message);
      console.log(
        "- NeedInviteCode:",
        error.response.data.data?.needInviteCode
      );
    } else {
      console.error("❌ 意外的错误:", error.response?.data || error.message);
    }
  }
  console.log("");
}

// 运行测试
async function runTests() {
  console.log("开始测试手机号登录功能...\n");

  await testPhoneLoginAPI();
  await testNewUserWithoutInviteCode();

  console.log("测试完成！");
}

runTests();
