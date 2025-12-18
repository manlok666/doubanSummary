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

const MOVIE_DETAIL_DELAY = 800;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchPage(url) {
    const res = await fetch(url, {
        headers: {cookie: COOKIE, 'user-agent': 'Mozilla/5.0'},
    });
    if (!res.ok) throw new Error(`Request failed ${res.status}: ${url}`);
    return res.text();
}

// 支持 ratingX-t (1-5 星) & <span class="comment">...</span>
async function parseItems(html, name, existingLinks = new Set()) {
    const $ = cheerio.load(html);
    const items = [];
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

    const detailQueue = [];
    nodes.each((_, el) => {
        const cover = $(el).find('img').attr('src') || '';
        const titleLinkEl =
            $(el).find('h2 a[title]').length
                ? $(el).find('h2 a[title]')
                : $(el).find('.title a');
        const rawTitle = titleLinkEl.attr('title') || titleLinkEl.text();
        const titleNormalized = rawTitle ? rawTitle.replace(/\s+/g, ' ').trim() : '';
        const titleSplit = titleNormalized ? titleNormalized.split(/\s*\/\s*/) : [];
        const primaryTitle = titleSplit.length ? titleSplit[0] : '';
        const link = titleLinkEl.attr('href') || '';

        const info = $(el).find('.intro').text().trim() ||
            $(el).find('.pub').text().trim();
        const rawUpdatedAt = $(el).find('.date').text().trim();
        const updatedAtMatch = rawUpdatedAt.match(/\d{4}-\d{2}-\d{2}/);
        const date = updatedAtMatch ? updatedAtMatch[0] : '';
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
            const ratingAltMatch = ratingClass.match(/allstar(\d)/);
            rating = ratingAltMatch ? Number(ratingAltMatch[1]) : '';
        }
        let comment = '';
        if (name === 'games') {
            comment = $(el).find('.content > div').eq(2).text().trim() || '';
        } else if (name === 'music') {
            comment = $(el).find('.info > ul > li').eq(3).text().trim() || '';
            if (comment.startsWith('修改')) {
                comment = '';
            }
        } else {
            comment = $(el).find('.comment').text().trim() || '';
        }

        const item = {
            title: primaryTitle,
            title_arr: titleNormalized,
            link,
            cover,
            rating,
            updated_at: date,
            comments: comment ? [comment] : [],
        };
        if (name !== 'movies') {
            item.desc = info;
        }
        items.push(item);

        // 只有 movies 需要进一步抓取详情，且仅在历史中不存在该 link 时才抓取
        if (name === 'movies' && link && !existingLinks.has(link)) {
            detailQueue.push({item, link});
        }
    });
    for (const {item, link} of detailQueue) {
        console.log(`Fetching detail for movie: ${item.title}`);
        const detail = await fetchMovieDetail(link);
        Object.assign(item, detail);
    }
    return items;
}

function cleanInfoText(text = '') {
    return text
        .replace(/\u00a0/g, ' ')
        .replace(/更多\.\.\./g, '')
        .replace(/^[：:\s]+/, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function extractReleaseYear(values) {
    const years = values
        .map(value => {
            const match = value.match(/(\d{4})/);
            return match ? Number(match[1]) : null;
        })
        .filter(year => Number.isFinite(year));
    return years.length ? Math.min(...years) : '';
}

function extractDurationMinutes(values) {
    for (const value of values) {
        const match = value.match(/(\d+)\s*分钟?/);
        if (match) return Number(match[1]);
        const fallback = value.match(/(\d+)/);
        if (fallback) return Number(fallback[1]);
    }
    return '';
}

function collectInfoField($, info, label) {
    const labelSpan = info.find('span.pl').filter((_, el) => $(el).text().trim().startsWith(label)).first();
    if (!labelSpan.length) return '';
    const parent = labelSpan.parent();
    if (parent && parent.length && parent[0].name === 'span') {
        const attrs = parent.children('.attrs').first();
        if (attrs.length) {
            return cleanInfoText(attrs.text());
        }
    }
    const segments = [];
    let node = labelSpan[0].nextSibling;
    while (node) {
        if (node.type === 'tag' && node.name === 'br') break;
        if (node.type === 'tag') {
            segments.push($(node).text());
        } else if (node.type === 'text') {
            segments.push(node.data || '');
        }
        node = node.nextSibling;
    }
    return cleanInfoText(segments.join(''));
}

function splitValues(text) {
    if (!text) return [];
    return text
        .split(/\s+\/\s+/)
        .map(part => part.trim())
        .filter(Boolean);
}

function formatField(values) {
    if (!values.length) return '';
    return values.length === 1 ? values[0] : values;
}

async function fetchMovieDetail(link) {
    try {
        await sleep(MOVIE_DETAIL_DELAY);
        const html = await fetchPage(link);
        const $ = cheerio.load(html);
        const info = $('#info');
        if (!info.length) return {};
        const grab = (label) => splitValues(collectInfoField($, info, label));
        const releaseDates = grab('上映日期');
        const durations = grab('片长');
        let res = {
            directors: formatField(grab('导演')),
            writers: formatField(grab('编剧')),
            actors: formatField(grab('主演')),
            genres: formatField(grab('类型')),
            regions: formatField(grab('制片国家/地区')),
            languages: formatField(grab('语言')),
            duration_minutes: extractDurationMinutes(durations),
        };
        let releaseYear = extractReleaseYear(releaseDates)
        if (releaseYear) {
            res.release_year = releaseYear;
        }
        return res;
    } catch (err) {
        console.warn(`Failed to fetch movie detail ${link}: ${err.message}`);
        return {};
    }
}

// 电影分页抓取，按 updated_at 去重
async function fetchWithPagination(name) {
    const base = URLS[name];
    let history = await loadHistory(name);
    const existingLinks = new Set(history.map(i => i.link).filter(Boolean));

    let start = 0;
    const pageSize = 15;
    const maxLoops = 1000;
    const fresh = [];

    for (let i = 0; i < maxLoops; i++, start += pageSize) {
        const url = `${base}start=${start}`;

        console.log(`Fetching ${name} page start=${start}`);
        const html = await fetchPage(url);
        // 传入 existingLinks，parseItems 将跳过已存在的电影详情抓取
        const items = await parseItems(html, name, existingLinks);
        if (!items.length) {
            console.log('No more items, stop paging.');
            break;
        }

        // 本页中新出现（按日期判重）的条目
        const newOnes = items.filter(it => it.link && !existingLinks.has(it.link));
        newOnes.forEach(it => {
            existingLinks.add(it.link); // 防止后续页重复抓取详情
        });

        // 将本页新增合并到 history，并立刻保存（每页保存一次）
        const merged = [ ...newOnes, ...history];
        history = merged; // 更新 history 以便下一页使用
        await saveJson(name, merged);
        console.log(`${name}: saved page start=${start}, pageNew=${newOnes.length}, total=${merged.length}`);

        // 若本页没有新增日期，按原逻辑继续可能的下一页
        if (!newOnes.length) {
            console.log('Page contains no new dates, continue to next page.');
            await sleep(1300);
            break;
        }

        // 适度等待再抓取下一页
        await sleep(1300);
    }

    console.log(`${name}: finished. history=${history.length}`);
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
