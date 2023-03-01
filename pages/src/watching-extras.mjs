import * as sauce from '/shared/sauce/index.mjs';
import * as common from '/pages/src/common.mjs';
import * as color from '/pages/src/color.mjs';

common.settingsStore.setDefault({
    lockedFields: false,
    alwaysShowButtons: false,
    solidBackground: false,
    backgroundColor: '#00ff00',
    screens: [],
});

const doc = document.documentElement;
const L = sauce.locale;
const H = L.human;
const defaultLineChartLen = Math.ceil(window.innerWidth / 2);
const chartRefs = new Set();
let imperial = !!common.settingsStore.get('/imperialUnits');
L.setImperial(imperial);
let sport = 'cycling';
let powerZones;

const sectionSpecs = {
    'large-data-fields': {
        title: 'Data Fields (large)',
        baseType: 'data-fields',
        groups: 1,
    },
    'data-fields': {
        title: 'Data Fields',
        baseType: 'data-fields',
        groups: 1,
    },
    'split-data-fields': {
        title: 'Split Data Fields',
        baseType: 'data-fields',
        groups: 2,
    },
    'single-data-field': {
        title: 'Single Data Field',
        baseType: 'single-data-field',
        groups: 1,
    },
    'line-chart': {
        title: 'Line Chart',
        baseType: 'chart',
        alwaysRender: true,
        defaultSettings: {
            powerEn: true,
            hrEn: true,
            speedEn: true,
            cadenceEn: false,
            draft: false,
            wbalEn: false,
            markMax: 'power',
        },
    },
    'time-in-zones': {
        title: 'Time in Zones',
        baseType: 'time-in-zones',
        defaultSettings: {
            style: 'vert-bars',
            type: 'power',
        },
    },
};

const groupSpecs = {
    power: {
        title: 'Power',
        backgroundImage: 'url(/pages/images/fa/bolt-duotone.svg)',
        fields: [{
            id: 'pwr-avg-wkg',
            value: x => humanWkg(x.stats && x.stats.power.avg, x.athlete),
            label: 'avg',
            key: 'Avg',
            unit: 'w/kg',
        }, {
            id: 'pwr-smooth-1200-95-wkg',
            value: x => humanWkg(x.stats && (x.stats.power.smooth[1200] * 0.95), x.athlete),
            label: '20m 95%',
            key: '20m<tiny>95%</tiny>',
            unit: 'w/kg',
        }],
    },
    energy: {
        title: 'Energy',
        backgroundImage: 'url(/pages/images/fa/bolt-duotone.svg)',
        fields: [{
            id: 'energy-kcal',
            value: x => H.number(x.state && (x.state.kj / 4.184)),
            label: 'Energy',
            key: 'Energy<tiny>kcal</tiny>',
            unit: 'kcal',
        }],
    },
};

const lineChartFields = [{
    id: 'power',
    name: 'Power',
    color: '#46f',
    domain: [0, 700],
    rangeAlpha: [0.4, 1],
    points: [],
    get: x => x.state.power || 0,
    fmt: x => H.power(x, {seperator: ' ', suffix: true}),
}, {
    id: 'energy',
    name: 'Energy',
    color: '#4ee',
    domain: [0, 22000],
    rangeAlpha: [0.1, 0.8],
    points: [],
    get: x => x.state.kj ?? 0,
    fmt: x => H.number(x / 1000 / 4.184) + ' kcal',
    markMin: true,
}];


async function getTpl(name) {
    return await sauce.template.getTemplate(`templates/${name}.html.tpl`);
}


function humanWkg(v, athlete) {
    if (v == null || v === false) {
        return '-';
    }

    var {wkgPrecision} = common.settingsStore.get();

    return H.number(v / (athlete && athlete.weight), {precision: wkgPrecision ?? 1, fixed: 1});
}


function fmtDur(v, options) {
    if (v == null || v === Infinity || v === -Infinity || isNaN(v)) {
        return '-';
    }
    return H.timer(v, options);
}


const _events = new Map();
function getEventSubgroup(id) {
    if (!_events.has(id)) {
        _events.set(id, null);
        common.rpc.getEventSubgroup(id).then(x => {
            if (x) {
                _events.set(id, x);
            } else {
                // leave it null but allow retry later
                setTimeout(() => _events.delete(id), 30000);
            }
        });
    }
    return _events.get(id);
}


