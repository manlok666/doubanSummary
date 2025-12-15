(() => {
    const Analysis = window.Analysis = window.Analysis || {};
    const utils = Analysis.utils;
    if (!utils) return;
    const renderers = Analysis.renderers = Analysis.renderers || {};

    const {
        normalizeField, normalizeGenres, aggregateFieldStats, average, frequencyMap,
        formatNumber, formatShare, mapToDetailedList, buildRatingHistogram, computeQuantiles,
        buildTimeAggregations, nounSuffixes, adjSuffixes, positiveWords, negativeWords,
        accumulateStats, stopWords
    } = utils;

    const renderList = (targetId, data, formatter, emptyLabel = '暂无数据') => {
        const target = document.getElementById(targetId);
        if (!target) return;
        if (!data || !data.length) {
            target.innerHTML = `<li>${emptyLabel}</li>`;
            return;
        }
        target.innerHTML = data.map(item => `<li>${formatter(item)}</li>`).join('');
    };

    const renderTopList = (targetId, list, emptyLabel = '暂无数据') => {
        const target = document.getElementById(targetId);
        if (!target) return;
        target.innerHTML = list.slice(0, 5).map(([label, count]) =>
            `<li>${label}<span class="badge">${count}</span></li>`
        ).join('') || `<li>${emptyLabel}</li>`;
    };

    renderers.populateSummary = items => {
        const ratings = items.map(i => Number(i.rating)).filter(Number.isFinite);
        const durations = items.map(i => Number(i.duration_minutes)).filter(Number.isFinite);
        const totalMinutes = durations.reduce((sum, v) => sum + v, 0);
        const totalCommentChars = items.reduce((sum, item) => {
            const comments = Array.isArray(item.comments) ? item.comments : (item.comments ? [item.comments] : []);
            return sum + comments.reduce((cSum, comment) => cSum + (comment ? comment.length : 0), 0);
        }, 0);

        const cards = [
            { label: '影片总数', value: items.length },
            { label: '平均评分', value: ratings.length ? average(ratings).toFixed(2) : '—' },
            { label: '平均片长', value: durations.length ? `${Math.round(average(durations))} 分钟` : '—' },
            { label: '累计观看时长', value: durations.length ? `${(totalMinutes / 60).toFixed(1)} 小时` : '—' },
            { label: '累计评论字数', value: totalCommentChars ? `${totalCommentChars.toLocaleString()} 字` : '—' }
        ];
        const container = document.getElementById('summary-cards');
        if (!container) return;
        container.innerHTML = cards.map(card => `
            <div class="card">
                <h2>${card.label}</h2>
                <p class="data-value">${card.value}</p>
            </div>
        `).join('');
    };

    renderers.populateLists = items => {
        const genres = frequencyMap(items, item => normalizeGenres(item.genres));
        const languages = frequencyMap(items, item => normalizeField(item.languages));
        const ratingsCount = frequencyMap(items, item => Number.isFinite(Number(item.rating)) ? [`${item.rating} 星`] : []);
        renderTopList('genre-list', genres);
        renderTopList('language-list', languages);
        renderTopList('rating-list', ratingsCount);
    };

    renderers.renderTimeAnalysis = (items, timeAgg) => {
        const monthlyList = mapToDetailedList(timeAgg.monthly).sort((a, b) => a.key.localeCompare(b.key));
        renderList('monthly-trend', monthlyList.slice(-12), item => `${item.key}：${item.count} 部 | 平均 ${formatNumber(item.avgRating)}`);
        const yearlyList = mapToDetailedList(timeAgg.yearly).sort((a, b) => a.key.localeCompare(b.key));
        renderList('yearly-compare', yearlyList, item => `${item.key}：${item.count} 部 | 平均 ${formatNumber(item.avgRating)}`);

        const summary = [];
        if (monthlyList.length) {
            const peak = monthlyList.reduce((max, cur) => cur.count > max.count ? cur : max, monthlyList[0]);
            const low = monthlyList.reduce((min, cur) => cur.count < min.count ? cur : min, monthlyList[0]);
            summary.push(`高峰期：${peak.key}，${peak.count} 部`);
            summary.push(`淡季：${low.key}，${low.count} 部`);
            if (monthlyList.length > 1) {
                const trendDelta = monthlyList[monthlyList.length - 1].count - monthlyList[0].count;
                const trend = trendDelta > 0 ? '逐步升温' : (trendDelta < 0 ? '渐趋平缓' : '总体稳定');
                summary.push(`长期趋势：${trend}`);
            }
        }
        if (timeAgg.datedCount && timeAgg.monthly.size) summary.push(`平均每月 ${(timeAgg.datedCount / timeAgg.monthly.size).toFixed(1)} 部`);
        if (timeAgg.earliest && timeAgg.latest) summary.push(`观影跨度：${utils.formatDateDisplay(timeAgg.earliest)} - ${utils.formatDateDisplay(timeAgg.latest)}`);
        renderList('time-summary', summary, item => item);
    };

    const renderRatingHistogramChart = histogram => {
        const container = document.getElementById('rating-histogram-chart');
        if (!container) return;
        if (!histogram || !histogram.length) {
            container.innerHTML = '<div class="hist-empty">暂无评分数据</div>';
            return;
        }
        const maxCount = Math.max(...histogram.map(h => h.count), 1);
        const total = histogram.reduce((sum, h) => sum + h.count, 0) || 1;
        container.innerHTML = histogram.map(h => {
            const pct = Math.round((h.count / maxCount) * 100);
            const share = ((h.count / total) * 100).toFixed(1);
            return `
                <div class="hist-row" role="group" aria-label="${h.label} ${h.count} 部">
                    <div class="hist-label">${h.label}</div>
                    <div class="hist-bar-wrap" title="${h.count} 部 (${share}%)">
                        <div class="hist-bar" style="width:${pct}%;"></div>
                    </div>
                    <div class="hist-count">${h.count}</div>
                </div>`;
        }).join('');
    };

    renderers.renderRatingAnalysis = (items, timeAgg) => {
        const ratings = items.map(x => Number(x.rating)).filter(Number.isFinite);
        renderRatingHistogramChart(buildRatingHistogram(ratings));
        const monthlyList = mapToDetailedList(timeAgg.monthly).sort((a, b) => a.key.localeCompare(b.key));
        renderList('rating-timeline', monthlyList.slice(-12), item => `${item.key}：平均 ${formatNumber(item.avgRating)} 分（${item.count} 部）`);
        const quantiles = computeQuantiles(ratings);
        const highShare = ratings.length ? ((ratings.filter(r => r >= 8).length / ratings.length) * 100).toFixed(1) : '0.0';
        const lowShare = ratings.length ? ((ratings.filter(r => r <= 6).length / ratings.length) * 100).toFixed(1) : '0.0';
        const summary = ratings.length ? [
            `评分范围：${formatNumber(quantiles.min)} - ${formatNumber(quantiles.max)}`,
            `箱线：Q1 ${formatNumber(quantiles.q1)}, 中位 ${formatNumber(quantiles.median)}, Q3 ${formatNumber(quantiles.q3)}`,
            `高分占比（≥8）：${highShare}%`,
            `低分占比（≤6）：${lowShare}%`
        ] : ['暂无评分数据'];
        renderList('rating-summary', summary, item => item);
    };

    const getGenreComboStats = items => {
        const map = new Map();
        items.forEach(item => {
            const genres = normalizeGenres(item.genres);
            if (!genres.length) return;
            const key = genres.slice(0, 2).map(s => s.trim()).filter(Boolean).sort().join(' × ');
            if (!key) return;
            const entry = map.get(key) || { label: key, count: 0, ratingSum: 0, ratingCount: 0 };
            entry.count++;
            const rating = Number(item.rating);
            if (Number.isFinite(rating)) { entry.ratingSum += rating; entry.ratingCount++; }
            map.set(key, entry);
        });
        return [...map.values()].map(e => ({
            label: e.label,
            count: e.count,
            avgRating: e.ratingCount ? (e.ratingSum / e.ratingCount) : null
        })).sort((a, b) => b.count - a.count);
    };

    renderers.renderGenrePreference = items => {
        try {
            const genreStats = aggregateFieldStats(items, item => normalizeGenres(item.genres));
            const prefList = genreStats.slice(0, 8).map(g => ({
                label: g.label, count: g.count, avgRating: g.avgRating
            }));
            renderList('genre-pref', prefList, item => `${item.label}：${item.count} 部 | 平均 ${formatNumber(item.avgRating)}`);
            const combo = getGenreComboStats(items).slice(0, 10);
            renderList('genre-combo', combo, item => `${item.label}：${item.count} 次 | 平均 ${formatNumber(item.avgRating)}`, '暂无类型组合数据');
        } catch (err) {
            console.warn('renderGenrePreference error:', err);
            renderList('genre-pref', [], () => '暂无数据');
            renderList('genre-combo', [], () => '暂无数据');
        }
    };

    renderers.renderRatingAndGenre = (items, timeAgg) => {
        try { renderers.renderRatingAnalysis(items, timeAgg); } catch (err) { console.warn(err); }
        try { renderers.renderGenrePreference(items); } catch (err) { console.warn(err); }
    };

    const creatorStatsCache = { directors: [], writers: [], actors: [] };

    const computeCreatorStats = items => {
        const maps = {
            directors: new Map(),
            writers: new Map(),
            actors: new Map()
        };
        items.forEach(item => {
            const rating = Number(item.rating);
            normalizeField(item.directors).forEach(name => {
                const entry = maps.directors.get(name) || { label: name, role: '导演', count: 0, ratingSum: 0, ratingCount: 0 };
                entry.count++;
                if (Number.isFinite(rating)) { entry.ratingSum += rating; entry.ratingCount++; }
                maps.directors.set(name, entry);
            });
            normalizeField(item.writers).forEach(name => {
                const entry = maps.writers.get(name) || { label: name, role: '编剧', count: 0, ratingSum: 0, ratingCount: 0 };
                entry.count++;
                if (Number.isFinite(rating)) { entry.ratingSum += rating; entry.ratingCount++; }
                maps.writers.set(name, entry);
            });
            normalizeField(item.actors).forEach(name => {
                const entry = maps.actors.get(name) || { label: name, role: '演员', count: 0, ratingSum: 0, ratingCount: 0 };
                entry.count++;
                if (Number.isFinite(rating)) { entry.ratingSum += rating; entry.ratingCount++; }
                maps.actors.set(name, entry);
            });
        });
        creatorStatsCache.directors = [...maps.directors.values()].map(e => ({
            label: e.label, role: e.role, count: e.count, avgRating: e.ratingCount ? (e.ratingSum / e.ratingCount) : null
        })).sort((a, b) => b.count - a.count);
        creatorStatsCache.writers = [...maps.writers.values()].map(e => ({
            label: e.label, role: e.role, count: e.count, avgRating: e.ratingCount ? (e.ratingSum / e.ratingCount) : null
        })).sort((a, b) => b.count - a.count);
        creatorStatsCache.actors = [...maps.actors.values()].map(e => ({
            label: e.label, role: e.role, count: e.count, avgRating: e.ratingCount ? (e.ratingSum / e.ratingCount) : null
        })).sort((a, b) => b.count - a.count);
    };

    const renderCreatorTableFor = role => {
        const tbody = document.getElementById('creator-table-body');
        if (!tbody) return;
        const list = (creatorStatsCache[role] || []).filter(row => Number(row.count) >= 5);
        if (!list.length) {
            tbody.innerHTML = '<tr><td colspan="4">暂无符合（观影次数 ≥ 5）创作者数据</td></tr>';
            return;
        }
        tbody.innerHTML = list.slice(0, 50).map(row => `
            <tr>
                <td>${row.label}</td>
                <td>${row.role}</td>
                <td>${row.count}</td>
                <td>${formatNumber(row.avgRating)}</td>
            </tr>`).join('');
    };

    renderers.populateCreatorTable = items => {
        computeCreatorStats(items);
        const tabs = document.querySelectorAll('.creator-tabs button');
        tabs.forEach(btn => {
            btn.onclick = () => {
                tabs.forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
                btn.classList.add('active');
                btn.setAttribute('aria-selected', 'true');
                renderCreatorTableFor(btn.dataset.role);
            };
        });
        renderCreatorTableFor('directors');
    };

    const renderRegionLanguage = items => {
        const regionStats = aggregateFieldStats(items, item => normalizeField(item.regions));
        const languageStats = aggregateFieldStats(items, item => normalizeField(item.languages));
        const regionTotal = regionStats.reduce((sum, item) => sum + item.count, 0);
        const languageTotal = languageStats.reduce((sum, item) => sum + item.count, 0);
        renderList('region-list-extended', regionStats.slice(0, 10),
            item => `${item.label}：${item.count} 部（${formatShare(item.count, regionTotal)}%）| 平均 ${formatNumber(item.avgRating)}`);
        renderList('language-list-extended', languageStats.slice(0, 10),
            item => `${item.label}：${item.count} 部（${formatShare(item.count, languageTotal)}%）| 平均 ${formatNumber(item.avgRating)}`);
    };

    renderers.renderRegionLanguageAndDuration = items => {
        try {
            renderRegionLanguage(items);
        } catch (err) {
            console.warn('renderRegionLanguage error:', err);
        }
        try {
            const bins = [
                { label: '<90分钟', min: 0, max: 90 },
                { label: '90-120分钟', min: 90, max: 120 },
                { label: '120-150分钟', min: 120, max: 150 },
                { label: '>150分钟', min: 150, max: Infinity }
            ];
            const stats = bins.map(b => ({ ...b, count: 0, ratingSum: 0, ratingCount: 0 }));
            items.forEach(item => {
                const d = Number(item.duration_minutes);
                if (!Number.isFinite(d)) return;
                const r = Number(item.rating);
                const bin = stats.find(s => d >= s.min && d < s.max);
                if (bin) {
                    bin.count++;
                    if (Number.isFinite(r)) { bin.ratingSum += r; bin.ratingCount++; }
                }
            });
            const total = items.length || 1;
            const rows = stats.map(s => `<tr>
                <td>${s.label}</td>
                <td>${s.count}</td>
                <td>${total ? ((s.count / total) * 100).toFixed(1) + '%' : '0.0%'}</td>
                <td>${s.ratingCount ? (s.ratingSum / s.ratingCount).toFixed(2) : '—'}</td>
            </tr>`).join('');
            const dtbody = document.getElementById('duration-table-body');
            if (dtbody) dtbody.innerHTML = rows || '<tr><td colspan="4">暂无数据</td></tr>';
        } catch (err) {
            console.warn('renderRegionLanguageAndDuration duration part error:', err);
        }
    };

    const getDecadeLabel = year => {
        if (!Number.isFinite(year)) return '未知年代';
        return `${Math.floor(year / 10) * 10}s`;
    };

    renderers.renderDecadeSummary = items => {
        const map = new Map();
        items.forEach(item => {
            const year = Number(item.release_year);
            if (!Number.isFinite(year)) return;
            accumulateStats(map, getDecadeLabel(year), Number(item.rating));
        });
        const list = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([label, stats]) => ({
            label,
            count: stats.count,
            avgRating: stats.ratingCount ? stats.ratingSum / stats.ratingCount : null
        }));
        renderList('decade-summary', list, item => `${item.label}：${item.count} 部 | 平均 ${formatNumber(item.avgRating)}`);
    };

    const buildKeywords = (text, topN = 10) => {
        if (!text) return [];
        const cleaned = text.replace(/[^\u4e00-\u9fffA-Za-z0-9]+/g, ' ');
        const parts = cleaned.split(/\s+/).map(s => s.trim()).filter(Boolean);
        const tokens = [];
        parts.forEach(part => {
            if (/^[A-Za-z0-9]+$/.test(part)) {
                part.split(/[^A-Za-z0-9]+/).forEach(w => {
                    const word = w.toLowerCase();
                    if (word.length < 3 || stopWords.has(word)) return;
                    if (/(ing|ed|s)$/.test(word) && word.length <= 5) return;
                    const hasAdjSuffix = adjSuffixes.some(suf => word.endsWith(suf));
                    const hasNounSuffix = nounSuffixes.some(suf => word.endsWith(suf));
                    if (hasAdjSuffix || hasNounSuffix || word.length >= 4) tokens.push(word);
                });
                return;
            }
            const zhSeqs = part.match(/[\u4e00-\u9fff]+/g) || [];
            zhSeqs.forEach(seq => {
                const maxN = Math.min(4, seq.length);
                for (let n = 2; n <= maxN; n++) {
                    for (let i = 0; i <= seq.length - n; i++) {
                        const gram = seq.slice(i, i + n);
                        if (!gram || stopWords.has(gram)) continue;
                        tokens.push(gram);
                    }
                }
            });
            if (!zhSeqs.length) {
                const seq = part.replace(/[^A-Za-z0-9\u4e00-\u9fff]/g, '');
                if (seq.length >= 3 && seq.length <= 30) {
                    const candidate = seq.length > 8 ? seq.slice(0, 8) : seq.toLowerCase();
                    if (!stopWords.has(candidate)) tokens.push(candidate);
                }
            }
        });
        const freq = new Map();
        tokens.forEach(token => {
            if (!token || token.length > 30) return;
            freq.set(token, (freq.get(token) || 0) + 1);
        });
        const entries = [...freq.entries()];
        entries.sort((a, b) => {
            if (b[1] !== a[1]) return b[1] - a[1];
            const aIsZh = /[\u4e00-\u9fff]/.test(a[0]);
            const bIsZh = /[\u4e00-\u9fff]/.test(b[0]);
            if (aIsZh !== bIsZh) return aIsZh ? -1 : 1;
            const aHasAffix = [...nounSuffixes, ...adjSuffixes].some(suf => a[0].endsWith(suf));
            const bHasAffix = [...nounSuffixes, ...adjSuffixes].some(suf => b[0].endsWith(suf));
            if (aHasAffix !== bHasAffix) return aHasAffix ? -1 : 1;
            return a[0].length - b[0].length;
        });
        return entries.slice(0, topN);
    };

    const getSentimentBreakdown = comments => {
        const result = { positive: 0, neutral: 0, negative: 0 };
        comments.forEach(({ text }) => {
            const lower = text.toLowerCase();
            let score = 0;
            positiveWords.forEach(word => { if (lower.includes(word.toLowerCase())) score++; });
            negativeWords.forEach(word => { if (lower.includes(word.toLowerCase())) score--; });
            if (score > 0) result.positive++;
            else if (score < 0) result.negative++;
            else result.neutral++;
        });
        return result;
    };

    const analyzeComments = items => {
        const comments = [];
        let longest = { length: 0, title: '' };
        items.forEach(item => {
            const title = item.title || '未知影片';
            const list = Array.isArray(item.comments) ? item.comments : (item.comments ? [item.comments] : []);
            list.forEach(text => {
                if (!text) return;
                const content = text.toString().trim();
                if (!content) return;
                comments.push({ text: content, title });
                if (content.length > longest.length) longest = { length: content.length, title };
            });
        });
        const totalChars = comments.reduce((sum, c) => sum + c.text.length, 0);
        const avg = comments.length ? (totalChars / comments.length).toFixed(1) : '—';
        const sentiment = getSentimentBreakdown(comments);
        return {
            statsList: comments.length ? [
                `评论条数：${comments.length}`,
                `总字数：${totalChars.toLocaleString()} 字`,
                `平均每条 ${avg} 字`,
                longest.length ? `最长评论来自《${longest.title}》，${longest.length} 字` : '暂无显著长评'
            ] : ['尚无评论记录'],
            keywordsList: comments.length ? buildKeywords(comments.map(c => c.text).join(' ')).map(([word, count]) => `${word}（${count}）`) : ['暂无关键词'],
            sentimentList: comments.length ? [
                `正向：${sentiment.positive} 条`,
                `中性：${sentiment.neutral} 条`,
                `负向：${sentiment.negative} 条`
            ] : ['暂无情感数据']
        };
    };

    renderers.renderCommentsAnalysis = items => {
        const { statsList, keywordsList, sentimentList } = analyzeComments(items);
        renderList('comments-stats', statsList, item => item);
        renderList('comments-keywords', keywordsList, item => item);
        renderList('comments-sentiment', sentimentList, item => item);
    };

    renderers.renderCorrelations = items => {
        const map = new Map();
        items.forEach(item => {
            const genre = normalizeGenres(item.genres)[0] || '未知类型';
            const region = normalizeField(item.regions)[0] || '未知地区';
            const decade = getDecadeLabel(Number(item.release_year));
            const key = `${genre} × ${region} × ${decade}`;
            accumulateStats(map, key, Number(item.rating));
        });
        const rows = [...map.entries()].map(([label, stats]) => ({
            label,
            count: stats.count,
            avgRating: stats.ratingCount ? stats.ratingSum / stats.ratingCount : null
        })).filter(row => row.count >= 2).sort((a, b) => (b.avgRating || 0) - (a.avgRating || 0)).slice(0, 8);
        const tbody = document.getElementById('correlation-table-body');
        if (!tbody) return;
        tbody.innerHTML = rows.length ? rows.map(row => `
            <tr>
                <td>${row.label}</td>
                <td>${row.count}</td>
                <td>${formatNumber(row.avgRating)}</td>
            </tr>`).join('') : '<tr><td colspan="3">暂无可关联的数据</td></tr>';
    };

    renderers.renderPersona = (items, timeAgg) => {
        const genreStats = aggregateFieldStats(items, item => normalizeGenres(item.genres));
        const regionStats = aggregateFieldStats(items, item => normalizeField(item.regions));
        const languageStats = aggregateFieldStats(items, item => normalizeField(item.languages));
        const directorStats = aggregateFieldStats(items, item => normalizeField(item.directors));
        const pace = (timeAgg.datedCount && timeAgg.monthly.size) ? (timeAgg.datedCount / timeAgg.monthly.size).toFixed(1) : '—';
        const cards = [
            { label: '月均观影', value: pace !== '—' ? `${pace} 部/月` : '—' },
            { label: '偏好类型', value: genreStats.length ? `${genreStats[0].label}（${genreStats[0].count} 部）` : '—' },
            { label: '偏好地区', value: regionStats.length ? `${regionStats[0].label}` : '—' },
            { label: '偏好语言', value: languageStats.length ? `${languageStats[0].label}` : '—' },
            { label: '常看导演', value: directorStats.length ? `${directorStats[0].label}（${directorStats[0].count} 部）` : '—' }
        ];
        const container = document.getElementById('summary-cards');
        if (!container) return;
        container.innerHTML += cards.map(card => `
            <div class="card">
                <h2>${card.label}</h2>
                <p class="data-value">${card.value}</p>
            </div>
        `).join('');
    };
})();
