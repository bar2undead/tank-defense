# 坦克大战：保卫大本营（双人联网）

原创俯视角坦克合作游戏。两人通过六位房间号加入同一房间，服务器同步坦克、炮弹、地形、敌人、分数与大本营血量。

## 本地运行

安装 Node.js 18+，在本目录执行：

```bash
npm install
npm start
```

访问 http://localhost:3000 。

## 免费部署

1. 在 GitHub **新建仓库**（不要覆盖 Skybound 的仓库），上传 `server.js`、`package.json`、`README.md` 和整个 `public` 文件夹（内含 `index.html`、`client.js`）。
2. Render 新建 Web Service，连接新仓库；Language: Node；Build Command: `npm install`；Start Command: `npm start`；选择 Free。
3. 部署显示 Live 后，打开 Render 网址，玩家 A 创建房间，玩家 B 输入房间号加入。

注意：免费实例休眠会断开房间；房间只存在服务器内存，重启后消失。此版本为可试玩原型，尚未完成真实双浏览器测试。