let _echartsLoading;
async function importEcharts() {
    if (!_echartsLoading) {
        _echartsLoading = Promise.all([
            import('../deps/src/echarts.mjs'),
            import('./echarts-sauce-theme.mjs'),
        ]).then(([ec, theme]) => {
            ec.registerTheme('sauce', theme.getTheme('dynamic'));
            addEventListener('resize', resizeCharts);
            return ec;
        });
    }
    return await _echartsLoading;
}


async function createLineChart(el, sectionId, settings) {
    const echarts = await importEcharts();
    const charts = await import('./charts.mjs');
    const fields = lineChartFields.filter(x => settings[x.id + 'En']);
    const lineChart = echarts.init(el, 'sauce', {renderer: 'svg'});
    const visualMapCommon = {
        show: false,
        type: 'continuous',
        hoverLink: false,
    };
    const seriesCommon = {
        type: 'line',
        animation: false,  // looks better and saves gobs of CPU
        showSymbol: false,
        emphasis: {disabled: true},
        areaStyle: {},
    };
    const dataPoints = settings.dataPoints || defaultLineChartLen;
    const options = {
        color: fields.map(f => f.color),
        visualMap: fields.map((f, i) => ({
            ...visualMapCommon,
            seriesIndex: i,
            min: f.domain[0],
            max: f.domain[1],
            inRange: {colorAlpha: f.rangeAlpha},
        })),
        grid: {top: 0, left: 0, right: 0, bottom: 0},
        legend: {show: false},
        tooltip: {
            className: 'ec-tooltip',
            trigger: 'axis',
            axisPointer: {label: {formatter: () => ''}}
        },
        xAxis: [{
            show: false,
            data: Array.from(new Array(dataPoints)).map((x, i) => i),
        }],
        yAxis: fields.map(f => ({
            show: false,
            min: x => Math.min(f.domain[0], x.min),
            max: x => Math.max(f.domain[1], x.max),
        })),
        series: fields.map((f, i) => ({
            ...seriesCommon,
            id: f.id,
            name: typeof f.name === 'function' ? f.name() : f.name,
            z: fields.length - i + 1,
            yAxisIndex: i,
            tooltip: {valueFormatter: f.fmt},
            lineStyle: {color: f.color},
        })),
    };
    lineChart.setOption(options);
    lineChart._sauceLegend = new charts.SauceLegend({
        el: el.nextElementSibling,
        chart: lineChart,
        hiddenStorageKey: `watching-hidden-graph-p${sectionId}`,
    });
    chartRefs.add(new WeakRef(lineChart));
    return lineChart;
}


function bindLineChart(lineChart, renderer, settings) {
    const fields = lineChartFields.filter(x => settings[x.id + 'En']);
    const dataPoints = settings.dataPoints || defaultLineChartLen;
    let dataCount = 0;
    let lastRender = 0;
    let oldSport;
    renderer.addCallback(data => {
        const now = Date.now();
        if (now - lastRender < 900) {
            return;
        }
        lastRender = now;
        if (data && data.state) {
            for (const x of fields) {
                x.points.push(x.get(data));
                while (x.points.length > dataPoints) {
                    x.points.shift();
                }
            }
        }
        lineChart.setOption({
            xAxis: [{
                data: [...sauce.data.range(dataPoints)].map(i =>
                    (dataCount > dataPoints ? dataCount - dataPoints : 0) + i),
            }],
            series: fields.map(field => ({
                data: field.points,
                name: typeof field.name === 'function' ? field.name() : field.name,
                markLine: settings.markMax === field.id ? {
                    symbol: 'none',
                    data: [{
                        name: field.markMin ? 'Min' : 'Max',
                        xAxis: field.points.indexOf(sauce.data[field.markMin ? 'min' : 'max'](field.points)),
                        label: {
                            formatter: x => {
                                const nbsp ='\u00A0';
                                return [
                                    ''.padStart(Math.max(0, 5 - x.value), nbsp),
                                    nbsp, nbsp, // for unit offset
                                    field.fmt(field.points[x.value]),
                                    ''.padEnd(Math.max(0, x.value - (dataPoints - 1) + 5), nbsp)
                                ].join('');
                            },
                        },
                        emphasis: {disabled: true},
                    }],
                } : undefined,
            })),
        });
        if (oldSport !== sport) {
            oldSport = sport;
            lineChart._sauceLegend.render();
        }
    });
}


