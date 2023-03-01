import * as sauce from '/shared/sauce/index.mjs';
import * as common from '/pages/src/common.mjs';

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
let imperial = !!common.settingsStore.get('/imperialUnits');
L.setImperial(imperial);

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
