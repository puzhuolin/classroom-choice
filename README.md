# 共和国抉择 · 课堂实时互动系统

教师控制台 + 学生端 + 后端，实时（1 秒轮询）同步。零第三方依赖，`node server.js` 即可运行。

## 功能
- 教师端 `/teacher`：实时查看各选项票数、按 4 组的分布、谁已作答/未答；一键控制「开始/开放投票/结束本轮/上一环节/下一环节/结束课堂」；投影学生二维码；结束显示小组排名。
- 学生端 `/s`：微信/相机扫码进入 → 输入名字 → 自动随机分到 4 组 → 按老师开放的环节作答（可修改）→ 结束后显示本轮结果。
- 6 个环节对应第七章历史抉择，每组按多数选项累计「教育/科技/人才」，最终出综合国力排名与结局。

## 本地运行
```bash
cd classroom-app
node server.js
# 教师端 http://localhost:3000/teacher
# 学生端 http://localhost:3000/s
```

## 部署到 Replit（推荐，免 GitHub）

1. 注册/登录 https://replit.com → **Create Repl** → 选 **Node.js** 模板 → 起名 → Create。
2. 左侧文件面板把本 `classroom-app` 解压后的文件拖进去：`server.js`、`index.js`、`package.json`、`.replit`、`public/` 文件夹（确保 `server.js` 与 `public/` 在根目录）。
3. 点顶部 **Run**，控制台出现「课堂实时系统已启动」即成功。
4. 右侧 Webview 显示页面；点 **Open in new tab** 得到公网网址 `https://xxx.replit.dev`。
   - 教师端：`https://xxx.replit.dev/teacher`
   - 学生端：二维码自动指向 `https://xxx.replit.dev/s`。

> 免费 Repl 空闲会休眠，访问即唤醒；常驻可开付费 Always On。

## 部署到 Railway

（如果你改用 Railway：连 GitHub 仓库即可，项目已含 `railway.json`）

项目已含 `railway.json`（启动命令 `node server.js`、健康检查 `/api/state`），连上仓库即可自动部署。

1. 把本 `classroom-app` 目录上传成 GitHub 仓库（GitHub 网页 → New repository → Add file → Upload files → 拖入 `server.js`、`package.json`、`Dockerfile`、`railway.json`、`README.md` 及 `public/` 文件夹 → Commit）。确保 `server.js` 在仓库根目录。
2. 打开 https://railway.app → **Sign in with GitHub**。
3. **New Project → Deploy from GitHub repo** → 选择刚建的仓库 → 授权并确认部署。
4. Railway 自动识别 Node 并读取 `railway.json`，无需填写构建/启动命令。
5. 进入服务 → **Settings → Networking → Generate Domain**，得到一个 `https://xxx.up.railway.app` 公网域名。
6. 使用：
   - 教师端：`https://xxx.up.railway.app/teacher`
   - 学生端：二维码自动指向 `https://xxx.up.railway.app/s`，学生微信扫码即可。

> Railway 新账号有一次性试用额度，之后为付费订阅（约 $5/月起）。若想完全免费可用 Render（见下）。

## 备选：Render（免费，但会休眠）
1. 注册 https://render.com → New → **Web Service** → 连接同一 GitHub 仓库。
2. Environment: `Node`；Build Command 留空；Start Command `node server.js`；Instance `Free`。
3. 部署后得到 `https://xxx.onrender.com`，教师端加 `/teacher`、学生端加 `/s`。

## 备选：任意支持 Docker 的平台
本目录含 `Dockerfile`，直接构建运行，暴露 `PORT` 即可。

## 注意
- 数据存于内存，**服务重启/重新部署会清空**（适合单堂课；跨天请每天重新「开始上课」）。
- 免费/低配实例长时间无人访问可能休眠，正式上课前先打开一次教师端唤醒。
- 学生端用微信扫码时若提示，选择「继续访问」即可；也可用手机相机扫码。
