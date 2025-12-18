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
        target.innerHTML = data.map(item => {
            const content = formatter(item);
            if (content && typeof content === 'object') {
                const { label = '', badge = '' } = content;
                return `<li class="with-badge"><span class="badge-label">${label}</span>${badge ? `<span class="badge">${badge}</span>` : ''}</li>`;
            }
            return `<li>${content}</li>`;
        }).join('');
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
        // 计算平均片长时排除掉小于 60 分钟的条目
        const durationsForAvg = durations.filter(d => Number.isFinite(d) && d >= 60);

        const totalCommentChars = items.reduce((sum, item) => {
            const comments = Array.isArray(item.comments) ? item.comments : (item.comments ? [item.comments] : []);
            return sum + comments.reduce((cSum, comment) => cSum + (comment ? comment.length : 0), 0);
        }, 0);

        const cards = [
            { label: '影片总数', value: items.length },
            { label: '平均评分', value: ratings.length ? average(ratings).toFixed(2) : '—' },
            { label: '平均片长', value: durationsForAvg.length ? `${Math.round(average(durationsForAvg))} 分钟` : '—' },
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

    renderers.renderTimeAnalysis = (items, timeAgg, options = {}) => {
        const { hideYearly = false } = options;
        const yearlyBlock = document.getElementById('yearly-compare-block');
        if (yearlyBlock) yearlyBlock.style.display = hideYearly ? 'none' : '';

        const monthlyList = mapToDetailedList(timeAgg.monthly).sort((a, b) => a.key.localeCompare(b.key));
        const recentMonthly = monthlyList.slice(-12);

        renderList('monthly-trend', recentMonthly, item => ({
            label: `${item.key}｜平均 ${formatNumber(item.avgRating)} 分`,
            badge: `${item.count} 部`
        }));

        if (!hideYearly) {
            const yearlyList = mapToDetailedList(timeAgg.yearly).sort((a, b) => a.key.localeCompare(b.key)).slice(-6);
            renderList('yearly-compare', yearlyList, item => ({
                label: `${item.key}｜平均 ${formatNumber(item.avgRating)} 分`,
                badge: `${item.count} 部`
            }));
        } else {
            const yearly = document.getElementById('yearly-compare');
            if (yearly) yearly.innerHTML = '<li>时间跨度不足以展示年度趋势</li>';
        }

        renderList('rating-timeline', recentMonthly, item => ({
            label: `${item.key}｜${item.count} 部`,
            badge: `${formatNumber(item.avgRating)} 分`
        }));

        const summary = [];
        if (monthlyList.length) {
            const peak = monthlyList.reduce((max, cur) => cur.count > max.count ? cur : max, monthlyList[0]);
            const low = monthlyList.reduce((min, cur) => cur.count < min.count ? cur : min, monthlyList[0]);
            summary.push({ label: `高峰期：${peak.key}`, badge: `${peak.count} 部` });
            summary.push({ label: `淡季：${low.key}`, badge: `${low.count} 部` });
            if (monthlyList.length > 1) {
                const trendDelta = monthlyList[monthlyList.length - 1].count - monthlyList[0].count;
                const trend = trendDelta > 0 ? '逐步升温' : (trendDelta < 0 ? '渐趋平缓' : '总体稳定');
                summary.push(`长期趋势：${trend}`);
            }
        }
        if (timeAgg.datedCount && timeAgg.monthly.size) {
            summary.push({ label: '平均每月', badge: `${(timeAgg.datedCount / timeAgg.monthly.size).toFixed(1)} 部` });
        }
        if (timeAgg.earliest && timeAgg.latest) {
            summary.push({ label: '观影跨度', badge: `${utils.formatDateDisplay(timeAgg.earliest)} - ${utils.formatDateDisplay(timeAgg.latest)}` });
        }
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
        // 移除按月评分序列的重复渲染，现由 renderTimeAnalysis 负责
        const quantiles = computeQuantiles(ratings);
        const highShare = ratings.length ? ((ratings.filter(r => r >= 8).length / ratings.length) * 100).toFixed(1) : '0.0';
        const lowShare = ratings.length ? ((ratings.filter(r => r <= 6).length / ratings.length) * 100).toFixed(1) : '0.0';
        const summary = ratings.length ? [
            `评分范围：${formatNumber(quantiles.min)} - ${formatNumber(quantiles.max)}`,
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
            const prefList = genreStats.slice(0, 8);
            renderList('genre-pref', prefList, item => ({
                label: `${item.label}｜平均 ${formatNumber(item.avgRating)} 分`,
                badge: `${item.count} 部`
            }));
            const combo = getGenreComboStats(items).slice(0, 10);
            renderList('genre-combo', combo, item => ({
                label: `${item.label}｜平均 ${formatNumber(item.avgRating)} 分`,
                badge: `${item.count} 次`
            }), '暂无类型组合数据');
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
        const list = (creatorStatsCache[role] || []).filter(row => Number(row.count) >= 4);
        if (!list.length) {
            tbody.innerHTML = '<tr><td colspan="4">暂无符合（观影次数 ≥ 4）创作者数据</td></tr>';
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

        renderRegionBarChart(regionStats.slice(0, 6), regionTotal);
        renderLanguageDonutChart(languageStats.slice(0, 6), languageTotal);

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
        renderList('decade-summary', list, item => ({
            label: `${item.label}｜平均 ${formatNumber(item.avgRating)} 分`,
            badge: `${item.count} 部`
        }));
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
                { label: '评论条数', badge: `${comments.length} 条` },
                { label: '总字数', badge: `${totalChars.toLocaleString()} 字` },
                { label: '平均每条', badge: `${avg} 字` },
                longest.length ? { label: '最长评论', badge: `《${longest.title}》${longest.length} 字` } : '暂无显著长评'
            ] : ['尚无评论记录'],
            sentimentList: comments.length ? [
                { label: '正向', badge: `${sentiment.positive} 条` },
                { label: '中性', badge: `${sentiment.neutral} 条` },
                { label: '负向', badge: `${sentiment.negative} 条` }
            ] : ['暂无情感数据']
        };
    };

    renderers.renderCommentsAnalysis = items => {
        const { statsList, sentimentList } = analyzeComments(items);
        renderList('comments-stats', statsList, item => item);
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
        const pace = (timeAgg.datedCount && timeAgg.monthly.size) ? (timeAgg.datedCount / timeAgg.monthly.size).toFixed(1) : '—';
        const highestRatedGenre = genreStats.reduce((best, current) => {
            if (!Number.isFinite(current.avgRating)) return best;
            if (!best || (current.avgRating > best.avgRating)) return current;
            return best;
        }, null);

        const cards = [
            { label: '月均观影', value: pace !== '—' ? `${pace} 部` : '—' },
            { label: '常看类型', value: genreStats.length ? `${genreStats[0].label}（${genreStats[0].count} 部）` : '—' },
            { label: '偏好地区', value: regionStats.length ? `${regionStats[0].label}` : '—' },
            { label: '偏好语言', value: languageStats.length ? `${languageStats[0].label}` : '—' },
            { label: '均分最高类型', value: highestRatedGenre ? `${highestRatedGenre.label}（${formatNumber(highestRatedGenre.avgRating)} 分）` : '—' }
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

    const renderRegionBarChart = (data, total) => {
        const container = document.getElementById('region-bar-chart');
        if (!container) return;
        if (!data || !data.length) {
            container.innerHTML = '<div class="empty">暂无地区数据</div>';
            return;
        }
        const max = Math.max(...data.map(item => item.count), 1);
        container.innerHTML = data.map(item => {
            const width = ((item.count / max) * 100).toFixed(1);
            const share = formatShare(item.count, total);
            return `
                <div class="col-row">
                    <span class="col-label">${item.label}</span>
                    <div class="col-bar-wrap">
                        <div class="col-bar" style="width:${width}%"></div>
                    </div>
                    <span class="col-count">${share}%</span>
                </div>`;
        }).join('');
    };

    const renderLanguageDonutChart = (data, total) => {
        const container = document.getElementById('language-donut-chart');
        if (!container) return;
        if (!data || !data.length || !total) {
            container.innerHTML = '<div class="empty">暂无语言数据</div>';
            return;
        }
        const palette = ['#7dd3fc','#a5b4fc','#f472b6','#facc15','#34d399','#fb7185'];
        let acc = 0;
        const segments = data.map((item, idx) => {
            const pct = (item.count / total) * 100;
            const start = acc;
            acc += pct;
            return `${palette[idx % palette.length]} ${start}% ${Math.min(acc, 100)}%`;
        }).join(', ');
        const legends = data.map((item, idx) => {
            const share = formatShare(item.count, total);
            return `
                <div class="legend-item">
                    <span class="legend-dot" style="background:${palette[idx % palette.length]}"></span>
                    <span>${item.label}</span>
                    <span class="legend-share">${share}%</span>
                </div>`;
        }).join('');

        container.innerHTML = `
            <div class="donut" style="background: conic-gradient(${segments});"></div>
            <div class="legend">
                ${legends}
            </div>`;
    };

    const renderMonthlyTrendChart = data => {
        const container = document.getElementById('monthly-trend-chart');
        if (!container) return;
        if (!data || !data.length) {
            container.innerHTML = '<div class="empty">暂无月度数据</div>';
            return;
        }
        const counts = data.map(d => d.count || 0);
        const max = Math.max(...counts, 1);
        const labels = data.map(d => d.key);
        const viewW = 800, viewH = 220;
        const pad = { l: 50, r: 20, t: 20, b: 40 };
        const plotW = viewW - pad.l - pad.r;
        const plotH = viewH - pad.t - pad.b;
        const step = data.length > 1 ? plotW / (data.length - 1) : plotW;
        const points = counts.map((c, i) => ({
            x: pad.l + i * step,
            y: pad.t + (1 - c / max) * plotH,
            label: labels[i],
            count: c
        }));
        const areaPath = `M ${pad.l},${viewH - pad.b} ` + points.map(p => `L ${p.x},${p.y}`).join(' ') + ` L ${pad.l + plotW},${viewH - pad.b} Z`;
        const polyPoints = points.map(p => `${p.x},${p.y}`).join(' ');
        const primary = getComputedStyle(document.documentElement).getPropertyValue('--data-primary') || '#4338ca';
        const secondary = getComputedStyle(document.documentElement).getPropertyValue('--data-secondary') || '#0ea5e9';
        container.innerHTML = `
            <svg viewBox="0 0 ${viewW} ${viewH}" preserveAspectRatio="none">
                <defs>
                    <linearGradient id="monthlyArea" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stop-color="${primary.trim()}" stop-opacity="0.25"/>
                        <stop offset="100%" stop-color="${secondary.trim()}" stop-opacity="0.05"/>
                    </linearGradient>
                </defs>
                <path d="${areaPath}" fill="url(#monthlyArea)" stroke="none"></path>
                <polyline points="${polyPoints}" stroke="${primary.trim()}" fill="none" stroke-width="3"/>
                ${points.map(p => `<circle cx="${p.x}" cy="${p.y}" r="4" fill="#fff" stroke="${primary.trim()}"><title>${p.label}：${p.count} 部</title></circle>`).join('')}
                ${points.map((p,i) => (i % Math.ceil(points.length / 6) === 0 || i === points.length - 1)
                    ? `<text x="${p.x}" y="${viewH - 10}" class="x-label" text-anchor="middle">${p.label}</text>` : '').join('')}
            </svg>`;
    };

    const renderYearlyCompareChart = data => {
        const container = document.getElementById('yearly-compare-chart');
        if (!container) return;
        if (!data || !data.length) {
            container.innerHTML = '<div class="empty">暂无年度数据</div>';
            return;
        }
        const max = Math.max(...data.map(d => d.count || 0), 1);
        container.innerHTML = `
            <div class="bars">
                ${data.map(d => {
                    const h = ((d.count || 0) / max) * 100;
                    return `<div class="bar" style="height:${h}%"><span>${d.count}</span></div>`;
                }).join('')}
            </div>
            <div class="labels">
                ${data.map(d => `<span>${d.key}</span>`).join('')}
            </div>`;
    };

    const renderRatingTimelineChart = data => {
        const container = document.getElementById('rating-timeline-chart');
        if (!container) return;
        if (!data || !data.length) {
            container.innerHTML = '<div class="empty">暂无评分数据</div>';
            return;
        }
        const values = data.map(d => Number(d.avgRating) || 0);
        const max = Math.max(...values, 1);
        const min = Math.min(...values, 0);
        const viewW = 800, viewH = 180;
        const pad = { l: 40, r: 20, t: 20, b: 30 };
        const plotW = viewW - pad.l - pad.r;
        const plotH = viewH - pad.t - pad.b;
        const step = data.length > 1 ? plotW / (data.length - 1) : plotW;
        const primary = getComputedStyle(document.documentElement).getPropertyValue('--data-accent') || '#14b8a6';
        const points = values.map((val, i) => {
            const ratio = max === min ? 0.5 : (val - min) / (max - min);
            return { x: pad.l + i * step, y: pad.t + (1 - ratio) * plotH, label: data[i].key, val };
        });
        const polyPoints = points.map(p => `${p.x},${p.y}`).join(' ');
        container.innerHTML = `
            <svg viewBox="0 0 ${viewW} ${viewH}" preserveAspectRatio="none">
                <polyline points="${polyPoints}" stroke="${primary.trim()}" fill="none" stroke-width="2.5"/>
                ${points.map(p => `<circle cx="${p.x}" cy="${p.y}" r="4" fill="#fff" stroke="${primary.trim()}"><title>${p.label}：${formatNumber(p.val)}</title></circle>`).join('')}
                ${points.map((p,i) => (i % Math.ceil(points.length / 6) === 0 || i === points.length - 1)
                    ? `<text x="${p.x}" y="${viewH - 6}" class="x-label" text-anchor="middle">${p.label}</text>` : '').join('')}
            </svg>`;
    };
})();
