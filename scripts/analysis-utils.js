(() => {
    const Analysis = window.Analysis = window.Analysis || {};
    const utils = Analysis.utils = Analysis.utils || {};

    utils.stopWords = new Set([
        'the','a','an','and','or','but','if','then','else','when','while','of','at','by','for','with','without','to','from','in','on','into','onto','over','under','as','is','are','was','were','be','been','being','have','has','had','do','does','did','will','would','shall','should','can','could','may','might','must',
        'this','that','these','those','it','its','he','she','they','them','we','you','your','i','me','my','mine','our','ours','their','theirs','who','whom','which','what','where','when','why','how',
        'movie','film','watch','watched','seen','like','just','very','also','one','two','get','got','see','seen',
        '的','了','在','和','是','也','就','都','而','与','或','及','被','于','对','从','到','但','而且','所以','如果','因为','还有','我们','你们','他们','她们','它们','这','那','一个','没有','还是','已经','就是','对于','以及','其中','其中的'
    ]);
    utils.positiveWords = ['good','great','love','excellent','amazing','favorite','喜欢','好看','精彩','推荐','不错','喜爱','超赞'];
    utils.negativeWords = ['bad','terrible','boring','worst','disappoint','hate','难看','糟糕','失望','无聊','一般','欠缺'];

    utils.nounSuffixes = ['ment','ness','tion','sion','ity','er','or','ist','ism','age','ence','ship'];
    utils.adjSuffixes = ['able','ible','al','ful','ic','ive','less','ous','ish','y','ent','ant'];

    utils.normalizeField = value => {
        if (!value) return [];
        if (Array.isArray(value)) return value.map(v => (v || '').toString().trim()).filter(Boolean);
        return value.toString().split(/[，,、\/;|]+/).map(v => v.trim()).filter(Boolean);
    };
    utils.normalizeGenres = value => utils.normalizeField(value).filter(v => v !== '剧情');

    utils.aggregateFieldStats = (items, extractor) => {
        const map = new Map();
        items.forEach(item => {
            const vals = extractor(item) || [];
            vals.filter(Boolean).forEach(val => {
                const key = String(val).trim();
                if (!key) return;
                const entry = map.get(key) || { label: key, count: 0, ratingSum: 0, ratingCount: 0 };
                entry.count++;
                const r = Number(item.rating);
                if (Number.isFinite(r)) {
                    entry.ratingSum += r;
                    entry.ratingCount++;
                }
                map.set(key, entry);
            });
        });
        return [...map.values()].map(entry => ({
            label: entry.label,
            count: entry.count,
            avgRating: entry.ratingCount ? entry.ratingSum / entry.ratingCount : null
        })).sort((a, b) => b.count - a.count);
    };

    // 修复：计算数值数组的平均值，忽略非数值，若无有效数值返回 NaN
    utils.average = arr => {
        if (!Array.isArray(arr)) return NaN;
        const nums = arr.map(n => Number(n)).filter(Number.isFinite);
        if (!nums.length) return NaN;
        return nums.reduce((s, v) => s + v, 0) / nums.length;
    };

    utils.frequencyMap = (items, extractor) => {
        const map = new Map();
        items.forEach(item => {
            extractor(item).filter(Boolean).forEach(val => {
                map.set(val, (map.get(val) || 0) + 1);
            });
        });
        return [...map.entries()].sort((a, b) => b[1] - a[1]);
    };

    utils.parseDate = value => {
        if (!value) return null;
        const date = new Date(value);
        return Number.isNaN(date) ? null : date;
    };
    utils.formatDateDisplay = date => `${date.getFullYear()}年${String(date.getMonth() + 1).padStart(2, '0')}月`;

    utils.formatNumber = (value, digits = 2) => Number.isFinite(value) ? Number(value).toFixed(digits) : '—';
    utils.formatShare = (count, total, digits = 1) => {
        const n = Number(count) || 0;
        const t = Number(total) || 0;
        if (!t) return '0.0';
        return ((n / t) * 100).toFixed(digits);
    };

    utils.accumulateBucket = (map, key, rating) => {
        const entry = map.get(key) || { count: 0, ratingSum: 0, ratingCount: 0 };
        entry.count++;
        if (Number.isFinite(rating)) {
            entry.ratingSum += rating;
            entry.ratingCount++;
        }
        map.set(key, entry);
    };
    utils.accumulateStats = utils.accumulateBucket;

    utils.mapToDetailedList = map => [...map.entries()].map(([key, stats]) => ({
        key,
        count: stats.count,
        avgRating: stats.ratingCount ? stats.ratingSum / stats.ratingCount : null
    }));

    utils.getWeekKey = date => {
        const temp = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        const day = temp.getUTCDay() || 7;
        temp.setUTCDate(temp.getUTCDate() + 4 - day);
        const yearStart = new Date(Date.UTC(temp.getUTCFullYear(), 0, 1));
        const weekNumber = Math.ceil((((temp - yearStart) / 86400000) + 1) / 7);
        return `${temp.getUTCFullYear()}-W${String(weekNumber).padStart(2, '0')}`;
    };

    utils.toISODateString = d => d ? d.toISOString().slice(0, 10) : '';

    utils.buildTimeAggregations = items => {
        const agg = {
            daily: new Map(),
            weekly: new Map(),
            monthly: new Map(),
            yearly: new Map(),
            earliest: null,
            latest: null,
            datedCount: 0
        };
        items.forEach(item => {
            const date = utils.parseDate(item.updated_at);
            if (!date) return;
            agg.datedCount++;
            if (!agg.earliest || date < agg.earliest) agg.earliest = date;
            if (!agg.latest || date > agg.latest) agg.latest = date;
            const rating = Number(item.rating);
            utils.accumulateBucket(agg.daily, date.toISOString().slice(0, 10), rating);
            utils.accumulateBucket(agg.weekly, utils.getWeekKey(date), rating);
            utils.accumulateBucket(agg.monthly, `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`, rating);
            utils.accumulateBucket(agg.yearly, `${date.getFullYear()}`, rating);
        });
        return agg;
    };

    utils.buildRatingHistogram = ratings => {
        const bins = [
            { label: '1星', min: 1, max: 1 },
            { label: '2星', min: 2, max: 2 },
            { label: '3星', min: 3, max: 3 },
            { label: '4星', min: 4, max: 4 },
            { label: '5星', min: 5, max: 5 }
        ];
        return bins.map(bin => {
            const count = ratings.filter(r => r >= bin.min && r <= bin.max).length;
            return { label: bin.label, count, share: ratings.length ? ((count / ratings.length) * 100).toFixed(1) : '0.0' };
        });
    };

    utils.getQuantileValue = (sorted, q) => {
        if (!sorted.length) return null;
        const pos = (sorted.length - 1) * q;
        const base = Math.floor(pos);
        const rest = pos - base;
        return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
    };

    utils.computeQuantiles = ratings => {
        if (!ratings.length) return {};
        const sorted = [...ratings].sort((a, b) => a - b);
        return {
            min: sorted[0],
            median: utils.getQuantileValue(sorted, 0.5),
            max: sorted[sorted.length - 1]
        };
    };
})();