async function createTimeInZonesVertBars(el, sectionId, settings, renderer) {
    const echarts = await importEcharts();
    const chart = echarts.init(el, 'sauce', {renderer: 'svg'});
    chart.setOption({
        grid: {top: '5%', left: '5%', right: '4', bottom: '3%', containLabel: true},
        tooltip: {
            className: 'ec-tooltip',
            trigger: 'axis',
            axisPointer: {type: 'shadow'}
        },
        xAxis: {type: 'category'},
        yAxis: {
            type: 'value',
            min: 0,
            splitNumber: 2,
            minInterval: 60,
            axisLabel: {
                formatter: fmtDur,
                rotate: 50
            }
        },
        series: [{
            type: 'bar',
            barWidth: '90%',
            tooltip: {valueFormatter: x => fmtDur(x, {long: true})},
        }],
    });
    chartRefs.add(new WeakRef(chart));
    let colors;
    let athleteId;
    let lastRender = 0;
    renderer.addCallback(data => {
        const now = Date.now();
        if (!data || !data.stats || !data.athlete || !data.athlete.ftp || now - lastRender < 900) {
            return;
        }
        lastRender = now;
        const extraOptions = {};
        if (data.athleteId !== athleteId) {
            athleteId = data.athleteId;
            colors = powerZoneColors(powerZones, c => ({
                c,
                g: new echarts.graphic.LinearGradient(0, 0, 1, 1, [
                    {offset: 0, color: c.toString()},
                    {offset: 1, color: c.alpha(0.5).toString()}
                ])
            }));
            Object.assign(extraOptions, {xAxis: {data: powerZones.map(x => x.zone)}});
        }
        chart.setOption({
            ...extraOptions,
            series: [{
                data: data.stats.power.timeInZones.map(x => ({
                    value: x.time,
                    itemStyle: {color: colors[x.zone].g},
                })),
            }],
        });
    });
}


async function createTimeInZonesHorizBar(el, sectionId, settings, renderer) {
    const colors = powerZoneColors(powerZones);
    const normZones = new Set(powerZones.filter(x => !x.overlap).map(x => x.zone));
    el.innerHTML = '';
    for (const x of normZones) {
        const c = colors[x];
        el.innerHTML += `<div class="zone" data-zone="${x}" style="` +
            `--theme-zone-color-hue: ${Math.round(c.h * 360)}deg; ` +
            `--theme-zone-color-sat: ${Math.round(c.s * 100)}%; ` +
            `--theme-zone-color-light: ${Math.round(c.l * 100)}%; ` +
            `--theme-zone-color-shade-dir: ${c.l > 0.65 ? -1 : 1}; ` +
            `"><span>${x}</span><span class="extra"></span></div>`;
    }
    let lastRender = 0;
    renderer.addCallback(data => {
        const now = Date.now();
        if (!data || !data.stats || !data.athlete || !data.athlete.ftp || now - lastRender < 900) {
            return;
        }
        lastRender = now;
        const zones = data.stats.power.timeInZones.filter(x => normZones.has(x.zone));
        const totalTime = zones.reduce((agg, x) => agg + x.time, 0);
        for (const x of zones) {
            const zoneEl = el.querySelector(`[data-zone="${x.zone}"]`);
            zoneEl.style.flexGrow = Math.round(100 * x.time / totalTime);
            zoneEl.querySelector('.extra').textContent = H.duration(x.time,
                {short: true, seperator: ' '});
        }
    });
}


