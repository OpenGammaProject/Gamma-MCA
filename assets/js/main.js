import { SpectrumPlot, SeekClosest } from './plot.js';
import { RawData } from './raw-data.js';
import { SerialManager } from './serial.js';
export class SpectrumData {
    data = [];
    background = [];
    dataCps = [];
    backgroundCps = [];
    dataTime = 1000;
    backgroundTime = 1000;
    getTotalCounts(type) {
        return this[type].reduce((acc, curr) => acc + curr, 0);
    }
    addPulseData(type, newDataArr, adcChannels) {
        if (!this[type].length)
            this[type] = Array(adcChannels).fill(0);
        for (const value of newDataArr) {
            this[type][value] += 1;
        }
    }
    addHist(type, newHistArr) {
        if (!this[type].length)
            this[type] = newHistArr;
        for (const index in newHistArr) {
            this[type][index] += newHistArr[index];
        }
    }
}
const spectrumData = new SpectrumData();
const plot = new SpectrumPlot('plot');
const raw = new RawData(1);
const calClick = { a: false, b: false, c: false };
const oldCalVals = { a: '', b: '', c: '' };
const portsAvail = {};
let refreshRate = 1000;
let maxRecTimeEnabled = false;
let maxRecTime = 1800000;
const REFRESH_META_TIME = 200;
const CONSOLE_REFRESH = 200;
let cpsValues = [];
let isoListURL = 'assets/isotopes_energies_min.json';
const isoList = {};
let checkNearIso = false;
let maxDist = 100;
const APP_VERSION = '2023-02-02';
let localStorageAvailable = false;
let firstInstall = false;
document.body.onload = async function () {
    localStorageAvailable = 'localStorage' in self;
    if (localStorageAvailable)
        loadSettingsStorage();
    if (navigator.serviceWorker) {
        const reg = await navigator.serviceWorker.register('/service-worker.js');
        if (localStorageAvailable) {
            reg.addEventListener('updatefound', () => {
                if (firstInstall)
                    return;
                popupNotification('update-installed');
            });
        }
    }
    if ('standalone' in window.navigator || window.matchMedia('(display-mode: standalone)').matches) {
        document.title += ' PWA';
        document.getElementById('main').classList.remove('p-1');
    }
    else {
        document.getElementById('main').classList.remove('pb-1');
        document.title += ' web application';
    }
    isoListURL = new URL(isoListURL, window.location.origin).href;
    if (navigator.serial) {
        const serErrDiv = document.getElementById('serial-error');
        serErrDiv.parentNode.removeChild(serErrDiv);
        navigator.serial.addEventListener('connect', serialConnect);
        navigator.serial.addEventListener('disconnect', serialDisconnect);
        listSerial();
    }
    else {
        const serDiv = document.getElementById('serial-div');
        serDiv.parentNode.removeChild(serDiv);
        const serSettingsElements = document.getElementsByClassName('ser-settings');
        for (const element of serSettingsElements) {
            element.disabled = true;
        }
        const serControlsElements = document.getElementsByClassName('serial-controls');
        for (const element of serControlsElements) {
            element.disabled = true;
        }
    }
    if ('launchQueue' in window && 'LaunchParams' in window) {
        window.launchQueue.setConsumer(async (launchParams) => {
            if (!launchParams.files.length)
                return;
            const file = await launchParams.files[0].getFile();
            const fileEnding = file.name.split('.')[1].toLowerCase();
            const spectrumEndings = ['csv', 'tka', 'xml', 'txt', 'json'];
            if (spectrumEndings.includes(fileEnding))
                getFileData(file);
            console.warn('File could not be imported!');
        });
    }
    resetPlot();
    document.getElementById('version-tag').innerText += ` ${APP_VERSION}.`;
    if (localStorageAvailable) {
        if (loadJSON('lastVisit') <= 0) {
            popupNotification('welcome-msg');
            firstInstall = true;
        }
        saveJSON('lastVisit', Date.now());
        saveJSON('lastUsedVersion', APP_VERSION);
        const sVal = loadJSON('serialDataMode');
        const rVal = loadJSON('fileDataMode');
        if (sVal) {
            const element = document.getElementById(sVal);
            element.checked = true;
            selectSerialType(element);
        }
        if (rVal) {
            const element = document.getElementById(rVal);
            element.checked = true;
            selectFileType(element);
        }
        const settingsNotSaveAlert = document.getElementById('ls-unavailable');
        settingsNotSaveAlert.parentNode.removeChild(settingsNotSaveAlert);
        const getAutoScrollValue = loadJSON('consoleAutoscrollEnabled');
        if (getAutoScrollValue) {
            autoscrollEnabled = getAutoScrollValue;
            document.getElementById('autoscroll-console').checked = getAutoScrollValue;
        }
    }
    else {
        const settingsSaveAlert = document.getElementById('ls-available');
        settingsSaveAlert.parentNode.removeChild(settingsSaveAlert);
        popupNotification('welcome-msg');
    }
    loadSettingsDefault();
    sizeCheck();
    const enterPressObj = {
        'smaVal': 'sma',
        'ser-command': 'send-command',
        'iso-hover-prox': 'setting1',
        'custom-url': 'setting2',
        'custom-delimiter': 'setting3',
        'custom-file-adc': 'setting4',
        'custom-baud': 'setting5',
        'eol-char': 'setting5-1',
        'ser-limit': 'ser-limit-btn',
        'custom-ser-refresh': 'setting6',
        'custom-ser-buffer': 'setting7',
        'custom-ser-adc': 'setting8',
        'peak-thres': 'setting9',
        'peak-lag': 'setting10',
        'peak-width': 'setting11',
        'seek-width': 'setting12'
    };
    for (const [key, value] of Object.entries(enterPressObj)) {
        document.getElementById(key).onkeydown = event => enterPress(event, value);
    }
    const menuElements = document.getElementById('main-tabs').getElementsByTagName('button');
    for (const button of menuElements) {
        button.addEventListener('shown.bs.tab', (event) => {
            const toggleCalChartElement = document.getElementById('toggle-calibration-chart');
            if (event.target.id !== 'calibration-tab' && toggleCalChartElement.checked) {
                toggleCalChartElement.checked = false;
                toggleCalChart(false);
            }
            else {
                plot.updatePlot(spectrumData);
            }
        });
    }
    popupNotification('poll-msg');
    const loadingSpinner = document.getElementById('loading');
    loadingSpinner.parentNode.removeChild(loadingSpinner);
};
window.onbeforeunload = () => {
    return 'Are you sure to leave?';
};
document.body.onresize = () => {
    plot.updatePlot(spectrumData);
    if (navigator.userAgent.toLowerCase().match(/mobile|tablet|android|webos|iphone|ipad|ipod|blackberry|bb|playbook|iemobile|windows phone|kindle|silk|opera mini/i)) {
    }
    else {
        sizeCheck();
    }
};
window.matchMedia('(display-mode: standalone)').addEventListener('change', () => {
    window.location.reload();
});
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    if (localStorageAvailable) {
        if (!loadJSON('installPrompt')) {
            popupNotification('pwa-installer');
            saveJSON('installPrompt', true);
        }
    }
    document.getElementById('manual-install').classList.remove('d-none');
});
document.getElementById('install-pwa-btn').onclick = () => installPWA();
document.getElementById('install-pwa-toast-btn').onclick = () => installPWA();
async function installPWA() {
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
}
window.addEventListener('onappinstalled', () => {
    deferredPrompt = null;
    hideNotification('pwa-installer');
    document.getElementById('manual-install').classList.add('d-none');
});
document.getElementById('data').onclick = event => { event.target.value = ''; };
document.getElementById('background').onclick = event => { event.target.value = ''; };
document.getElementById('data').onchange = event => importFile(event.target);
document.getElementById('background').onchange = event => importFile(event.target, true);
function importFile(input, background = false) {
    if (!input.files?.length)
        return;
    getFileData(input.files[0], background);
}
function getFileData(file, background = false) {
    const reader = new FileReader();
    const fileEnding = file.name.split('.')[1];
    reader.readAsText(file);
    reader.onload = async () => {
        const result = reader.result.trim();
        if (fileEnding.toLowerCase() === 'xml') {
            if (window.DOMParser) {
                const { espectrum, bgspectrum, coeff, meta } = raw.xmlToArray(result);
                document.getElementById('sample-name').value = meta.name;
                document.getElementById('sample-loc').value = meta.location;
                if (meta.time) {
                    const date = new Date(meta.time);
                    const rightDate = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000);
                    document.getElementById('sample-time').value = rightDate.toISOString().slice(0, 16);
                }
                document.getElementById('sample-vol').value = meta.volume?.toString() ?? '';
                document.getElementById('sample-weight').value = meta.weight?.toString() ?? '';
                document.getElementById('device-name').value = meta.deviceName;
                document.getElementById('add-notes').value = meta.notes;
                startDate = new Date(meta.startTime);
                endDate = new Date(meta.endTime);
                if (espectrum?.length && bgspectrum?.length) {
                    spectrumData.data = espectrum;
                    spectrumData.background = bgspectrum;
                    spectrumData.dataTime = meta.dataMt * 1000;
                    spectrumData.backgroundTime = meta.backgroundMt * 1000;
                    if (meta.dataMt)
                        spectrumData.dataCps = spectrumData.data.map(val => val / meta.dataMt);
                    if (meta.backgroundMt)
                        spectrumData.backgroundCps = spectrumData.background.map(val => val / meta.backgroundMt);
                }
                else if (!espectrum?.length && !bgspectrum?.length) {
                    popupNotification('file-error');
                }
                else {
                    const fileData = espectrum?.length ? espectrum : bgspectrum;
                    const fileDataTime = (espectrum?.length ? meta.dataMt : meta.backgroundMt) * 1000;
                    const fileDataType = background ? 'background' : 'data';
                    spectrumData[fileDataType] = fileData;
                    spectrumData[`${fileDataType}Time`] = fileDataTime;
                    if (fileDataTime)
                        spectrumData[`${fileDataType}Cps`] = spectrumData[fileDataType].map(val => val / fileDataTime * 1000);
                }
                const importedCount = Object.values(coeff).filter(value => value !== 0).length;
                if (importedCount >= 2) {
                    resetCal();
                    plot.calibration.coeff = coeff;
                    plot.calibration.imported = true;
                    displayCoeffs();
                    const calSettings = document.getElementsByClassName('cal-setting');
                    for (const element of calSettings) {
                        element.disabled = true;
                    }
                    addImportLabel();
                }
            }
            else {
                console.error('No DOM parser in this browser!');
            }
        }
        else if (fileEnding.toLowerCase() === 'json') {
            const importData = await raw.jsonToObject(result);
            if (!importData) {
                popupNotification('npes-error');
                return;
            }
            document.getElementById('device-name').value = importData?.deviceData?.deviceName ?? '';
            document.getElementById('sample-name').value = importData?.sampleInfo?.name ?? '';
            document.getElementById('sample-loc').value = importData?.sampleInfo?.location ?? '';
            if (importData.sampleInfo?.time) {
                const date = new Date(importData.sampleInfo.time);
                const rightDate = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000);
                document.getElementById('sample-time').value = rightDate.toISOString().slice(0, 16);
            }
            document.getElementById('sample-weight').value = importData.sampleInfo?.weight?.toString() ?? '';
            document.getElementById('sample-vol').value = importData.sampleInfo?.volume?.toString() ?? '';
            document.getElementById('add-notes').value = importData.sampleInfo?.note ?? '';
            const resultData = importData.resultData;
            if (resultData.startTime && resultData.endTime) {
                startDate = new Date(resultData.startTime);
                endDate = new Date(resultData.endTime);
            }
            const espectrum = resultData.energySpectrum;
            const bgspectrum = resultData.backgroundEnergySpectrum;
            if (espectrum && bgspectrum) {
                spectrumData.data = espectrum.spectrum;
                spectrumData.background = bgspectrum.spectrum;
                const eMeasurementTime = espectrum.measurementTime;
                if (eMeasurementTime) {
                    spectrumData.dataTime = eMeasurementTime * 1000;
                    spectrumData.dataCps = spectrumData.data.map(val => val / eMeasurementTime);
                }
                const bgMeasurementTime = bgspectrum.measurementTime;
                if (bgMeasurementTime) {
                    spectrumData.backgroundTime = bgMeasurementTime * 1000;
                    spectrumData.backgroundCps = spectrumData.background.map(val => val / bgMeasurementTime);
                }
            }
            else {
                const dataObj = espectrum ?? bgspectrum;
                const fileData = dataObj?.spectrum ?? [];
                const fileDataTime = (dataObj?.measurementTime ?? 1) * 1000;
                const fileDataType = background ? 'background' : 'data';
                spectrumData[fileDataType] = fileData;
                spectrumData[`${fileDataType}Time`] = fileDataTime;
                if (fileDataTime)
                    spectrumData[`${fileDataType}Cps`] = spectrumData[fileDataType].map(val => val / fileDataTime * 1000);
            }
            const calDataObj = (espectrum ?? bgspectrum)?.energyCalibration;
            if (calDataObj) {
                const coeffArray = calDataObj.coefficients;
                const numCoeff = calDataObj.polynomialOrder;
                resetCal();
                for (const index in coeffArray) {
                    plot.calibration.coeff[`c${numCoeff - parseInt(index) + 1}`] = coeffArray[index];
                }
                plot.calibration.imported = true;
                displayCoeffs();
                const calSettings = document.getElementsByClassName('cal-setting');
                for (const element of calSettings) {
                    element.disabled = true;
                }
                addImportLabel();
            }
        }
        else if (background) {
            spectrumData.backgroundTime = 1000;
            spectrumData.background = raw.csvToArray(result);
        }
        else {
            spectrumData.dataTime = 1000;
            spectrumData.data = raw.csvToArray(result);
        }
        updateSpectrumCounts();
        updateSpectrumTime();
        if (spectrumData.background.length !== spectrumData.data.length && spectrumData.data.length && spectrumData.background.length) {
            popupNotification('data-error');
            removeFile(background ? 'background' : 'data');
        }
        plot.resetPlot(spectrumData);
        bindPlotEvents();
    };
    reader.onerror = () => {
        popupNotification('file-error');
        return;
    };
}
function sizeCheck() {
    if (document.documentElement.clientWidth < 1100 || document.documentElement.clientHeight < 700) {
        popupNotification('screen-size-warning');
    }
    else {
        hideNotification('screen-size-warning');
    }
}
document.getElementById('clear-data').onclick = () => removeFile('data');
document.getElementById('clear-bg').onclick = () => removeFile('background');
function removeFile(id) {
    spectrumData[id] = [];
    spectrumData[`${id}Time`] = 0;
    document.getElementById(id).value = '';
    updateSpectrumCounts();
    updateSpectrumTime();
    document.getElementById(id + '-icon').classList.add('d-none');
    plot.resetPlot(spectrumData);
    bindPlotEvents();
}
function addImportLabel() {
    document.getElementById('calibration-title').classList.remove('d-none');
}
function updateSpectrumCounts() {
    const sCounts = spectrumData.getTotalCounts('data');
    const bgCounts = spectrumData.getTotalCounts('background');
    document.getElementById('total-spec-cts').innerText = sCounts.toString() + ' cts';
    document.getElementById('total-bg-cts').innerText = bgCounts.toString() + ' cts';
    if (sCounts)
        document.getElementById('data-icon').classList.remove('d-none');
    if (bgCounts)
        document.getElementById('background-icon').classList.remove('d-none');
}
function updateSpectrumTime() {
    document.getElementById('spec-time').innerText = getRecordTimeStamp(spectrumData.dataTime);
    document.getElementById('bg-time').innerText = getRecordTimeStamp(spectrumData.backgroundTime);
}
function bindPlotEvents() {
    if (!plot.plotDiv)
        return;
    const myPlot = plot.plotDiv;
    myPlot.on('plotly_hover', hoverEvent);
    myPlot.on('plotly_unhover', unHover);
    myPlot.on('plotly_click', clickEvent);
    myPlot.on('plotly_webglcontextlost', webGLcontextLoss);
}
document.getElementById('r1').onchange = event => selectFileType(event.target);
document.getElementById('r2').onchange = event => selectFileType(event.target);
function selectFileType(button) {
    raw.fileType = parseInt(button.value);
    raw.valueIndex = parseInt(button.value);
    saveJSON('fileDataMode', button.id);
}
document.getElementById('reset-plot').onclick = () => resetPlot();
function resetPlot() {
    if (plot.xAxis === 'log')
        changeAxis(document.getElementById('xAxis'));
    if (plot.yAxis === 'log')
        changeAxis(document.getElementById('yAxis'));
    if (plot.sma)
        toggleSma(false, document.getElementById('sma'));
    plot.clearAnnos();
    document.getElementById('check-all-isos').checked = false;
    loadIsotopes(true);
    plot.resetPlot(spectrumData);
    bindPlotEvents();
}
document.getElementById('xAxis').onclick = event => changeAxis(event.target);
document.getElementById('yAxis').onclick = event => changeAxis(event.target);
function changeAxis(button) {
    const id = button.id;
    if (plot[id] === 'linear') {
        plot[id] = 'log';
        button.innerText = 'Log';
        plot.resetPlot(spectrumData);
        bindPlotEvents();
    }
    else {
        plot[id] = 'linear';
        button.innerText = 'Linear';
        plot.updatePlot(spectrumData);
    }
}
function enterPress(event, id) {
    if (event.key === 'Enter')
        document.getElementById(id)?.click();
}
document.getElementById('sma').onclick = event => toggleSma(event.target.checked);
function toggleSma(value, thisValue = null) {
    plot.sma = value;
    if (thisValue)
        thisValue.checked = false;
    plot.updatePlot(spectrumData);
}
document.getElementById('smaVal').oninput = event => changeSma(event.target);
function changeSma(input) {
    const parsedInput = parseInt(input.value);
    if (isNaN(parsedInput)) {
        popupNotification('sma-error');
    }
    else {
        plot.smaLength = parsedInput;
        plot.updatePlot(spectrumData);
        saveJSON('smaLength', parsedInput);
    }
}
function hoverEvent(data) {
    for (const key in calClick) {
        const castKey = key;
        if (calClick[castKey])
            document.getElementById(`adc-${castKey}`).value = data.points[0].x.toFixed(2);
    }
    if (checkNearIso)
        closestIso(data.points[0].x);
}
function unHover() {
    for (const key in calClick) {
        const castKey = key;
        if (calClick[castKey])
            document.getElementById(`adc-${castKey}`).value = oldCalVals[castKey];
    }
}
function clickEvent(data) {
    document.getElementById('click-data').innerText = data.points[0].x.toFixed(2) + data.points[0].xaxis.ticksuffix + ': ' + data.points[0].y.toFixed(2) + data.points[0].yaxis.ticksuffix;
    for (const key in calClick) {
        const castKey = key;
        if (calClick[castKey]) {
            document.getElementById(`adc-${castKey}`).value = data.points[0].x.toFixed(2);
            oldCalVals[castKey] = data.points[0].x.toFixed(2);
            calClick[castKey] = false;
            document.getElementById(`select-${castKey}`).checked = calClick[key];
        }
    }
}
function webGLcontextLoss() {
    console.error('Lost WebGL context for Plotly.js! Falling back to default SVG render mode...');
    plot.fallbackGL = true;
    plot.resetPlot(spectrumData);
    bindPlotEvents();
}
document.getElementById('apply-cal').onclick = event => toggleCal(event.target.checked);
function toggleCal(enabled) {
    const button = document.getElementById('calibration-label');
    button.innerHTML = enabled ? '<i class="fa-solid fa-rotate-left"></i> Reset' : '<i class="fa-solid fa-check"></i> Calibrate';
    if (enabled) {
        if (!plot.calibration.imported) {
            const readoutArray = [
                [document.getElementById('adc-a').value, document.getElementById('cal-a').value],
                [document.getElementById('adc-b').value, document.getElementById('cal-b').value],
                [document.getElementById('adc-c').value, document.getElementById('cal-c').value]
            ];
            let invalid = 0;
            const validArray = [];
            for (const pair of readoutArray) {
                const float1 = parseFloat(pair[0]);
                const float2 = parseFloat(pair[1]);
                if (isNaN(float1) || isNaN(float2)) {
                    invalid += 1;
                }
                else {
                    validArray.push([float1, float2]);
                }
                if (invalid > 1) {
                    popupNotification('cal-error');
                    const checkbox = document.getElementById('apply-cal');
                    checkbox.checked = false;
                    toggleCal(checkbox.checked);
                    return;
                }
            }
            plot.calibration.points.aFrom = validArray[0][0];
            plot.calibration.points.aTo = validArray[0][1];
            plot.calibration.points.bFrom = validArray[1][0];
            plot.calibration.points.bTo = validArray[1][1];
            if (validArray.length === 3) {
                plot.calibration.points.cTo = validArray[2][1];
                plot.calibration.points.cFrom = validArray[2][0];
            }
            else {
                delete plot.calibration.points.cTo;
                delete plot.calibration.points.cFrom;
            }
            plot.computeCoefficients();
        }
    }
    displayCoeffs();
    plot.calibration.enabled = enabled;
    plot.resetPlot(spectrumData);
    bindPlotEvents();
}
function displayCoeffs() {
    for (const elem of ['c1', 'c2', 'c3']) {
        document.getElementById(`${elem}-coeff`).innerText = plot.calibration.coeff[elem].toString();
    }
}
document.getElementById('calibration-reset').onclick = () => resetCal();
function resetCal() {
    for (const point in calClick) {
        calClick[point] = false;
    }
    const calSettings = document.getElementsByClassName('cal-setting');
    for (const element of calSettings) {
        element.disabled = false;
        element.value = '';
    }
    document.getElementById('calibration-title').classList.add('d-none');
    plot.clearCalibration();
    toggleCal(false);
}
document.getElementById('select-a').onclick = event => toggleCalClick('a', event.target.checked);
document.getElementById('select-b').onclick = event => toggleCalClick('b', event.target.checked);
document.getElementById('select-c').onclick = event => toggleCalClick('c', event.target.checked);
function toggleCalClick(point, value) {
    calClick[point] = value;
}
document.getElementById('plotType').onclick = () => changeType();
function changeType() {
    const button = document.getElementById('plotType');
    if (plot.linePlot) {
        button.innerHTML = '<i class="fas fa-chart-bar"></i> Bar';
    }
    else {
        button.innerHTML = '<i class="fas fa-chart-line"></i> Line';
    }
    plot.linePlot = !plot.linePlot;
    plot.updatePlot(spectrumData);
}
document.getElementById('plot-cps').onclick = event => toggleCps(event.target);
function toggleCps(button) {
    plot.cps = !plot.cps;
    button.innerText = plot.cps ? 'CPS' : 'Total';
    plot.updatePlot(spectrumData);
}
document.getElementById('cal-input').onchange = event => importCalButton(event.target);
function importCalButton(input) {
    if (!input.files?.length)
        return;
    importCal(input.files[0]);
}
function importCal(file) {
    const reader = new FileReader();
    reader.readAsText(file);
    reader.onload = () => {
        try {
            const result = reader.result.trim();
            const obj = JSON.parse(result);
            const readoutArray = [
                document.getElementById('adc-a'),
                document.getElementById('cal-a'),
                document.getElementById('adc-b'),
                document.getElementById('cal-b'),
                document.getElementById('adc-c'),
                document.getElementById('cal-c')
            ];
            if (obj.imported) {
                const calSettings = document.getElementsByClassName('cal-setting');
                for (const element of calSettings) {
                    element.disabled = true;
                }
                addImportLabel();
                plot.calibration.coeff = obj.coeff;
                plot.calibration.imported = true;
            }
            else {
                const inputArr = ['aFrom', 'aTo', 'bFrom', 'bTo', 'cFrom', 'cTo'];
                for (const index in inputArr) {
                    if (obj.points === undefined || typeof obj.points === 'number') {
                        readoutArray[index].value = obj[inputArr[index]];
                    }
                    else {
                        readoutArray[index].value = obj.points[inputArr[index]];
                    }
                }
                oldCalVals.a = readoutArray[0].value;
                oldCalVals.b = readoutArray[2].value;
                oldCalVals.c = readoutArray[4].value;
            }
        }
        catch (e) {
            console.error('Calibration Import Error:', e);
            popupNotification('cal-import-error');
        }
    };
    reader.onerror = () => {
        popupNotification('file-error');
        return;
    };
}
document.getElementById('toggle-calibration-chart').onclick = event => toggleCalChart(event.target.checked);
function toggleCalChart(enabled) {
    const buttonLabel = document.getElementById('toggle-cal-chart-label');
    buttonLabel.innerHTML = enabled ? '<i class="fa-solid fa-eye-slash fa-beat-fade"></i> Hide Chart' : '<i class="fa-solid fa-eye"></i> Show Chart';
    plot.toggleCalibrationChart(spectrumData, enabled);
}
function addLeadingZero(number) {
    if (parseFloat(number) < 10)
        return '0' + number;
    return number;
}
function getDateString() {
    const time = new Date();
    return time.getFullYear() + addLeadingZero((time.getMonth() + 1).toString()) + addLeadingZero(time.getDate().toString()) + addLeadingZero(time.getHours().toString()) + addLeadingZero(time.getMinutes().toString());
}
function getDateStringMin() {
    const time = new Date();
    return time.getFullYear() + '-' + addLeadingZero((time.getMonth() + 1).toString()) + '-' + addLeadingZero(time.getDate().toString());
}
function toLocalIsoString(date) {
    let localIsoString = date.getFullYear() + '-'
        + addLeadingZero((date.getMonth() + 1).toString()) + '-'
        + addLeadingZero(date.getDate().toString()) + 'T'
        + addLeadingZero(date.getHours().toString()) + ':'
        + addLeadingZero(date.getMinutes().toString()) + ':'
        + addLeadingZero(date.getSeconds().toString());
    localIsoString += (-date.getTimezoneOffset() < 0) ? '-' : '+';
    const tzDate = new Date(Math.abs(date.getTimezoneOffset()));
    localIsoString += addLeadingZero(tzDate.getHours().toString()) + ':' + addLeadingZero(tzDate.getMinutes().toString());
    return localIsoString;
}
document.getElementById('calibration-download').onclick = () => downloadCal();
function downloadCal() {
    const calObj = plot.calibration;
    if (!calObj.points.cFrom)
        delete calObj.points.cFrom;
    if (!calObj.points.cTo)
        delete calObj.points.cTo;
    download(`calibration_${getDateString()}.json`, JSON.stringify(calObj));
}
function makeXMLSpectrum(type, name) {
    const root = document.createElementNS(null, (type === 'data') ? 'EnergySpectrum' : 'BackgroundEnergySpectrum');
    const noc = document.createElementNS(null, 'NumberOfChannels');
    noc.textContent = spectrumData[type].length.toString();
    root.appendChild(noc);
    const sn = document.createElementNS(null, 'SpectrumName');
    sn.textContent = name;
    root.appendChild(sn);
    if (plot.calibration.enabled) {
        const ec = document.createElementNS(null, 'EnergyCalibration');
        root.appendChild(ec);
        const c = document.createElementNS(null, 'Coefficients');
        const coeffs = [];
        const coeffObj = plot.calibration.coeff;
        for (const index in coeffObj) {
            coeffs.push(coeffObj[index]);
        }
        const coeffsRev = coeffs.reverse();
        for (const val of coeffsRev) {
            const coeff = document.createElementNS(null, 'Coefficient');
            coeff.textContent = val.toString();
            c.appendChild(coeff);
        }
        ec.appendChild(c);
        const po = document.createElementNS(null, 'PolynomialOrder');
        po.textContent = (2).toString();
        ec.appendChild(po);
    }
    const tpc = document.createElementNS(null, 'TotalPulseCount');
    tpc.textContent = spectrumData.getTotalCounts(type).toString();
    root.appendChild(tpc);
    const vpc = document.createElementNS(null, 'ValidPulseCount');
    vpc.textContent = tpc.textContent;
    root.appendChild(vpc);
    const mt = document.createElementNS(null, 'MeasurementTime');
    mt.textContent = (Math.round(spectrumData[`${type}Time`] / 1000)).toString();
    root.appendChild(mt);
    const s = document.createElementNS(null, 'Spectrum');
    root.appendChild(s);
    for (const datapoint of spectrumData[type]) {
        const d = document.createElementNS(null, 'DataPoint');
        d.textContent = datapoint.toString();
        s.appendChild(d);
    }
    return root;
}
document.getElementById('xml-export-btn').onclick = () => downloadXML();
function downloadXML() {
    const filename = `spectrum_${getDateString()}.xml`;
    const formatVersion = 230124;
    const spectrumName = getDateStringMin() + ' Energy Spectrum';
    const backgroundName = getDateStringMin() + ' Background Energy Spectrum';
    const doc = document.implementation.createDocument(null, "ResultDataFile");
    const pi = doc.createProcessingInstruction('xml', 'version="1.0" encoding="UTF-8"');
    doc.insertBefore(pi, doc.firstChild);
    const root = doc.documentElement;
    const fv = document.createElementNS(null, 'FormatVersion');
    fv.textContent = formatVersion.toString();
    root.appendChild(fv);
    const rdl = document.createElementNS(null, 'ResultDataList');
    root.appendChild(rdl);
    const rd = document.createElementNS(null, 'ResultData');
    rdl.appendChild(rd);
    const dcr = document.createElementNS(null, 'DeviceConfigReference');
    rd.appendChild(dcr);
    const dcrName = document.createElementNS(null, 'Name');
    dcrName.textContent = document.getElementById('device-name').value.trim();
    dcr.appendChild(dcrName);
    if (startDate) {
        const st = document.createElementNS(null, 'StartTime');
        st.textContent = toLocalIsoString(startDate);
        rd.appendChild(st);
        const et = document.createElementNS(null, 'EndTime');
        rd.appendChild(et);
        if (endDate && endDate.getTime() - startDate.getTime() >= 0) {
            et.textContent = toLocalIsoString(endDate);
        }
        else {
            et.textContent = toLocalIsoString(new Date());
        }
    }
    const si = document.createElementNS(null, 'SampleInfo');
    rd.appendChild(si);
    const name = document.createElementNS(null, 'Name');
    name.textContent = document.getElementById('sample-name').value.trim();
    si.appendChild(name);
    const l = document.createElementNS(null, 'Location');
    l.textContent = document.getElementById('sample-loc').value.trim();
    si.appendChild(l);
    const t = document.createElementNS(null, 'Time');
    const tval = document.getElementById('sample-time').value.trim();
    if (tval.length) {
        t.textContent = toLocalIsoString(new Date(tval));
        si.appendChild(t);
    }
    const w = document.createElementNS(null, 'Weight');
    const wval = document.getElementById('sample-weight').value.trim();
    if (wval.length) {
        w.textContent = (parseFloat(wval) / 1000).toString();
        si.appendChild(w);
    }
    const v = document.createElementNS(null, 'Volume');
    const vval = document.getElementById('sample-vol').value.trim();
    if (vval.length) {
        v.textContent = (parseFloat(vval) / 1000).toString();
        si.appendChild(v);
    }
    const note = document.createElementNS(null, 'Note');
    note.textContent = document.getElementById('add-notes').value.trim();
    si.appendChild(note);
    if (spectrumData['data'].length)
        rd.appendChild(makeXMLSpectrum('data', spectrumName));
    if (spectrumData['background'].length) {
        const bsf = document.createElementNS(null, 'BackgroundSpectrumFile');
        bsf.textContent = backgroundName;
        rd.appendChild(bsf);
        rd.appendChild(makeXMLSpectrum('background', backgroundName));
    }
    const vis = document.createElementNS(null, 'Visible');
    vis.textContent = true.toString();
    rd.appendChild(vis);
    download(filename, new XMLSerializer().serializeToString(doc));
}
function makeJSONSpectrum(type) {
    const spec = {
        'numberOfChannels': spectrumData[type].length,
        'validPulseCount': spectrumData.getTotalCounts(type),
        'measurementTime': 0,
        'spectrum': spectrumData[type]
    };
    spec.measurementTime = Math.round(spectrumData[`${type}Time`] / 1000);
    if (plot.calibration.enabled) {
        const calObj = {
            'polynomialOrder': 0,
            'coefficients': []
        };
        calObj.polynomialOrder = 2;
        calObj.coefficients = [plot.calibration.coeff.c3, plot.calibration.coeff.c2, plot.calibration.coeff.c1];
        spec.energyCalibration = calObj;
    }
    return spec;
}
document.getElementById('npes-export-btn').onclick = () => downloadNPES();
function downloadNPES() {
    const filename = `spectrum_${getDateString()}.json`;
    const data = {
        'schemaVersion': 'NPESv1',
        'deviceData': {
            'softwareName': 'Gamma MCA, ' + APP_VERSION,
            'deviceName': document.getElementById('device-name').value.trim()
        },
        'sampleInfo': {
            'name': document.getElementById('sample-name').value.trim(),
            'location': document.getElementById('sample-loc').value.trim(),
            'note': document.getElementById('add-notes').value.trim()
        },
        'resultData': {}
    };
    let val = parseFloat(document.getElementById('sample-weight').value.trim());
    if (val)
        data.sampleInfo.weight = val;
    val = parseFloat(document.getElementById('sample-vol').value.trim());
    if (val)
        data.sampleInfo.volume = val;
    const tval = document.getElementById('sample-time').value.trim();
    if (tval.length && new Date(tval))
        data.sampleInfo.time = toLocalIsoString(new Date(tval));
    if (startDate) {
        data.resultData.startTime = toLocalIsoString(startDate);
        if (endDate && endDate.getTime() - startDate.getTime() >= 0) {
            data.resultData.endTime = toLocalIsoString(endDate);
        }
        else {
            data.resultData.endTime = toLocalIsoString(new Date());
        }
    }
    if (spectrumData.data.length && spectrumData.getTotalCounts('data'))
        data.resultData.energySpectrum = makeJSONSpectrum('data');
    if (spectrumData.background.length && spectrumData.getTotalCounts('background'))
        data.resultData.backgroundEnergySpectrum = makeJSONSpectrum('background');
    if (!data.resultData.energySpectrum && !data.resultData.backgroundEnergySpectrum) {
        popupNotification('file-empty-error');
        return;
    }
    download(filename, JSON.stringify(data));
}
document.getElementById('download-spectrum-btn').onclick = () => downloadData('spectrum', 'data');
document.getElementById('download-bg-btn').onclick = () => downloadData('background', 'background');
function downloadData(filename, data) {
    filename += `_${getDateString()}.csv`;
    let text = '';
    spectrumData[data].forEach(item => text += item + '\n');
    download(filename, text);
}
function download(filename, text) {
    if (!text.trim()) {
        popupNotification('file-empty-error');
        return;
    }
    const element = document.createElement('a');
    element.setAttribute('href', `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`);
    element.setAttribute('download', filename);
    element.style.display = 'none';
    element.click();
}
document.getElementById('reset-meta-values').onclick = () => resetSampleInfo();
function resetSampleInfo() {
    const toBeReset = document.getElementsByClassName('sample-info');
    for (const element of toBeReset) {
        element.value = '';
    }
}
function popupNotification(id) {
    const toast = new window.bootstrap.Toast(document.getElementById(id));
    if (!toast.isShown())
        toast.show();
}
function hideNotification(id) {
    const toast = new window.bootstrap.Toast(document.getElementById(id));
    if (toast.isShown())
        toast.hide();
}
document.getElementById('toggle-menu').onclick = () => loadIsotopes();
document.getElementById('reload-isos-btn').onclick = () => loadIsotopes(true);
let loadedIsos = false;
async function loadIsotopes(reload = false) {
    if (loadedIsos && !reload)
        return true;
    const loadingElement = document.getElementById('iso-loading');
    loadingElement.classList.remove('d-none');
    const options = {
        cache: 'no-cache',
        headers: {
            'Content-Type': 'text/plain; application/json; charset=UTF-8',
        },
    };
    const isoError = document.getElementById('iso-load-error');
    isoError.classList.add('d-none');
    let successFlag = true;
    try {
        const response = await fetch(isoListURL, options);
        if (response.ok) {
            const json = await response.json();
            loadedIsos = true;
            const tableElement = document.getElementById('iso-table');
            tableElement.innerHTML = '';
            plot.clearAnnos();
            plot.updatePlot(spectrumData);
            const intKeys = Object.keys(json);
            intKeys.sort((a, b) => parseFloat(a) - parseFloat(b));
            let index = 0;
            for (const key of intKeys) {
                index++;
                isoList[parseFloat(key)] = json[key];
                const row = tableElement.insertRow();
                const cell1 = row.insertCell(0);
                const cell2 = row.insertCell(1);
                const cell3 = row.insertCell(2);
                cell1.onclick = () => cell1.firstChild.click();
                cell2.onclick = () => cell1.firstChild.click();
                cell3.onclick = () => cell1.firstChild.click();
                cell1.style.cursor = 'pointer';
                cell2.style.cursor = 'pointer';
                cell3.style.cursor = 'pointer';
                const energy = parseFloat(key.trim());
                const lowercaseName = json[key].toLowerCase().replace(/[^a-z0-9 -]/gi, '').trim();
                const name = lowercaseName.charAt(0).toUpperCase() + lowercaseName.slice(1) + '-' + index;
                cell1.innerHTML = `<input class="form-check-input iso-table-label" id="${name}" type="checkbox" value="${energy}">`;
                cell3.innerText = energy.toFixed(2);
                const clickBox = document.getElementById(name);
                clickBox.onclick = () => plotIsotope(clickBox);
                const strArr = name.split('-');
                cell2.innerHTML = `<sup>${strArr[1]}</sup>${strArr[0]}`;
            }
            plot.isoList = isoList;
        }
        else {
            isoError.innerText = `Could not load isotope list! HTTP Error: ${response.status}. Please try again.`;
            isoError.classList.remove('d-none');
            successFlag = false;
        }
    }
    catch (err) {
        isoError.innerText = 'Could not load isotope list! Connection refused - you are probably offline.';
        isoError.classList.remove('d-none');
        successFlag = false;
    }
    loadingElement.classList.add('d-none');
    return successFlag;
}
document.getElementById('iso-hover').onclick = () => toggleIsoHover();
let prevIso = {};
function toggleIsoHover() {
    checkNearIso = !checkNearIso;
    closestIso(-100000);
}
async function closestIso(value) {
    if (!await loadIsotopes())
        return;
    const { energy, name } = new SeekClosest(isoList).seek(value, maxDist);
    const energyVal = parseFloat(Object.keys(prevIso)[0]);
    if (!isNaN(energyVal))
        plot.toggleLine(energyVal, Object.keys(prevIso)[0], false);
    if (energy && name) {
        const newIso = {};
        newIso[energy] = name;
        if (prevIso !== newIso)
            prevIso = newIso;
        plot.toggleLine(energy, name);
    }
    plot.updatePlot(spectrumData);
}
function plotIsotope(checkbox) {
    const wordArray = checkbox.id.split('-');
    plot.toggleLine(parseFloat(checkbox.value), wordArray[0] + '-' + wordArray[1], checkbox.checked);
    plot.updatePlot(spectrumData);
}
document.getElementById('check-all-isos').onclick = (event) => selectAll(event.target);
function selectAll(selectBox) {
    const tableRows = document.getElementById('table').tBodies[0].rows;
    for (const row of tableRows) {
        const checkBox = row.cells[0].firstChild;
        checkBox.checked = selectBox.checked;
        if (selectBox.checked) {
            const wordArray = checkBox.id.split('-');
            plot.toggleLine(parseFloat(checkBox.value), wordArray[0] + '-' + wordArray[1], checkBox.checked);
        }
    }
    if (!selectBox.checked)
        plot.clearAnnos();
    plot.updatePlot(spectrumData);
}
document.getElementById('peak-finder-btn').onclick = event => findPeaks(event.target);
async function findPeaks(button) {
    if (plot.peakConfig.enabled) {
        switch (plot.peakConfig.mode) {
            case 'gaussian':
                plot.peakConfig.mode = 'energy';
                button.innerText = 'Energy';
                break;
            case 'energy':
                await loadIsotopes();
                plot.peakConfig.mode = 'isotopes';
                button.innerText = 'Isotopes';
                break;
            case 'isotopes':
                plot.peakFinder(false);
                plot.peakConfig.enabled = false;
                button.innerText = 'None';
                break;
        }
    }
    else {
        plot.peakConfig.enabled = true;
        plot.peakConfig.mode = 'gaussian';
        button.innerText = 'Gaussian';
    }
    plot.updatePlot(spectrumData);
}
function saveJSON(name, value) {
    if (localStorageAvailable) {
        localStorage.setItem(name, JSON.stringify(value));
        return true;
    }
    return false;
}
function loadJSON(name) {
    return JSON.parse(localStorage.getItem(name));
}
function loadSettingsDefault() {
    document.getElementById('custom-url').value = isoListURL;
    document.getElementById('edit-plot').checked = plot.editableMode;
    document.getElementById('custom-delimiter').value = raw.delimiter;
    document.getElementById('custom-file-adc').value = raw.adcChannels.toString();
    document.getElementById('custom-ser-refresh').value = (refreshRate / 1000).toString();
    document.getElementById('custom-ser-buffer').value = SerialManager.maxSize.toString();
    document.getElementById('custom-ser-adc').value = SerialManager.adcChannels.toString();
    document.getElementById('ser-limit').value = (maxRecTime / 1000).toString();
    document.getElementById('toggle-time-limit').checked = maxRecTimeEnabled;
    document.getElementById('iso-hover-prox').value = maxDist.toString();
    document.getElementById('custom-baud').value = SerialManager.serOptions.baudRate.toString();
    document.getElementById('eol-char').value = SerialManager.eolChar;
    document.getElementById('smaVal').value = plot.smaLength.toString();
    document.getElementById('peak-thres').value = plot.peakConfig.thres.toString();
    document.getElementById('peak-lag').value = plot.peakConfig.lag.toString();
    document.getElementById('peak-width').value = plot.peakConfig.width.toString();
    document.getElementById('seek-width').value = plot.peakConfig.seekWidth.toString();
    const formatSelector = document.getElementById('download-format');
    const len = formatSelector.options.length;
    const format = plot.downloadFormat;
    for (let i = 0; i < len; i++) {
        if (formatSelector.options[i].value === format)
            formatSelector.selectedIndex = i;
    }
}
function loadSettingsStorage() {
    let setting = loadJSON('customURL');
    if (setting) {
        const newUrl = new URL(setting);
        isoListURL = newUrl.href;
    }
    setting = loadJSON('editMode');
    if (setting)
        plot.editableMode = setting;
    setting = loadJSON('fileDelimiter');
    if (setting)
        raw.delimiter = setting;
    setting = loadJSON('fileChannels');
    if (setting)
        raw.adcChannels = setting;
    setting = loadJSON('plotRefreshRate');
    if (setting)
        refreshRate = setting;
    setting = loadJSON('serBufferSize');
    if (setting)
        SerialManager.maxSize = setting;
    setting = loadJSON('serADC');
    if (setting)
        SerialManager.adcChannels = setting;
    setting = loadJSON('timeLimitBool');
    if (setting)
        maxRecTimeEnabled = setting;
    setting = loadJSON('timeLimit');
    if (setting)
        maxRecTime = setting;
    setting = loadJSON('maxIsoDist');
    if (setting)
        maxDist = setting;
    setting = loadJSON('baudRate');
    if (setting)
        SerialManager.serOptions.baudRate = setting;
    setting = loadJSON('eolChar');
    if (setting)
        SerialManager.eolChar = setting;
    setting = loadJSON('smaLength');
    if (setting)
        plot.smaLength = setting;
    setting = loadJSON('peakThres');
    if (setting)
        plot.peakConfig.thres = setting;
    setting = loadJSON('peakLag');
    if (setting)
        plot.peakConfig.lag = setting;
    setting = loadJSON('peakWidth');
    if (setting)
        plot.peakConfig.width = setting;
    setting = loadJSON('seekWidth');
    if (setting)
        plot.peakConfig.seekWidth = setting;
    setting = loadJSON('plotDownload');
    if (setting)
        plot.downloadFormat = setting;
}
document.getElementById('edit-plot').onclick = event => changeSettings('editMode', event.target);
document.getElementById('setting1').onclick = () => changeSettings('maxIsoDist', document.getElementById('iso-hover-prox'));
document.getElementById('setting2').onclick = () => changeSettings('customURL', document.getElementById('custom-url'));
document.getElementById('download-format').onchange = event => changeSettings('plotDownload', event.target);
document.getElementById('setting3').onclick = () => changeSettings('fileDelimiter', document.getElementById('custom-delimiter'));
document.getElementById('setting4').onclick = () => changeSettings('fileChannels', document.getElementById('custom-file-adc'));
document.getElementById('setting5').onclick = () => changeSettings('baudRate', document.getElementById('custom-baud'));
document.getElementById('setting5-1').onclick = () => changeSettings('eolChar', document.getElementById('eol-char'));
document.getElementById('toggle-time-limit').onclick = event => changeSettings('timeLimitBool', event.target);
document.getElementById('ser-limit-btn').onclick = () => changeSettings('timeLimit', document.getElementById('ser-limit'));
document.getElementById('setting6').onclick = () => changeSettings('plotRefreshRate', document.getElementById('custom-ser-refresh'));
document.getElementById('setting7').onclick = () => changeSettings('serBufferSize', document.getElementById('custom-ser-buffer'));
document.getElementById('setting8').onclick = () => changeSettings('serChannels', document.getElementById('custom-ser-adc'));
document.getElementById('setting9').onclick = () => changeSettings('peakThres', document.getElementById('peak-thres'));
document.getElementById('setting10').onclick = () => changeSettings('peakLag', document.getElementById('peak-lag'));
document.getElementById('setting11').onclick = () => changeSettings('peakWidth', document.getElementById('peak-width'));
document.getElementById('setting12').onclick = () => changeSettings('seekWidth', document.getElementById('seek-width'));
function changeSettings(name, element) {
    if (!element.checkValidity()) {
        popupNotification('setting-type');
        return;
    }
    const value = element.value;
    let boolVal;
    let numVal;
    switch (name) {
        case 'editMode':
            boolVal = element.checked;
            plot.editableMode = boolVal;
            plot.resetPlot(spectrumData);
            bindPlotEvents();
            saveJSON(name, boolVal);
            break;
        case 'customURL':
            try {
                isoListURL = new URL(value).href;
                loadIsotopes(true);
                saveJSON(name, isoListURL);
            }
            catch (e) {
                popupNotification('setting-error');
                console.error('Custom URL Error', e);
            }
            break;
        case 'fileDelimiter':
            raw.delimiter = value;
            saveJSON(name, value);
            break;
        case 'fileChannels':
            numVal = parseInt(value);
            raw.adcChannels = numVal;
            saveJSON(name, numVal);
            break;
        case 'timeLimitBool':
            boolVal = element.checked;
            maxRecTimeEnabled = boolVal;
            saveJSON(name, boolVal);
            break;
        case 'timeLimit':
            numVal = parseFloat(value);
            maxRecTime = numVal * 1000;
            saveJSON(name, maxRecTime);
            break;
        case 'maxIsoDist':
            numVal = parseFloat(value);
            maxDist = numVal;
            saveJSON(name, maxDist);
            break;
        case 'plotRefreshRate':
            numVal = parseFloat(value);
            refreshRate = numVal * 1000;
            saveJSON(name, refreshRate);
            break;
        case 'serBufferSize':
            numVal = parseInt(value);
            SerialManager.maxSize = numVal;
            saveJSON(name, SerialManager.maxSize);
            break;
        case 'baudRate':
            numVal = parseInt(value);
            SerialManager.serOptions.baudRate = numVal;
            saveJSON(name, SerialManager.serOptions.baudRate);
            break;
        case 'eolChar':
            SerialManager.eolChar = value;
            saveJSON(name, value);
            break;
        case 'serChannels':
            numVal = parseInt(value);
            SerialManager.adcChannels = numVal;
            saveJSON(name, numVal);
            break;
        case 'peakThres':
            numVal = parseFloat(value);
            plot.peakConfig.thres = numVal;
            plot.updatePlot(spectrumData);
            saveJSON(name, numVal);
            break;
        case 'peakLag':
            numVal = parseInt(value);
            plot.peakConfig.lag = numVal;
            plot.updatePlot(spectrumData);
            saveJSON(name, numVal);
            break;
        case 'peakWidth':
            numVal = parseInt(value);
            plot.peakConfig.width = numVal;
            plot.updatePlot(spectrumData);
            saveJSON(name, numVal);
            break;
        case 'seekWidth':
            numVal = parseFloat(value);
            plot.peakConfig.seekWidth = numVal;
            plot.updatePlot(spectrumData);
            saveJSON(name, numVal);
            break;
        case 'plotDownload':
            plot.downloadFormat = value;
            plot.updatePlot(spectrumData);
            saveJSON(name, value);
            break;
        default:
            popupNotification('setting-error');
            return;
    }
    popupNotification('setting-success');
}
document.getElementById('reset-gamma-mca').onclick = () => resetMCA();
function resetMCA() {
    if (localStorageAvailable)
        localStorage.clear();
    window.location.reload();
}
let serRecorder;
document.getElementById('s1').onchange = event => selectSerialType(event.target);
document.getElementById('s2').onchange = event => selectSerialType(event.target);
function selectSerialType(button) {
    SerialManager.orderType = button.value;
    saveJSON('serialDataMode', button.id);
}
function serialConnect() {
    listSerial();
    popupNotification('serial-connect');
}
function serialDisconnect(event) {
    for (const key in portsAvail) {
        if (portsAvail[key] == event.target) {
            delete portsAvail[key];
            break;
        }
    }
    if (event.target === serRecorder?.port)
        disconnectPort(true);
    listSerial();
    popupNotification('serial-disconnect');
}
document.getElementById('serial-list-btn').onclick = () => listSerial();
async function listSerial() {
    const portSelector = document.getElementById('port-selector');
    const options = portSelector.options;
    for (const index in options) {
        portSelector.remove(parseInt(index));
    }
    const ports = await navigator.serial.getPorts();
    for (const index in ports) {
        portsAvail[index] = ports[index];
        const option = document.createElement('option');
        option.text = `Port ${index} (Id: 0x${ports[index].getInfo().usbProductId?.toString(16)})`;
        portSelector.add(option, parseInt(index));
    }
    const serSettingsElements = document.getElementsByClassName('ser-settings');
    if (!ports.length) {
        const option = document.createElement('option');
        option.text = 'No Ports Available';
        portSelector.add(option);
        for (const element of serSettingsElements) {
            element.disabled = true;
        }
    }
    else {
        for (const element of serSettingsElements) {
            element.disabled = false;
        }
    }
}
document.getElementById('serial-add-device').onclick = () => requestSerial();
async function requestSerial() {
    try {
        const port = await navigator.serial.requestPort();
        if (Object.keys(portsAvail).length === 0) {
            portsAvail[0] = port;
        }
        else {
            const intKeys = Object.keys(portsAvail).map(value => parseInt(value));
            portsAvail[Math.max(...intKeys) + 1] = port;
        }
        listSerial();
    }
    catch (err) {
        console.warn('Aborted adding a new port!', err);
    }
}
function selectPort() {
    const selectedPort = document.getElementById('port-selector').selectedIndex;
    const newport = portsAvail[selectedPort];
    if (newport && serRecorder?.port !== newport) {
        serRecorder = new SerialManager(newport);
        clearConsoleLog();
    }
    return selectedPort;
}
document.getElementById('resume-button').onclick = () => startRecord(true, recordingType);
document.getElementById('record-spectrum-btn').onclick = () => startRecord(false, 'data');
document.getElementById('record-bg-btn').onclick = () => startRecord(false, 'background');
let recordingType;
let startDate;
let endDate;
async function startRecord(pause = false, type) {
    try {
        selectPort();
        await serRecorder?.startRecord(pause);
    }
    catch (err) {
        console.error('Connection Error:', err);
        popupNotification('serial-connect-error');
        return;
    }
    recordingType = type;
    if (!pause) {
        removeFile(type);
        startDate = new Date();
    }
    document.getElementById('stop-button').disabled = false;
    document.getElementById('pause-button').classList.remove('d-none');
    document.getElementById('record-button').classList.add('d-none');
    document.getElementById('resume-button').classList.add('d-none');
    const spinnerElements = document.getElementsByClassName('recording-spinner');
    for (const ele of spinnerElements) {
        ele.classList.remove('d-none');
    }
    refreshRender(type, !pause);
    refreshMeta(type);
    pause ? cpsValues.pop() : cpsValues = [];
}
document.getElementById('pause-button').onclick = () => disconnectPort();
document.getElementById('stop-button').onclick = () => disconnectPort(true);
async function disconnectPort(stop = false) {
    document.getElementById('pause-button').classList.add('d-none');
    const spinnerElements = document.getElementsByClassName('recording-spinner');
    for (const ele of spinnerElements) {
        ele.classList.add('d-none');
    }
    document.getElementById('resume-button').classList.toggle('d-none', stop);
    if (stop) {
        document.getElementById('stop-button').disabled = true;
        document.getElementById('record-button').classList.remove('d-none');
        endDate = new Date();
    }
    try {
        clearTimeout(refreshTimeout);
        clearTimeout(metaTimeout);
        clearTimeout(consoleTimeout);
    }
    catch (err) {
        console.warn('No timeout to clear. Something might be wrong...', err);
    }
    try {
        await serRecorder?.stopRecord();
    }
    catch (error) {
        console.error('Misc Serial Read Error:', error);
        popupNotification('misc-ser-error');
    }
}
document.getElementById('clear-console-log').onclick = () => clearConsoleLog();
function clearConsoleLog() {
    document.getElementById('ser-output').innerText = '';
    serRecorder?.flushRawData();
}
document.getElementById('serialConsoleModal').addEventListener('show.bs.modal', () => {
    readSerial();
});
document.getElementById('serialConsoleModal').addEventListener('hide.bs.modal', async () => {
    await serRecorder?.hideConsole();
    clearTimeout(consoleTimeout);
});
async function readSerial() {
    try {
        const portNumber = selectPort();
        await serRecorder?.showConsole();
        document.getElementById('serial-console-title').innerText = 'Serial Console (Port ' + portNumber + ')';
    }
    catch (err) {
        console.error('Connection Error:', err);
        popupNotification('serial-connect-error');
        return;
    }
    refreshConsole();
}
document.getElementById('send-command').onclick = () => sendSerial();
async function sendSerial() {
    const element = document.getElementById('ser-command');
    try {
        await serRecorder?.sendString(element.value);
    }
    catch (err) {
        console.error('Connection Error:', err);
        popupNotification('serial-connect-error');
        return;
    }
    element.value = '';
}
document.getElementById('reconnect-console-log').onclick = () => reconnectConsole();
async function reconnectConsole() {
    await serRecorder?.hideConsole();
    clearTimeout(consoleTimeout);
    readSerial();
}
let autoscrollEnabled = false;
document.getElementById('autoscroll-console').onclick = event => toggleAutoscroll(event.target.checked);
function toggleAutoscroll(enabled) {
    autoscrollEnabled = enabled;
    saveJSON('consoleAutoscrollEnabled', autoscrollEnabled);
}
let consoleTimeout;
function refreshConsole() {
    if (serRecorder?.port?.readable) {
        document.getElementById('ser-output').innerText = serRecorder.getRawData();
        consoleTimeout = setTimeout(refreshConsole, CONSOLE_REFRESH);
        if (autoscrollEnabled)
            document.getElementById('ser-output').scrollIntoView({ behavior: "smooth", block: "end" });
    }
}
function getRecordTimeStamp(time) {
    const dateTime = new Date(time);
    return addLeadingZero(dateTime.getUTCHours().toString()) + ':' + addLeadingZero(dateTime.getUTCMinutes().toString()) + ':' + addLeadingZero(dateTime.getUTCSeconds().toString());
}
let metaTimeout;
function refreshMeta(type) {
    if (serRecorder?.port?.readable) {
        const nowTime = performance.now();
        const totalTimeElement = document.getElementById('total-record-time');
        const totalMeasTime = serRecorder.getTime();
        spectrumData[`${type}Time`] = totalMeasTime;
        document.getElementById('record-time').innerText = getRecordTimeStamp(totalMeasTime);
        const delta = new Date(totalMeasTime);
        if (maxRecTimeEnabled) {
            const progressElement = document.getElementById('ser-time-progress');
            const progress = Math.round(delta.getTime() / maxRecTime * 100);
            progressElement.style.width = progress + '%';
            progressElement.innerText = progress + '%';
            progressElement.setAttribute('aria-valuenow', progress.toString());
            totalTimeElement.innerText = ' / ' + getRecordTimeStamp(maxRecTime);
        }
        else {
            totalTimeElement.innerText = '';
        }
        document.getElementById('ser-time-progress-bar').classList.toggle('d-none', !maxRecTimeEnabled);
        updateSpectrumTime();
        if (delta.getTime() >= maxRecTime && maxRecTimeEnabled) {
            disconnectPort(true);
            popupNotification('auto-stop');
        }
        else {
            const finishDelta = performance.now() - nowTime;
            metaTimeout = setTimeout(refreshMeta, (REFRESH_META_TIME - finishDelta > 0) ? (REFRESH_META_TIME - finishDelta) : 1, type);
        }
    }
}
let lastUpdate = performance.now();
let refreshTimeout;
function refreshRender(type, firstLoad = false) {
    if (serRecorder?.port?.readable) {
        const startDelay = performance.now();
        const newData = serRecorder.getData();
        const measTime = serRecorder.getTime() ?? 1000;
        if (SerialManager.orderType === 'hist') {
            spectrumData.addHist(type, newData);
        }
        else if (SerialManager.orderType === 'chron') {
            spectrumData.addPulseData(type, newData, SerialManager.adcChannels);
        }
        spectrumData[`${type}Cps`] = spectrumData[type].map(val => val / measTime * 1000);
        if (firstLoad) {
            plot.resetPlot(spectrumData);
            bindPlotEvents();
        }
        else {
            plot.updatePlot(spectrumData);
        }
        const deltaLastRefresh = measTime - lastUpdate;
        lastUpdate = measTime;
        const cpsValue = ((SerialManager.orderType === 'chron') ? newData.length : newData.reduce((acc, curr) => acc + curr, 0)) / deltaLastRefresh * 1000;
        cpsValues.push(cpsValue);
        document.getElementById('cps').innerText = cpsValue.toFixed(1) + ' cps';
        const mean = cpsValues.reduce((acc, curr) => acc + curr, 0) / cpsValues.length;
        const std = Math.sqrt(cpsValues.reduce((acc, curr) => acc + (curr - mean) ** 2, 0) / (cpsValues.length - 1));
        document.getElementById('avg-cps').innerHTML = 'Avg: ' + mean.toFixed(1);
        document.getElementById('avg-cps-std').innerHTML = ` &plusmn; ${std.toFixed(1)} cps (&#916; ${Math.round(std / mean * 100)}%)`;
        updateSpectrumCounts();
        const finishDelta = performance.now() - startDelay;
        refreshTimeout = setTimeout(refreshRender, (refreshRate - finishDelta > 0) ? (refreshRate - finishDelta) : 1, type);
    }
}
//# sourceMappingURL=main.js.map