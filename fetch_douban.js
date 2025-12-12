// 依赖：npm install node-fetch@2 cheerio
import fs from 'fs/promises';
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import dotenv from 'dotenv';

//读取.env 中的配置
dotenv.config();

const COOKIE = process.env.DOUBAN_COOKIE || ''; // 请填入你的豆瓣 Cookie（仅用于个人备份）
const USER_ID = process.env.DOUBAN_USER_ID || ''; // 默认示例，可覆盖
const OUTPUT_DIR = './data';

const URLS = {
    movies: `https://movie.douban.com/people/${USER_ID}/collect?`,
    books: `https://book.douban.com/people/${USER_ID}/collect?`,
    games: `https://www.douban.com/people/${USER_ID}/games?action=collect&`,   // 可能需调整
    music: `https://music.douban.com/people/${USER_ID}/collect?`,
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchPage(url) {
    const res = await fetch(url, {
        headers: {cookie: COOKIE, 'user-agent': 'Mozilla/5.0'},
    });
    if (!res.ok) throw new Error(`Request failed ${res.status}: ${url}`);
    return res.text();
}

// 支持 ratingX-t (1-5 星) & <span class="comment">...</span>
function parseItems(html, name) {
    const $ = cheerio.load(html);
    const items = [];
    //根据book，movies,games,music页面结构不同，选择不同的节点
    let nodes = $('.subject-item');
    switch (name) {
        case 'books':
            nodes = $('.subject-item');
            break;
        case 'movies':
        case 'music':
            nodes = $('.comment-item');
            break;
        case 'games':
            nodes = $('.common-item');
            break;
    }
    nodes.each((_, el) => {
        const cover = $(el).find('img').attr('src') || '';
        const title =
            $(el).find('h2 a[title]').attr('title')?.trim() ||
            // $(el).find('h2 a').text().trim() ||
            $(el).find('.title a').text().trim();
        // 书籍出版信息在 .pub；电影/其他在 .intro
        const info = $(el).find('.intro').text().trim() ||
            $(el).find('.pub').text().trim();
        const date = $(el).find('.date').text().trim();
        const tags = $(el).find('.tags').text().replace('标签:', '').trim().split(/\s+/).filter(Boolean);
        let rating = '';
        let ratingClass = '';

        $(el).find('*').addBack().each((_, node) => {
            const cls = $(node).attr('class');
            if (cls) {
                ratingClass += (ratingClass ? ' ' : '') + cls;
            }
        });
        let ratingMatch = ratingClass.match(/rating(\d)-t/);
        rating = ratingMatch ? Number(ratingMatch[1]) : '';
        if (rating === '') {
            const ratingMatch = ratingClass.match(/allstar(\d)/);
            rating = ratingMatch ? Number(ratingMatch[1]) : '';
        }
        let comment = '';
        if (name === 'games') {
            // .content 下的第三个 div（索引 2）通常是评论文本
            comment = $(el).find('.content > div').eq(2).text().trim() || '';
        } else if (name === 'music') {
            comment = $(el).find('.info > ul > li').eq(3).text().trim() || '';
            if (comment.startsWith('修改')) {
                comment = '';
            }
        } else {
            // 其他类别保留原有逻辑
            comment = $(el).find('.comment').text().trim() || '';
        }
        items.push({
            title,
            cover,
            desc: info,
            tags,
            rating,             // 1-5 星
            updated_at: date,   // 用于去重
            comments: comment ? [comment] : [],
        });
    });
    return items;
}

// 电影分页抓取，按 updated_at 去重
async function fetchWithPagination(name) {
    const base = URLS[name];
    const history = await loadHistory(name);
    const seenDates = new Set(history.map(i => i.updated_at).filter(Boolean));

    let start = 0;
    const pageSize = 15;
    const maxLoops = 1;
    const fresh = [];

    for (let i = 0; i < maxLoops; i++, start += pageSize) {
        const url = `${base}start=${start}`;

        console.log(`Fetching ${name} page start=${start}`);
        const html = await fetchPage(url);
        const items = parseItems(html, name);
        if (!items.length) {
            console.log('No more items, stop paging.');
            break;
        }
        const newOnes = items.filter(it => it.updated_at && !seenDates.has(it.updated_at));
        newOnes.forEach(it => seenDates.add(it.updated_at));
        fresh.push(...newOnes);
        if (!newOnes.length) {
            console.log('Page contains no new dates, stop early.');
            break;
        }
        await sleep(1300);
    }

    const merged = [ ...fresh, ...history];
    await saveJson(name, merged);
    console.log(`${name}: history=${history.length}, new=${fresh.length}, total=${merged.length}`);
}

async function loadHistory(name) {
    try {
        const buf = await fs.readFile(`${OUTPUT_DIR}/${name}.json`, 'utf8');
        const json = JSON.parse(buf);
        return json.items || [];
    } catch {
        return [];
    }
}

async function saveJson(name, items) {
    await fs.mkdir(OUTPUT_DIR, {recursive: true});
    const data = {items};
    await fs.writeFile(`${OUTPUT_DIR}/${name}.json`, JSON.stringify(data, null, 2), 'utf8');
}

export async function main() {
    if (!COOKIE) throw new Error('请在环境变量 DOUBAN_COOKIE 中提供豆瓣 Cookie');
    if (!USER_ID) throw new Error('请在环境变量 DOUBAN_USER_ID 中提供用户 ID/个性域名');

    await fetchWithPagination('movies');
    await fetchWithPagination('books');
    await fetchWithPagination('music');
    await fetchWithPagination('games');
}

main();