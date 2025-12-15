(() => {
    const Analysis = window.Analysis = window.Analysis || {};
    const utils = Analysis.utils;
    if (!utils) return;
    const filters = Analysis.filters = Analysis.filters || {};

    let filterStart, filterEnd, filterPreset, filterYear, filterMonth;
    let refreshCallback = () => {};

    const getInputs = () => {
        filterStart = document.getElementById('filter-start');
        filterEnd = document.getElementById('filter-end');
        filterPreset = document.getElementById('filter-preset');
        filterYear = document.getElementById('filter-year');
        filterMonth = document.getElementById('filter-month');
    };

    const setRangeDates = (startDate, endDate) => {
        if (filterStart) filterStart.value = startDate ? utils.toISODateString(startDate) : '';
        if (filterEnd) filterEnd.value = endDate ? utils.toISODateString(endDate) : '';
    };

    const applyPresetInternal = preset => {
        const now = new Date();
        let start = null;
        let end = null;
        if (preset === 'this-year') {
            start = new Date(now.getFullYear(), 0, 1);
            end = now;
        } else if (preset === 'this-month') {
            start = new Date(now.getFullYear(), now.getMonth(), 1);
            end = now;
        } else if (preset === 'last-3-months') {
            const s = new Date(now.getFullYear(), now.getMonth(), 1);
            s.setMonth(s.getMonth() - 2);
            start = s;
            end = now;
        } else if (preset === 'last-year') {
            const y = now.getFullYear() - 1;
            start = new Date(y, 0, 1);
            end = new Date(y, 11, 31);
        } else if (preset === 'all') {
            start = null;
            end = null;
        } else if (preset === 'custom') {
            return;
        }
        setRangeDates(start, end);
    };

    const applyYearMonthAsRange = () => {
        const year = filterYear && filterYear.value ? Number(filterYear.value) : null;
        const month = filterMonth && filterMonth.value ? Number(filterMonth.value) : null;
        if (!year && !month) return;
        let start = null;
        let end = null;
        if (year && month) {
            start = new Date(year, month - 1, 1);
            end = new Date(year, month, 0);
        } else if (year) {
            start = new Date(year, 0, 1);
            end = new Date(year, 11, 31);
        }
        setRangeDates(start, end);
        if (filterPreset) filterPreset.value = 'custom';
        refreshCallback();
    };

    filters.init = refreshFn => {
        refreshCallback = refreshFn || (() => {});
        getInputs();
        filterPreset?.addEventListener('change', () => {
            applyPresetInternal(filterPreset.value);
            refreshCallback();
        });
        filterYear?.addEventListener('change', applyYearMonthAsRange);
        filterMonth?.addEventListener('change', applyYearMonthAsRange);
        filterStart?.addEventListener('change', () => {
            if (filterPreset) filterPreset.value = 'custom';
            refreshCallback();
        });
        filterEnd?.addEventListener('change', () => {
            if (filterPreset) filterPreset.value = 'custom';
            refreshCallback();
        });
    };

    filters.getFilteredItems = allItems => {
        const start = filterStart?.value ? new Date(filterStart.value) : null;
        const end = filterEnd?.value ? new Date(filterEnd.value) : null;
        return allItems.filter(item => {
            if (!item.updated_at) return !start && !end;
            const date = new Date(item.updated_at);
            if (Number.isNaN(date)) return true;
            if (start && date < start) return false;
            return !(end && date > end);
        });
    };

    filters.getSelectedRange = () => ({
        start: filterStart?.value ? new Date(filterStart.value) : null,
        end: filterEnd?.value ? new Date(filterEnd.value) : null
    });

    filters.populateYearOptions = items => {
        if (!filterYear) return;
        const years = new Set();
        items.forEach(it => {
            const d = utils.parseDate(it.updated_at);
            if (d) years.add(d.getFullYear());
            else {
                const y = Number(it.release_year);
                if (Number.isFinite(y)) years.add(y);
            }
        });
        const currentYear = new Date().getFullYear();
        if (!years.size) for (let y = currentYear - 9; y <= currentYear; y++) years.add(y);
        const arr = [...years].sort((a, b) => b - a);
        filterYear.innerHTML = arr.map(y => `<option value="${y}">${y}</option>`).join('');
        if (arr.includes(currentYear)) filterYear.value = String(currentYear);
        else filterYear.selectedIndex = 0;
    };

    filters.applyPreset = (preset, shouldRefresh = true) => {
        if (filterPreset) filterPreset.value = preset;
        applyPresetInternal(preset);
        if (shouldRefresh) refreshCallback();
    };
})();
