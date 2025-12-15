(() => {
    const Analysis = window.Analysis = window.Analysis || {};
    const { renderers, filters, utils } = Analysis;
    if (!renderers || !filters || !utils) return;

    const state = { allItems: [] };

    const loadMovies = async () => {
        const res = await fetch('/data/movies.json', { cache: 'no-cache' });
        if (!res.ok) throw new Error('无法加载 movies.json');
        const data = await res.json();
        return Array.isArray(data.items) ? data.items : [];
    };

    const refreshDashboard = () => {
        const filtered = filters.getFilteredItems(state.allItems);
        const timeAgg = utils.buildTimeAggregations(filtered);
        renderers.populateSummary(filtered);
        renderers.populateLists(filtered);
        renderers.renderTimeAnalysis(filtered, timeAgg);
        renderers.renderRatingAndGenre(filtered, timeAgg);
        renderers.populateCreatorTable(filtered);
        renderers.renderRegionLanguageAndDuration(filtered);
        renderers.renderDecadeSummary(filtered);
        renderers.renderCommentsAnalysis(filtered);
        renderers.renderCorrelations(filtered);
        renderers.renderPersona(filtered, timeAgg);
    };

    document.addEventListener('DOMContentLoaded', async () => {
        try {
            filters.init(refreshDashboard);
            state.allItems = await loadMovies();
            filters.populateYearOptions(state.allItems);
            filters.applyPreset('this-year', false);
            refreshDashboard();
        } catch (err) {
            document.body.innerHTML = `<p style="color:#dc2626;">加载失败：${err.message}</p>`;
        }
    });
})();

