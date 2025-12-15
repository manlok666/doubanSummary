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
    const { slug, url } = req.body || {};
    if (!slug || !url) return res.status(400).send('missing slug or url');

    try {
        const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } });
        if (!r.ok) return res.status(502).send('fetch remote failed');
        const buf = await r.buffer();
        const filePath = path.join(PIC_DIR, `${slug}.jpg`);
        await fs.writeFile(filePath, buf);
        res.status(200).send('ok');
    } catch (e) {
        console.error(e);
        res.status(500).send('cache failed');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));