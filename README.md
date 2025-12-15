# doubanSummary
豆瓣信息获取和分析总结

## 运行说明
 
- 安装依赖：npm install
- 在`.env`设置环境变量：
```
bash
export DOUBAN_COOKIE='你的完整 Cookie 串'
export DOUBAN_USER_ID='你的豆瓣 ID 或个性域名'
```
- 运行抓取：`node fetch_douban.js`，生成 `data/*.json`。
- 启动任意静态服务器（本地可 `npm start`），访问 `http://localhost:3000`（或实际端口）查看 `index.html`，点击“手动刷新”或设置自动刷新即可。