async function createTimeInZonesPie(el, sectionId, settings, renderer) {
    const echarts = await importEcharts();
    const chart = echarts.init(el, 'sauce', {renderer: 'svg'});
    chart.setOption({
        grid: {top: '1', left: '1', right: '1', bottom: '1'},
        tooltip: {
            className: 'ec-tooltip'
        },
        series: [{
            type: 'pie',
            radius: ['30%', '90%'],
            minShowLabelAngle: 20,
            label: {
                show: true,
                position: 'inner',
            },
            tooltip: {
                valueFormatter: x => fmtDur(x, {long: true})
            },
            emphasis: {
                itemStyle: {
                    shadowBlur: 10,
                    shadowOffsetX: 0,
                    shadowColor: 'rgba(0, 0, 0, 0.5)'
                }
            }
        }],
    });
    chartRefs.add(new WeakRef(chart));
    let colors;
    let athleteId;
    let lastRender = 0;
    let normZones;
    renderer.addCallback(data => {
        const now = Date.now();
        if (!data || !data.stats || !data.athlete || !data.athlete.ftp || now - lastRender < 900) {
            return;
        }
        lastRender = now;
        if (data.athleteId !== athleteId) {
            athleteId = data.athleteId;
            colors = powerZoneColors(powerZones, c => ({
                c,
                g: new echarts.graphic.LinearGradient(0, 0, 1, 1, [
                    {offset: 0, color: c.toString()},
                    {offset: 1, color: c.alpha(0.6).toString()}
                ])
            }));
            normZones = new Set(powerZones.filter(x => !x.overlap).map(x => x.zone));
        }
        chart.setOption({
            series: [{
                data: data.stats.power.timeInZones.filter(x => normZones.has(x.zone)).map(x => ({
                    name: x.zone,
                    value: x.time,
                    label: {color: colors[x.zone].c.l > 0.65 ? '#000b' : '#fffb'},
                    itemStyle: {color: colors[x.zone].g},
                })),
            }],
        });
    });
}


function powerZoneColors(zones, fn) {
    const colors = {};
    for (const [k, v] of Object.entries(common.getPowerZoneColors(zones))) {
        const c = color.parse(v);
        colors[k] = fn ? fn(c) : c;
    }
    return colors;
}


function resizeCharts() {
    for (const r of chartRefs) {
        const c = r.deref();
        if (!c) {
            chartRefs.delete(r);
        } else {
            c.resize();
        }
    }
}


function setBackground() {
    const {solidBackground, backgroundColor} = common.settingsStore.get();
    doc.classList.toggle('solid-background', !!solidBackground);
    if (solidBackground) {
        doc.style.setProperty('--background-color', backgroundColor);
    } else {
        doc.style.removeProperty('--background-color');
    }
}


