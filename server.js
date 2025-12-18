import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

const PIC_DIR = path.join(__dirname, 'data/pic');
await fs.mkdir(PIC_DIR, { recursive: true });

// 静态文件
app.use('/data', express.static(path.join(__dirname, 'data')));
app.use('/', express.static(__dirname));

//指定analyze.html的路由
app.get('/analysis', (req, res) => {
    res.sendFile(path.join(__dirname, 'analysis.html'));
});

// 缓存图片接口
app.post('/api/cache-image', async (req, res) => {
    const { pic_id, url } = req.body || {};
    if (!pic_id || !url) return res.status(400).send(`missing id or url${JSON.parse(req.body)}`);

    try {
        const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } });
        if (!r.ok) return res.status(502).send('fetch remote failed');
        const buf = await r.buffer();
        const filePath = path.join(PIC_DIR, `${pic_id}.jpg`);
        await fs.writeFile(filePath, buf);
        res.status(200).send('ok');
    } catch (e) {
        console.error(e);
        res.status(500).send('cache failed');
    }
});

// 防止并发执行的锁
let isFetching = false;

//执行fetch_douban.js的main函数
app.get('/api/fresh', async (req, res) => {
    if (isFetching) {
        console.warn('Fetch already in progress, rejecting new request.');
        return res.status(409).send('fetch already in progress');
    }

    isFetching = true;
    try {
        const { main } = await import('./fetch_douban.js');
        await main();
        res.status(200).send('fetch completed');
    } catch (e) {
        console.error(e);
        res.status(500).send('fetch failed');
    } finally {
        isFetching = false;
        console.info('Fetch lock released');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));