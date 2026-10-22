# Marie · AI 美妆助手

面向美妆陪练场景的可部署 PWA：用户选择妆容后直接进入 Marie 跟妆，摄像头、豆包端到端双向语音、步骤教学与视觉妆面检查在同一页面协作。

## 亮点

- **Marie 持续语音**：通过后端 WebSocket 中转连接豆包端到端实时语音 O2.0，使用 Vivi 2.0 音色；服务不可用时自动切换设备语音。
- **安全的 API 架构**：豆包 API Key 仅保存在服务端，浏览器不接触密钥。
- **实时视觉管线**：MediaPipe 在设备端输出 478 个关键点、52 项 Blendshapes、4×4 面部变换矩阵，并通过时间滤波减少轮廓抖动。
- **面部语义区域**：六类人像分割结合眼、眉、唇、双颊等妆容区域，持续比较姿态、表情和左右色彩。
- **视觉语音联动**：设备端视觉摘要走 Marie 的 Realtime WebSocket；当前豆包 S2S 不接收原始图像，因此只将需要纠正的视觉摘要注入语音模型，画面不会在服务端保存。
- **边画边看边教**：MediaPipe Face Landmarker 在本地浏览器运行，持续检查距离、居中、左右转头、歪头与光线，并以眼、眉、唇、脸廓语义线标出当前区域；不做身份识别。
- **实时妆面检查**：设备端持续比较当前步骤开始前后的妆面变化；如另外配置 OpenAI Key，可手动点击“精细检查”分析单帧画面。
- **AI 妆容与工具视觉**：妆容库使用项目生成的 AI 人脸示意，化妆包保留粉底、口红、眼影、刷具等工具清单。
- **多年龄与社交圈**：增加刚成年、50+、银发和多元肤色参考妆容，以及本地演示帖子、导入妆容和用户设置页。
- **完整妆容拆解**：公开小红书案例被重新编辑成准备、分步、工具、避坑和肤况适配，不复制原图，并提供原始来源链接。
- **可安装 PWA**：部署到 HTTPS 后可“添加到主屏幕”，以 App 形式使用。

## 本地运行

```bash
npm install
npm run build
npm run dev
```

开发服务器已包含豆包 WebSocket 中转。生产构建后可用 `npm start` 启动完整服务。

### 给组员接力

1. 解压 ZIP，安装 [Node.js 20+](https://nodejs.org/)。
2. 把 `.env.example` 复制成 `.env.local`，再填入 API Key。不要在聊天或 GitHub 中发送真实密钥。
3. 双击 `start-dev.cmd` 进入开发模式，保存源码后页面会自动刷新。
4. 双击 `start-demo.cmd` 构建并打开稳定演示版。
5. 双击 `share-online.cmd` 才会临时生成公网演示通道；临时网址可能变化或失效，不适合作为最终提交地址。

不要直接双击 `index.html`，摄像头、模块资源和实时语音都需要通过本地或云端服务器运行。

### 生成最终 ZIP

```bash
npm install
npm run package:zip
```

命令会先重新构建，再在项目上级目录生成 `Marie-AI-Source.zip`。压缩包包含源码、构建产物和启动脚本，但不会包含 `.env.local`、真实 API Key、`node_modules` 或 Git 历史。

## 部署

豆包实时语音需要长期 WebSocket 连接，建议部署到 Render、Railway 或支持 WebSocket 的云服务器，而不是仅使用 GitHub Pages/Vercel Serverless。

1. 把本仓库推送到 GitHub，并在托管平台连接仓库。
2. Build Command 使用 `npm install && npm run build`，Start Command 使用 `npm start`。
3. 添加以下环境变量：

   - `VOLCENGINE_API_KEY`
   - `VOLCENGINE_REALTIME_MODEL`（默认 `1.2.1.1`，即 O2.0）
   - `VOLCENGINE_REALTIME_SPEAKER`（默认 `zh_female_vv_uranus_bigtts`，即 Vivi 2.0）
   - `VOLCENGINE_REALTIME_SPEECH_RATE`（默认 `-8`）
   - `OPENAI_API_KEY`（可选，仅用于文字问答与云端单帧精细检查）

4. 部署后使用 HTTPS 域名；摄像头和麦克风在公网环境必须使用 HTTPS。

## 安全与隐私

- 不要把 API Key 写入 `src/`、`.env.example` 或任何提交到 GitHub 的文件。
- 相机轮廓检测在本地运行，面部关键点不会上传。
- 设备端妆面检测不上传关键点或连续视频；只有用户主动点击“精细检查”时，才会把当时的一张压缩画面发送到已配置的 OpenAI API。
- 应用不进行身份识别，不推断年龄、种族、健康等敏感属性，也不提供医学诊断。

## 来源说明

妆容库引用小红书公开活动专题中的案例标题和创作者信息，并链接回来源页面。应用中的步骤拆解与视觉卡片均为本项目独立编辑和设计；未抓取、下载或重新发布小红书原图。