async function initScreenSettings() {
    const layoutTpl = await getTpl('watching-extras-screen-layout');
    let sIndex = 0;
    const activeScreenEl = document.querySelector('main .active-screen');
    const sIndexEl = document.querySelector('.sIndex');
    const sLenEl = document.querySelector('.sLen');
    const prevBtn = document.querySelector('main header .button[data-action="prev"]');
    const nextBtn = document.querySelector('main header .button[data-action="next"]');
    const delBtn = document.querySelector('main header .button[data-action="delete"]');
    document.querySelector('main .add-section select[name="type"]').innerHTML = Object.entries(sectionSpecs)
        .map(([type, {title}]) => `<option value="${type}">${title}</option>`).join('\n');
    const settings = common.settingsStore.get();

    async function renderScreen() {
        sIndexEl.textContent = sIndex + 1;
        const sLen = settings.screens.length;
        sLenEl.textContent = sLen;
        const screen = settings.screens[sIndex];
        const screenEl = (await layoutTpl({
            screen,
            sIndex,
            groupSpecs,
            sectionSpecs,
            configuring: true
        })).querySelector('.screen');
        activeScreenEl.innerHTML = '';
        activeScreenEl.appendChild(screenEl);
        prevBtn.classList.toggle('disabled', sIndex === 0);
        nextBtn.classList.toggle('disabled', sIndex === sLen - 1);
        delBtn.classList.toggle('disabled', sLen === 1);
    }

    document.querySelector('main header .button-group').addEventListener('click', ev => {
        const btn = ev.target.closest('.button-group .button');
        const action = btn && btn.dataset.action;
        if (!action) {
            return;
        }
        if (action === 'add') {
            settings.screens.push({
                id: `user-section-${settings.screens.length +1}-${Date.now()}`,
                sections: []
            });
            common.settingsStore.set(null, settings);
            sIndex = settings.screens.length - 1;
            renderScreen();
        } else if (action === 'next') {
            sIndex++;
            renderScreen();
        } else if (action === 'prev') {
            sIndex--;
            renderScreen();
        } else if (action === 'delete') {
            settings.screens.splice(sIndex, 1);
            sIndex = Math.max(0, sIndex -1);
            common.settingsStore.set(null, settings);
            renderScreen();
        }
    });
    document.querySelector('main .add-section input[type="button"]').addEventListener('click', ev => {
        ev.preventDefault();
        const type = ev.currentTarget.closest('.add-section').querySelector('select[name="type"]').value;
        const screen = settings.screens[sIndex];
        const sectionSpec = sectionSpecs[type];
        screen.sections.push({
            type,
            id: `user-section-${Date.now()}`,
            groups: sectionSpec.groups ? Array.from(new Array(sectionSpec.groups)).map((_, i) => ({
                id: `user-group-${i}-${Date.now()}`,
                type: Object.keys(groupSpecs)[i] || 'power',
            })) : undefined,
            settings: {...sectionSpec.defaultSettings},
        });
        common.settingsStore.set(null, settings);
        renderScreen();
    });
    activeScreenEl.addEventListener('click', ev => {
        const btn = ev.target.closest('.screen-section .button-group .button');
        const action = btn && btn.dataset.action;
        if (!action) {
            return;
        }
        const sectionEl = btn.closest('.screen-section');
        const sectionId = sectionEl.dataset.sectionId;
        const screen = settings.screens[sIndex];
        if (action === 'edit') {
            const d = sectionEl.querySelector('dialog.edit');
            d.addEventListener('close', ev => {
                if (d.returnValue !== 'save') {
                    return;
                }
                const section = screen.sections.find(x => x.id === sectionId);
                if (!section.settings) {
                    section.settings = {...sectionSpecs[section.type].defaultSettings};
                }
                // Groups are special...
                for (const x of d.querySelectorAll('select[name="group"]')) {
                    section.groups.find(xx => xx.id === x.dataset.id).type = x.value;
                }
                // Everything else is a generic setting...
                for (const x of d.querySelectorAll('select:not([name="group"])')) {
                    let value = x.value === '' ? undefined : x.value;
                    if (value !== undefined && x.dataset.type === 'number') {
                        value = Number(value);
                    }
                    section.settings[x.name] = value;
                }
                for (const x of d.querySelectorAll('input[type="number"]')) {
                    section.settings[x.name] = x.value === '' ? undefined : Number(x.value);
                }
                for (const x of d.querySelectorAll('input[type="checkbox"]')) {
                    section.settings[x.name] = !!x.checked;
                }
                for (const x of d.querySelectorAll('input[type="text"]')) {
                    section.settings[x.name] = x.value || undefined;
                }
                common.settingsStore.set(null, settings);
                renderScreen();
            }, {once: true});
            d.showModal();
        } else if (action === 'delete') {
            screen.sections.splice(screen.sections.findIndex(x => x.id === sectionId), 1);
            common.settingsStore.set(null, settings);
            renderScreen();
        } else {
            throw new TypeError("Invalid action: " + action);
        }
    });
    await renderScreen();
}


