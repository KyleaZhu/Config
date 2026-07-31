export default {
  // 1. 定时触发器
  async scheduled(event, env, ctx) {
    ctx.waitUntil(this.runCheckinAndNotify(env));
  },

  // 2. 核心控制流
  async runCheckinAndNotify(env) {
    let message = "";
    try {
      // 第一步：根据接口进行自动登录
      const currentCookie = await this.doLogin(env);

      // 第二步：使用登录成功拿到的新 Cookie 去签到
      await this.doCheckin(currentCookie);

      // 第三步：获取签到统计数据
      const stats = await this.getCheckinStats(currentCookie);

      // 第四步：获取账号信息（余额、消耗、请求次数）
      const account = await this.getAccountInfo(currentCookie);

      // 格式化通知消息
      const fmt = (n) => (n / 500000).toFixed(2);
      const todayAward = stats.records[0]?.quota_awarded ?? 0;

      message = [
        "✅ <b>自动签到成功</b>",
        "",
        `📅 <b>签到日期:</b> ${stats.records[0]?.checkin_date ?? "未知"}`,
        `💰 <b>本次奖励:</b> $${fmt(todayAward)}`,
        `📊 <b>累计签到:</b> ${stats.total_checkins} 天`,
        `🏦 <b>累计奖励:</b> $${fmt(stats.total_quota)}`,
        `💳 <b>当前余额:</b> $${fmt(account.quota ?? 0)}`,
        `📉 <b>历史消耗:</b> $${fmt(account.used_quota ?? 0)}`,
        `🔢 <b>请求次数:</b> ${account.request_count ?? 0}`,
      ].join("\n");
    } catch (error) {
      message = `❌ <b>任务执行失败</b>\n\n<b>错误信息:</b>\n<code>${error.message}</code>`;
    }

    // 第五步：发送 Telegram 通知
    await this.sendTelegramMessage(message, env);
  },

  // 3. 自动登录
  async doLogin(env) {
    const loginUrl = "https://fast.qianxing.pro/api/user/login?turnstile="; 
    
    const account = env.USER_ACCOUNT; 
    const password = env.USER_PASSWORD;

    if (!account || !password) {
      throw new Error("Cloudflare 后台未配置环境变量 USER_ACCOUNT 或 USER_PASSWORD");
    }

    // 构造请求头，严格模拟浏览器行为
    const headers = {
      "accept": "application/json, text/plain, */*",
      "content-type": "application/json",
      "origin": "https://fast.qianxing.pro",
      "referer": "https://fast.qianxing.pro/sign-in",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36 Edg/150.0.0.0"
    };

    // 严格匹配负载格式：username 和 password
    const payload = {
      username: account,
      password: password
    };

    const response = await fetch(loginUrl, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`登录请求失败，HTTP 状态码: ${response.status}`);
    }

    // 从响应头中提取服务器颁发的 Set-Cookie
    const setCookieHeader = response.headers.get("Set-Cookie");
    if (!setCookieHeader) {
      throw new Error("登录成功，但服务器未返回 Set-Cookie。请检查账号密码是否正确。");
    }

    // 正则提取完整的 session=xxxxxx
    const match = setCookieHeader.match(/session=([^;]+)/);
    if (match) {
      return match[0]; 
    } else {
      throw new Error("未能从响应头中解析出有效的 session Cookie");
    }
  },

  // 4. 自动签到
  async doCheckin(cookie) {
    const url = "https://fast.qianxing.pro/api/user/checkin";
    const headers = {
      "accept": "application/json, text/plain, */*",
      "cookie": cookie, // 动态传入刚刚登录获取的最新 Cookie
      "origin": "https://fast.qianxing.pro",
      "referer": "https://fast.qianxing.pro/console/personal",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36 Edg/150.0.0.0"
    };

    const response = await fetch(url, { method: "POST", headers: headers });
    
    if (!response.ok) {
      throw new Error(`签到请求失败，HTTP 状态码: ${response.status}`);
    }
  },

  // 5. 获取签到统计
  async getCheckinStats(cookie) {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const url = `https://fast.qianxing.pro/api/user/checkin?month=${month}`;
    const headers = {
      "accept": "application/json, text/plain, */*",
      "cookie": cookie,
      "origin": "https://fast.qianxing.pro",
      "referer": "https://fast.qianxing.pro/console/personal",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36 Edg/150.0.0.0"
    };

    const response = await fetch(url, { method: "GET", headers: headers });

    if (!response.ok) {
      throw new Error(`获取签到统计失败，HTTP 状态码: ${response.status}`);
    }

    const json = await response.json();

    if (!json.success || !json.data?.stats) {
      throw new Error("获取签到统计失败：接口返回异常");
    }

    return json.data.stats;
  },

  // 6. 获取账号信息（余额、消耗、请求次数）
  async getAccountInfo(cookie) {
    const url = "https://fast.qianxing.pro/api/user/self";
    const headers = {
      "accept": "application/json, text/plain, */*",
      "cookie": cookie,
      "origin": "https://fast.qianxing.pro",
      "referer": "https://fast.qianxing.pro/console/topup",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36 Edg/150.0.0.0"
    };

    const response = await fetch(url, { method: "GET", headers: headers });

    if (!response.ok) {
      throw new Error(`获取账号信息失败，HTTP 状态码: ${response.status}`);
    }

    const json = await response.json();

    if (!json.success || !json.data) {
      throw new Error("获取账号信息失败：接口返回异常");
    }

    return json.data;
  },

  // 7. Telegram 通知
  async sendTelegramMessage(text, env) {
    const botToken = env.TG_BOT_TOKEN;
    const chatId = env.TG_CHAT_ID;
    if (!botToken || !chatId) return;

    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: "HTML" })
    });
  }
};