export async function main() {
    common.initInteractionListeners();
    setBackground();
    const settings = common.settingsStore.get();
    doc.classList.toggle('always-show-buttons', !!settings.alwaysShowButtons);
    const content = document.querySelector('#content');
    const renderers = [];
    let curScreen;
    powerZones = await common.rpc.getPowerZones(1);
    const layoutTpl = await getTpl('watching-extras-screen-layout');
    let persistentData = settings.screens.some(x => x.sections.some(xx => sectionSpecs[xx.type].alwaysRender));
    for (const [sIndex, screen] of settings.screens.entries()) {
        const screenEl = (await layoutTpl({
            screen,
            sIndex,
            groupSpecs,
            sectionSpecs
        })).querySelector('.screen');
        if (sIndex) {
            screenEl.classList.add('hidden');
        } else {
            curScreen = screenEl;
        }
        content.appendChild(screenEl);
        const renderer = new common.Renderer(screenEl, {
            id: screen.id,
            fps: null,
            locked: settings.lockedFields,
            backgroundRender: screen.sections.some(x => sectionSpecs[x.type].alwaysRender),
        });
        for (const section of screen.sections) {
            const sectionSpec = sectionSpecs[section.type];
            const baseType = sectionSpec.baseType;
            const settings = section.settings || {...sectionSpec.defaultSettings};
            const sectionEl = screenEl.querySelector(`[data-section-id="${section.id}"]`);
            if (baseType === 'data-fields') {
                const groups = [
                    sectionEl.dataset.groupId ? sectionEl : null,
                    ...sectionEl.querySelectorAll('[data-group-id]')
                ].filter(x => x);
                for (const groupEl of groups) {
                    const mapping = [];
                    for (const [i, fieldEl] of groupEl.querySelectorAll('[data-field]').entries()) {
                        const id = fieldEl.dataset.field;
                        mapping.push({id, default: Number(fieldEl.dataset.default || i)});
                    }
                    const groupSpec = groupSpecs[groupEl.dataset.groupType];
                    renderer.addRotatingFields({
                        el: groupEl,
                        mapping,
                        fields: groupSpec.fields,
                    });
                    if (typeof groupSpec.title === 'function') {
                        const titleEl = groupEl.querySelector('.group-title');
                        renderer.addCallback(() => {
                            const title = groupSpec.title() || '';
                            if (common.softInnerHTML(titleEl, title)) {
                                titleEl.title = title;
                            }
                        });
                    }
                }
            } else if (baseType === 'single-data-field') {
                const groups = [
                    sectionEl.dataset.groupId ? sectionEl : null,
                    ...sectionEl.querySelectorAll('[data-group-id]')
                ].filter(x => x);
                for (const groupEl of groups) {
                    const mapping = [];
                    for (const [i, fieldEl] of groupEl.querySelectorAll('[data-field]').entries()) {
                        const id = fieldEl.dataset.field;
                        mapping.push({id, default: Number(fieldEl.dataset.default || i)});
                    }
                    const groupSpec = groupSpecs[groupEl.dataset.groupType];
                    renderer.addRotatingFields({
                        el: groupEl,
                        mapping,
                        fields: groupSpec.fields,
                    });
                    if (typeof groupSpec.title === 'function') {
                        const titleEl = groupEl.querySelector('.group-title');
                        renderer.addCallback(() => {
                            const title = groupSpec.title() || '';
                            if (common.softInnerHTML(titleEl, title)) {
                                titleEl.title = title;
                            }
                        });
                    }
                }
            } else if (baseType === 'chart') {
                if (section.type === 'line-chart') {
                    const lineChart = await createLineChart(
                        sectionEl.querySelector('.chart-holder.ec'),
                        sectionEl.dataset.sectionId,
                        settings);
                    bindLineChart(lineChart, renderer, settings);
                } else {
                    console.error("Invalid chart type:", section.type);
                }
            } else if (baseType === 'time-in-zones') {
                if (section.type === 'time-in-zones') {
                    const el = sectionEl.querySelector('.zones-holder');
                    const id = sectionEl.dataset.sectionId;
                    if (settings.style === 'vert-bars') {
                        await createTimeInZonesVertBars(el, id, settings, renderer);
                    } else if (settings.style === 'pie') {
                        await createTimeInZonesPie(el, id, settings, renderer);
                    } else if (settings.style === 'horiz-bar') {
                        await createTimeInZonesHorizBar(el, id, settings, renderer);
                    }
                } else {
                    console.error("Invalid time-in-zones type:", section.type);
                }
            } else {
                console.error("Invalid base type:", baseType);
            }
        }
        renderers.push(renderer);
        renderer.setData({});
        renderer.render();
    }
    const bbSelector = settings.alwaysShowButtons ? '.fixed.button-bar' : '#titlebar .button-bar';
    const prevBtn = document.querySelector(`${bbSelector} .button.prev-screen`);
    const nextBtn = document.querySelector(`${bbSelector} .button.next-screen`);
    prevBtn.classList.add('disabled');
    if (settings.screens.length === 1) {
        nextBtn.classList.add('disabled');
    }
    prevBtn.addEventListener('click', ev => {
        if (!curScreen.previousElementSibling) {
            return;
        }
        curScreen.classList.add('hidden');
        curScreen = curScreen.previousElementSibling;
        curScreen.classList.remove('hidden');
        nextBtn.classList.remove('disabled');
        resizeCharts();
        if (Number(curScreen.dataset.index) === 0) {
            prevBtn.classList.add('disabled');
        }
    });
    nextBtn.addEventListener('click', ev => {
        if (!curScreen.nextElementSibling) {
            return;
        }
        curScreen.classList.add('hidden');
        curScreen = curScreen.nextElementSibling;
        curScreen.classList.remove('hidden');
        prevBtn.classList.remove('disabled');
        resizeCharts();
        if (settings.screens.length === Number(curScreen.dataset.index) + 1) {
            nextBtn.classList.add('disabled');
        }
    });
    const resetBtn = document.querySelector(`${bbSelector} .button.reset`);
    resetBtn.addEventListener('click', ev => {
        common.rpc.resetStats();
    });
    const lapBtn = document.querySelector(`${bbSelector} .button.lap`);
    lapBtn.addEventListener('click', ev => {
        common.rpc.startLap();
    });
    document.addEventListener('keydown', ev => {
        if (ev.ctrlKey && ev.shiftKey) {
            if (ev.key === 'ArrowRight') {
                ev.preventDefault();
                nextBtn.click();
            } else if (ev.key === 'ArrowLeft') {
                ev.preventDefault();
                prevBtn.click();
            } else if (ev.key === 'L') {
                ev.preventDefault();
                lapBtn.click();
            } else if (ev.key === 'R') {
                ev.preventDefault();
                resetBtn.click();
            }
        }
    }, {capture: true});
    common.settingsStore.addEventListener('changed', ev => {
        const changed = ev.data.changed;
        if (changed.size === 1) {
            if (changed.has('backgroundColor')) {
                setBackground();
            } else if (changed.has('/imperialUnits')) {
                imperial = changed.get('/imperialUnits');
            } else if (!changed.has('/theme')) {
                location.reload();
            }
        } else {
            location.reload();
        }
    });
    let athleteId;
    if (!location.search.includes('testing')) {
        common.subscribe('athlete/watching', watching => {
            const force = watching.athleteId !== athleteId;
            athleteId = watching.athleteId;
            sport = watching.state.sport || 'cycling';
            eventMetric = watching.remainingMetric;
            eventSubgroup = getEventSubgroup(watching.state.eventSubgroupId);
            for (const x of renderers) {
                x.setData(watching);
                if (x.backgroundRender || !x._contentEl.classList.contains('hidden')) {
                    x.render({force});
                }
            }
        }, {persistent: persistentData});
    } else {
        setInterval(() => {
            for (const x of renderers) {
                x.setData({
                    athleteId: 11,
                    athlete: {
                        ftp: 300,
                    },
                    state: {
                        power: 100 + (Math.random() * 400),
                        heartrate: 100 + Math.random() * 100,
                        speed: Math.random() * 100,
                    },
                    stats: {
                        power: {
                            timeInZones: [
                                {zone: 'Z1', time: 2 + 100 * Math.random()},
                                {zone: 'Z2', time: 2 + 100 * Math.random()},
                                {zone: 'Z3', time: 2 + 100 * Math.random()},
                                {zone: 'Z4', time: 2 + 100 * Math.random()},
                                {zone: 'Z5', time: 2 + 100 * Math.random()},
                                {zone: 'Z6', time: 2 + 100 * Math.random()},
                                {zone: 'Z7', time: 2 + 100 * Math.random()},
                                //{zone: 'SS', time: 2 + 100 * Math.random()},
                            ]
                        }
                    }
                });
                if (x.backgroundRender || !x._contentEl.classList.contains('hidden')) {
                    x.render();
                }
            }
        }, 1000);
    }
}


export async function settingsMain() {
    common.initInteractionListeners();
    await common.initSettingsForm('form#general')();
    await initScreenSettings();
}
