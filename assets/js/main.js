import './external/bootstrap.min.js';
import { SpectrumPlot } from './plot.js';
import { RawData } from './raw-data.js';
import { SerialData } from './serial.js';
;
;
export class SpectrumData {
    data = [];
    background = [];
    dataCps = [];
    backgroundCps = [];
    getTotalCounts = (data) => {
        let sum = 0;
        data.forEach(item => {
            sum += item;
        });
        return sum;
    };
}
;
let spectrumData = new SpectrumData();
let plot = new SpectrumPlot('plot');
let raw = new RawData(1);
let ser = new SerialData();
let calClick = { a: false, b: false, c: false };
let oldCalVals = { a: '', b: '', c: '' };
let portsAvail = {};
let serOptions = { baudRate: 9600 };
let refreshRate = 1000;
let maxRecTimeEnabled = false;
let maxRecTime = 1800000;
const REFRESH_META_TIME = 100;
const CONSOLE_REFRESH = 500;
let cpsValues = [];
let isoListURL = 'assets/isotopes_energies_min.json';
let isoList = {};
let checkNearIso = false;
let maxDist = 100;
const APP_VERSION = '2023-01-14';
let localStorageAvailable = false;
let firstInstall = false;
document.body.onload = async function () {
    localStorageAvailable = 'localStorage' in self;
    if (localStorageAvailable) {
        loadSettingsStorage();
    }
    if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.register('/service-worker.js');
        if (localStorageAvailable) {
            reg.addEventListener('updatefound', () => {
                if (firstInstall) {
                    return;
                }
                popupNotification('update-installed');
            });
        }
    }
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    if ('standalone' in window.navigator || isStandalone) {
        document.title += ' PWA';
        document.getElementById('main').classList.remove('p-1');
    }
    else {
        document.getElementById('main').classList.remove('pb-1');
        document.title += ' web application';
    }
    const domain = new URL(isoListURL, window.location.origin);
    isoListURL = domain.href;
    if ('serial' in navigator) {
        document.getElementById('serial-div').className = '';
        navigator.serial.addEventListener('connect', serialConnect);
        navigator.serial.addEventListener('disconnect', serialDisconnect);
        listSerial();
    }
    else {
        document.getElementById('serial-error').classList.remove('d-none');
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
            if (!launchParams.files.length) {
                return;
            }
            const fileHandle = launchParams.files[0];
            const file = await fileHandle.getFile();
            const fileEnding = file.name.split('.')[1].toLowerCase();
            const spectrumEndings = ['csv', 'tka', 'xml', 'txt'];
            if (spectrumEndings.includes(fileEnding)) {
                getFileData(file);
            }
            else if (fileEnding === 'json') {
                importCal(file);
            }
            console.warn('File could not be imported!');
        });
    }
    plot.resetPlot(spectrumData);
    bindPlotEvents();
    document.getElementById('version-tag').innerText += ` ${APP_VERSION}.`;
    if (localStorageAvailable) {
        if (loadJSON('lastVisit') <= 0) {
            popupNotification('welcomeMsg');
            firstInstall = true;
        }
        saveJSON('lastVisit', Date.now());
        saveJSON('lastUsedVersion', APP_VERSION);
        const settingsNotSaveAlert = document.getElementById('ls-unavailable');
        settingsNotSaveAlert.parentNode.removeChild(settingsNotSaveAlert);
    }
    else {
        const settingsSaveAlert = document.getElementById('ls-available');
        settingsSaveAlert.parentNode.removeChild(settingsSaveAlert);
        popupNotification('welcomeMsg');
    }
    loadSettingsDefault();
    sizeCheck();
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
window.addEventListener('shown.bs.tab', (event) => {
    if (event.target.getAttribute('data-bs-toggle') === 'pill') {
        plot.updatePlot(spectrumData);
        plot.updatePlot(spectrumData);
    }
});
document.getElementById('data').onclick = event => { event.target.value = ''; };
document.getElementById('background').onclick = event => { event.target.value = ''; };
document.getElementById('data').onchange = event => importFile(event.target);
document.getElementById('background').onchange = event => importFile(event.target, true);
function importFile(input, background = false) {
    if (input.files === null || input.files.length === 0) {
        return;
    }
    getFileData(input.files[0], background);
}
function getFileData(file, background = false) {
    let reader = new FileReader();
    const fileEnding = file.name.split('.')[1];
    reader.readAsText(file);
    reader.onload = () => {
        const result = reader.result.trim();
        if (fileEnding.toLowerCase() === 'xml') {
            if (window.DOMParser) {
                const { espectrum, bgspectrum, coeff } = raw.xmlToArray(result);
                if (espectrum === undefined && bgspectrum === undefined) {
                    popupNotification('file-error');
                }
                if (espectrum !== undefined) {
                    spectrumData.data = espectrum;
                }
                if (bgspectrum !== undefined) {
                    spectrumData.background = bgspectrum;
                }
                const importedCount = Object.values(coeff).filter(value => value !== 0).length;
                if (importedCount >= 2) {
                    plot.calibration.coeff = coeff;
                    plot.calibration.imported = true;
                    displayCoeffs();
                    for (const element of document.getElementsByClassName('cal-setting')) {
                        const changeType = element;
                        changeType.disabled = true;
                    }
                    addImportLabel();
                }
            }
            else {
                console.error('No DOM parser in this browser!');
            }
        }
        else if (background) {
            spectrumData.background = raw.csvToArray(result);
        }
        else {
            spectrumData.data = raw.csvToArray(result);
        }
        const sCounts = spectrumData.getTotalCounts(spectrumData.data);
        const bgCounts = spectrumData.getTotalCounts(spectrumData.background);
        document.getElementById('total-spec-cts').innerText = sCounts.toString();
        document.getElementById('total-bg-cts').innerText = bgCounts.toString();
        if (sCounts > 0) {
            document.getElementById('data-icon').classList.remove('d-none');
        }
        if (bgCounts > 0) {
            document.getElementById('background-icon').classList.remove('d-none');
        }
        if (!(spectrumData.background.length === spectrumData.data.length || spectrumData.data.length === 0 || spectrumData.background.length === 0)) {
            popupNotification('data-error');
            if (background) {
                removeFile('background');
            }
            else {
                removeFile('data');
            }
        }
        plot.plotData(spectrumData, false);
        bindPlotEvents();
    };
    reader.onerror = () => {
        popupNotification('file-error');
        return;
    };
}
function sizeCheck() {
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    if (viewportWidth < 1100 || viewportHeight < 700) {
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
    document.getElementById(id).value = '';
    plot.resetPlot(spectrumData);
    document.getElementById('total-spec-cts').innerText = spectrumData.getTotalCounts(spectrumData.data).toString();
    document.getElementById('total-bg-cts').innerText = spectrumData.getTotalCounts(spectrumData.background).toString();
    document.getElementById(id + '-icon').classList.add('d-none');
    bindPlotEvents();
}
function addImportLabel() {
    document.getElementById('calibration-title').classList.remove('d-none');
}
function bindPlotEvents() {
    const myPlot = document.getElementById(plot.divId);
    myPlot.on('plotly_hover', hoverEvent);
    myPlot.on('plotly_unhover', unHover);
    myPlot.on('plotly_click', clickEvent);
}
document.getElementById('r1').onchange = event => selectFileType(event.target);
document.getElementById('r2').onchange = event => selectFileType(event.target);
function selectFileType(button) {
    raw.fileType = parseInt(button.value);
    raw.valueIndex = parseInt(button.value);
}
document.getElementById('reset-plot').onclick = () => resetPlot();
function resetPlot() {
    if (plot.xAxis === 'log') {
        changeAxis(document.getElementById('xAxis'));
    }
    if (plot.yAxis === 'log') {
        changeAxis(document.getElementById('yAxis'));
    }
    if (plot.sma) {
        toggleSma(false, document.getElementById('sma'));
    }
    plot.clearAnnos();
    document.getElementById('check-all-isos').checked = false;
    loadIsotopes(true);
    plot.resetPlot(spectrumData);
    bindPlotEvents();
}
document.getElementById('xAxis').onclick = event => changeAxis(event.target);
document.getElementById('yAxis').onclick = event => changeAxis(event.target);
function changeAxis(button) {
    let id = button.id;
    if (plot[id] === 'linear') {
        plot[id] = 'log';
        button.innerText = 'Log';
    }
    else {
        plot[id] = 'linear';
        button.innerText = 'Linear';
    }
    plot.updatePlot(spectrumData);
}
document.getElementById('smaVal').onkeydown = event => enterPress(event, 'sma');
document.getElementById('ser-command').onkeydown = event => enterPress(event, 'send-command');
document.getElementById('iso-hover-prox').onkeydown = event => enterPress(event, 'setting1');
document.getElementById('custom-url').onkeydown = event => enterPress(event, 'setting2');
document.getElementById('custom-delimiter').onkeydown = event => enterPress(event, 'setting3');
document.getElementById('custom-file-adc').onkeydown = event => enterPress(event, 'setting4');
document.getElementById('custom-baud').onkeydown = event => enterPress(event, 'setting5');
document.getElementById('eol-char').onkeydown = event => enterPress(event, 'setting5-1');
document.getElementById('ser-limit').onkeydown = event => enterPress(event, 'ser-limit-btn');
document.getElementById('custom-ser-refresh').onkeydown = event => enterPress(event, 'setting6');
document.getElementById('custom-ser-buffer').onkeydown = event => enterPress(event, 'setting7');
document.getElementById('custom-ser-adc').onkeydown = event => enterPress(event, 'setting8');
document.getElementById('peak-thres').onkeydown = event => enterPress(event, 'setting9');
document.getElementById('peak-lag').onkeydown = event => enterPress(event, 'setting10');
document.getElementById('peak-width').onkeydown = event => enterPress(event, 'setting11');
document.getElementById('seek-width').onkeydown = event => enterPress(event, 'setting12');
function enterPress(event, id) {
    if (event.key === 'Enter') {
        const button = document.getElementById(id);
        button?.click();
    }
}
document.getElementById('sma').onclick = event => toggleSma(event.target.checked);
function toggleSma(value, thisValue = null) {
    plot.sma = value;
    if (thisValue !== null) {
        thisValue.checked = false;
    }
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
    const hoverData = document.getElementById('hover-data');
    hoverData.innerText = data.points[0].x.toFixed(2) + data.points[0].xaxis.ticksuffix + ': ' + data.points[0].y.toFixed(2) + data.points[0].yaxis.ticksuffix;
    for (const key in calClick) {
        const castKey = key;
        if (calClick[castKey]) {
            document.getElementById(`adc-${castKey}`).value = data.points[0].x.toFixed(2);
        }
    }
    if (checkNearIso) {
        closestIso(data.points[0].x);
    }
}
function unHover() {
    const hoverData = document.getElementById('hover-data');
    hoverData.innerText = 'None';
    for (const key in calClick) {
        const castKey = key;
        if (calClick[castKey]) {
            document.getElementById(`adc-${castKey}`).value = oldCalVals[castKey];
        }
    }
}
function clickEvent(data) {
    const clickData = document.getElementById('click-data');
    clickData.innerText = data.points[0].x.toFixed(2) + data.points[0].xaxis.ticksuffix + ': ' + data.points[0].y.toFixed(2) + data.points[0].yaxis.ticksuffix;
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
document.getElementById('apply-cal').onclick = event => toggleCal(event.target.checked);
function toggleCal(enabled) {
    const button = document.getElementById('calibration-label');
    if (enabled) {
        button.innerHTML = '<i class="fa-solid fa-rotate-left"></i> Reset';
    }
    else {
        button.innerHTML = '<i class="fa-solid fa-check"></i> Calibrate';
    }
    if (enabled) {
        if (!plot.calibration.imported) {
            let readoutArray = [
                [document.getElementById('adc-a').value, document.getElementById('cal-a').value],
                [document.getElementById('adc-b').value, document.getElementById('cal-b').value],
                [document.getElementById('adc-c').value, document.getElementById('cal-c').value]
            ];
            let invalid = 0;
            let validArray = [];
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
            if (validArray.length === 2) {
                validArray.push([-1, -1]);
            }
            plot.calibration.points.aFrom = validArray[0][0];
            plot.calibration.points.bFrom = validArray[1][0];
            plot.calibration.points.cFrom = validArray[2][0];
            plot.calibration.points.aTo = validArray[0][1];
            plot.calibration.points.bTo = validArray[1][1];
            plot.calibration.points.cTo = validArray[2][1];
            plot.computeCoefficients();
        }
    }
    displayCoeffs();
    plot.calibration.enabled = enabled;
    plot.plotData(spectrumData, false);
    bindPlotEvents();
}
function displayCoeffs() {
    document.getElementById('c1-coeff').innerText = plot.calibration.coeff.c1.toString();
    document.getElementById('c2-coeff').innerText = plot.calibration.coeff.c2.toString();
    document.getElementById('c3-coeff').innerText = plot.calibration.coeff.c3.toString();
}
document.getElementById('calibration-reset').onclick = () => resetCal();
function resetCal() {
    for (const point in calClick) {
        calClick[point] = false;
    }
    for (const element of document.getElementsByClassName('cal-setting')) {
        const changeType = element;
        changeType.disabled = false;
    }
    const titleElement = document.getElementById('calibration-title');
    titleElement.classList.add('d-none');
    plot.clearCalibration();
    toggleCal(false);
}
document.getElementById('select-a').onclick = event => toggleCalClick('a', event.target.checked);
document.getElementById('select-b').onclick = event => toggleCalClick('b', event.target.checked);
document.getElementById('select-c').onclick = event => toggleCalClick('c', event.target.checked);
function toggleCalClick(point, value) {
    calClick[point] = value;
}
document.getElementById('plotType').onclick = () => changeType(document.getElementById('plotType'));
function changeType(button) {
    if (plot.plotType === 'scatter') {
        button.innerHTML = '<i class="fas fa-chart-bar"></i> Bar';
        plot.plotType = 'bar';
    }
    else {
        button.innerHTML = '<i class="fas fa-chart-line"></i> Line';
        plot.plotType = 'scatter';
    }
    plot.updatePlot(spectrumData);
}
document.getElementById('cal-input').onchange = event => importCalButton(event.target);
function importCalButton(input) {
    if (input.files === null || input.files.length === 0) {
        return;
    }
    importCal(input.files[0]);
}
function importCal(file) {
    let reader = new FileReader();
    reader.readAsText(file);
    reader.onload = () => {
        try {
            const result = reader.result.trim();
            const obj = JSON.parse(result);
            let readoutArray = [
                document.getElementById('adc-a'),
                document.getElementById('cal-a'),
                document.getElementById('adc-b'),
                document.getElementById('cal-b'),
                document.getElementById('adc-c'),
                document.getElementById('cal-c')
            ];
            if (obj.imported) {
                for (const element of document.getElementsByClassName('cal-setting')) {
                    const changeType = element;
                    changeType.disabled = true;
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
                        const value = obj.points[inputArr[index]];
                        if (value === -1) {
                            readoutArray[index].value = '';
                        }
                        else {
                            readoutArray[index].value = obj.points[inputArr[index]];
                        }
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
function addLeadingZero(number) {
    if (parseFloat(number) < 10) {
        return '0' + number;
    }
    else {
        return number;
    }
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
    if (-date.getTimezoneOffset() < 0) {
        localIsoString += '-';
    }
    else {
        localIsoString += '+';
    }
    const tzDate = new Date(Math.abs(date.getTimezoneOffset()));
    const tzString = addLeadingZero(tzDate.getHours().toString()) + ':' + addLeadingZero(tzDate.getMinutes().toString());
    localIsoString += tzString;
    return localIsoString;
}
document.getElementById('calibration-download').onclick = () => downloadCal();
function downloadCal() {
    const filename = `calibration_${getDateString()}.json`;
    download(filename, JSON.stringify(plot.calibration));
}
function makeXMLSpectrum(type, name, serial = false) {
    let root;
    let noc = document.createElementNS(null, 'NumberOfChannels');
    if (type === 'data') {
        root = document.createElementNS(null, 'EnergySpectrum');
    }
    else {
        root = document.createElementNS(null, 'BackgroundEnergySpectrum');
    }
    noc.textContent = spectrumData[type].length.toString();
    root.appendChild(noc);
    let sn = document.createElementNS(null, 'SpectrumName');
    sn.textContent = name;
    root.appendChild(sn);
    if (plot.calibration.enabled) {
        let ec = document.createElementNS(null, 'EnergyCalibration');
        root.appendChild(ec);
        let c = document.createElementNS(null, 'Coefficients');
        let coeffs = [];
        for (const index in plot.calibration.coeff) {
            coeffs.push(plot.calibration.coeff[index]);
        }
        for (const val of coeffs.reverse()) {
            let coeff = document.createElementNS(null, 'Coefficient');
            coeff.textContent = val.toString();
            c.appendChild(coeff);
        }
        ec.appendChild(c);
        let po = document.createElementNS(null, 'PolynomialOrder');
        po.textContent = (2).toString();
        ec.appendChild(po);
    }
    let tpc = document.createElementNS(null, 'TotalPulseCount');
    tpc.textContent = spectrumData.getTotalCounts(spectrumData[type]).toString();
    root.appendChild(tpc);
    let vpc = document.createElementNS(null, 'ValidPulseCount');
    vpc.textContent = tpc.textContent;
    root.appendChild(vpc);
    let mt = document.createElementNS(null, 'MeasurementTime');
    if (serial) {
        mt.textContent = (Math.round(timeDone / 1000)).toString();
    }
    else {
        mt.textContent = (1).toString();
    }
    root.appendChild(mt);
    let s = document.createElementNS(null, 'Spectrum');
    root.appendChild(s);
    for (const datapoint of spectrumData[type]) {
        let d = document.createElementNS(null, 'DataPoint');
        d.textContent = datapoint.toString();
        s.appendChild(d);
    }
    return root;
}
document.getElementById('xml-export-button-file').onclick = () => downloadXML();
document.getElementById('xml-export-button-serial').onclick = () => downloadXML(true);
function downloadXML(serial = false) {
    let filename;
    if (serial) {
        filename = `spectrum_${getDateString()}_serial.xml`;
    }
    else {
        filename = `spectrum_${getDateString()}.xml`;
    }
    const formatVersion = 230119;
    let spectrumName = 'Energy Spectrum';
    let backgroundName = 'Background Energy Spectrum';
    if (serial) {
        spectrumName = getDateStringMin() + ' ' + spectrumName;
        backgroundName = getDateStringMin() + ' ' + backgroundName;
    }
    let doc = document.implementation.createDocument(null, "ResultDataFile");
    const pi = doc.createProcessingInstruction('xml', 'version="1.0" encoding="UTF-8"');
    doc.insertBefore(pi, doc.firstChild);
    let root = doc.documentElement;
    let fv = document.createElementNS(null, 'FormatVersion');
    fv.textContent = formatVersion.toString();
    root.appendChild(fv);
    let rdl = document.createElementNS(null, 'ResultDataList');
    root.appendChild(rdl);
    let rd = document.createElementNS(null, 'ResultData');
    rdl.appendChild(rd);
    let dcr = document.createElementNS(null, 'DeviceConfigReference');
    rd.appendChild(dcr);
    let dcrName = document.createElementNS(null, 'Name');
    dcrName.textContent = document.getElementById('device-name').value;
    dcr.appendChild(dcrName);
    if (startDate) {
        let st = document.createElementNS(null, 'StartTime');
        st.textContent = toLocalIsoString(startDate);
        rd.appendChild(st);
        let et = document.createElementNS(null, 'EndTime');
        rd.appendChild(et);
        if (endDate && endDate.getTime() - startDate.getTime() >= 0) {
            et.textContent = toLocalIsoString(endDate);
        }
        else {
            et.textContent = toLocalIsoString(new Date());
        }
    }
    let si = document.createElementNS(null, 'SampleInfo');
    rd.appendChild(si);
    let name = document.createElementNS(null, 'Name');
    name.textContent = document.getElementById('sample-name').value;
    si.appendChild(name);
    let l = document.createElementNS(null, 'Location');
    l.textContent = document.getElementById('sample-loc').value;
    si.appendChild(l);
    let t = document.createElementNS(null, 'Time');
    const tval = document.getElementById('sample-time').value;
    if (tval.length !== 0) {
        t.textContent = toLocalIsoString(new Date(tval));
        si.appendChild(t);
    }
    let w = document.createElementNS(null, 'Weight');
    const wval = document.getElementById('sample-weight').value;
    if (wval.length !== 0) {
        w.textContent = (parseFloat(wval) / 1000).toString();
        si.appendChild(w);
    }
    let v = document.createElementNS(null, 'Volume');
    const vval = document.getElementById('sample-vol').value;
    if (vval.length !== 0) {
        v.textContent = (parseFloat(vval) / 1000).toString();
        si.appendChild(v);
    }
    let note = document.createElementNS(null, 'Note');
    note.textContent = document.getElementById('add-notes').value;
    si.appendChild(note);
    if (spectrumData['background'].length !== 0) {
        let bsf = document.createElementNS(null, 'BackgroundSpectrumFile');
        bsf.textContent = backgroundName;
        rd.appendChild(bsf);
    }
    if (spectrumData['data'].length !== 0) {
        rd.appendChild(makeXMLSpectrum('data', spectrumName, serial));
    }
    if (spectrumData['background'].length !== 0) {
        rd.appendChild(makeXMLSpectrum('background', backgroundName, serial));
    }
    let vis = document.createElementNS(null, 'Visible');
    vis.textContent = true.toString();
    rd.appendChild(vis);
    download(filename, new XMLSerializer().serializeToString(doc));
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
    let element = document.createElement('a');
    element.setAttribute('href', `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`);
    element.setAttribute('download', filename);
    element.style.display = 'none';
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
}
function popupNotification(id) {
    const element = document.getElementById(id);
    const toast = new bootstrap.Toast(element);
    toast.show();
}
function hideNotification(id) {
    const element = document.getElementById(id);
    const toast = new bootstrap.Toast(element);
    toast.hide();
}
document.getElementById('toggle-menu').onclick = () => loadIsotopes();
let loadedIsos = false;
async function loadIsotopes(reload = false) {
    if (loadedIsos && !reload) {
        return true;
    }
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
        let response = await fetch(isoListURL, options);
        if (response.ok) {
            const json = await response.json();
            loadedIsos = true;
            const tableElement = document.getElementById('iso-table');
            tableElement.innerHTML = '';
            plot.clearAnnos();
            plot.updatePlot(spectrumData);
            let intKeys = Object.keys(json);
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
                const dirtyName = json[key].toLowerCase();
                const lowercaseName = dirtyName.replace(/[^a-z0-9 -]/gi, '').trim();
                const name = lowercaseName.charAt(0).toUpperCase() + lowercaseName.slice(1) + '-' + index;
                cell1.innerHTML = `<input class="form-check-input iso-table-label" id="${name}" type="checkbox" value="${energy}">`;
                cell3.innerHTML = `<span class="iso-table-label">${energy.toFixed(2)}</span>`;
                const clickBox = document.getElementById(name);
                clickBox.onclick = () => plotIsotope(clickBox);
                const strArr = name.split('-');
                cell2.innerHTML = `<span class="iso-table-label"><sup>${strArr[1]}</sup>${strArr[0]}</span>`;
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
document.getElementById('reload-isos-btn').onclick = () => reloadIsotopes();
function reloadIsotopes() {
    loadIsotopes(true);
}
function seekClosest(value) {
    const closeVals = Object.keys(isoList).filter(energy => {
        if (energy) {
            return Math.abs(parseFloat(energy) - value) <= maxDist;
        }
        return false;
    });
    const closeValsNum = closeVals.map(energy => parseFloat(energy));
    if (closeValsNum.length > 0) {
        const closest = closeValsNum.reduce((prev, curr) => Math.abs(curr - value) < Math.abs(prev - value) ? curr : prev);
        const name = isoList[closest];
        return { energy: closest, name: name };
    }
    else {
        return { energy: undefined, name: undefined };
    }
}
document.getElementById('iso-hover').onclick = () => toggleIsoHover();
let prevIso = {};
function toggleIsoHover() {
    checkNearIso = !checkNearIso;
    closestIso(-100000);
}
async function closestIso(value) {
    if (!await loadIsotopes()) {
        return;
    }
    const { energy, name } = seekClosest(value);
    if (Object.keys(prevIso).length >= 0) {
        const energyVal = parseFloat(Object.keys(prevIso)[0]);
        if (!isNaN(energyVal)) {
            plot.toggleLine(energyVal, Object.keys(prevIso)[0], false);
        }
    }
    if (energy !== undefined && name !== undefined) {
        let newIso = {};
        newIso[energy] = name;
        if (prevIso !== newIso) {
            prevIso = newIso;
        }
        plot.toggleLine(energy, name);
    }
    plot.updatePlot(spectrumData);
}
function plotIsotope(checkbox) {
    const wordArray = checkbox.id.split('-');
    const name = wordArray[0] + '-' + wordArray[1];
    plot.toggleLine(parseFloat(checkbox.value), name, checkbox.checked);
    plot.updatePlot(spectrumData);
}
document.getElementById('check-all-isos').onclick = (event) => selectAll(event.target);
function selectAll(selectBox) {
    const tableElement = document.getElementById('table');
    const tableBody = tableElement.tBodies[0];
    const tableRows = tableBody.rows;
    for (const row of tableRows) {
        const checkBox = row.cells[0].firstChild;
        checkBox.checked = selectBox.checked;
        if (selectBox.checked) {
            const wordArray = checkBox.id.split('-');
            const name = wordArray[0] + '-' + wordArray[1];
            plot.toggleLine(parseFloat(checkBox.value), name, checkBox.checked);
        }
    }
    if (!selectBox.checked) {
        plot.clearShapeAnno();
    }
    plot.updatePlot(spectrumData);
}
document.getElementById('peak-finder-btn').onclick = event => findPeaks(event.target);
async function findPeaks(button) {
    if (plot.peakConfig.enabled) {
        if (plot.peakConfig.mode === 0) {
            await loadIsotopes();
            plot.peakConfig.mode++;
            button.innerText = 'Isotope';
        }
        else {
            plot.peakFinder(false);
            plot.peakConfig.enabled = false;
            button.innerText = 'None';
        }
    }
    else {
        plot.peakConfig.enabled = true;
        plot.peakConfig.mode = 0;
        button.innerText = 'Energy';
    }
    plot.updatePlot(spectrumData);
}
function saveJSON(name, value) {
    localStorage.setItem(name, JSON.stringify(value));
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
    document.getElementById('custom-ser-buffer').value = ser.maxSize.toString();
    document.getElementById('custom-ser-adc').value = ser.adcChannels.toString();
    const autoStop = document.getElementById('ser-limit');
    autoStop.value = (maxRecTime / 1000).toString();
    autoStop.disabled = !maxRecTimeEnabled;
    document.getElementById('ser-limit-btn').disabled = !maxRecTimeEnabled;
    document.getElementById('toggle-time-limit').checked = maxRecTimeEnabled;
    document.getElementById('iso-hover-prox').value = maxDist.toString();
    document.getElementById('custom-baud').value = serOptions.baudRate.toString();
    document.getElementById('eol-char').value = ser.eolChar;
    document.getElementById('smaVal').value = plot.smaLength.toString();
    document.getElementById('peak-thres').value = plot.peakConfig.thres.toString();
    document.getElementById('peak-lag').value = plot.peakConfig.lag.toString();
    document.getElementById('peak-width').value = plot.peakConfig.width.toString();
    document.getElementById('seek-width').value = plot.peakConfig.seekWidth.toString();
    const formatSelector = document.getElementById('download-format');
    for (let i = 0; i < formatSelector.options.length; i++) {
        if (formatSelector.options[i].value === plot.downloadFormat) {
            formatSelector.selectedIndex = i;
        }
    }
}
function loadSettingsStorage() {
    let setting = loadJSON('customURL');
    if (setting) {
        const newUrl = new URL(setting);
        isoListURL = newUrl.href;
    }
    setting = loadJSON('editMode');
    if (setting) {
        plot.editableMode = setting;
    }
    setting = loadJSON('fileDelimiter');
    if (setting) {
        raw.delimiter = setting;
    }
    setting = loadJSON('fileChannels');
    if (setting) {
        raw.adcChannels = setting;
    }
    setting = loadJSON('plotRefreshRate');
    if (setting) {
        refreshRate = setting;
    }
    setting = loadJSON('serBufferSize');
    if (setting) {
        ser.maxSize = setting;
    }
    setting = loadJSON('serADC');
    if (setting) {
        ser.adcChannels = setting;
    }
    setting = loadJSON('timeLimitBool');
    if (setting) {
        maxRecTimeEnabled = setting;
    }
    setting = loadJSON('timeLimit');
    if (setting) {
        maxRecTime = setting;
    }
    setting = loadJSON('maxIsoDist');
    if (setting) {
        maxDist = setting;
    }
    setting = loadJSON('baudRate');
    if (setting) {
        serOptions.baudRate = setting;
    }
    setting = loadJSON('eolChar');
    if (setting) {
        ser.eolChar = setting;
    }
    setting = loadJSON('smaLength');
    if (setting) {
        plot.smaLength = setting;
    }
    setting = loadJSON('peakThres');
    if (setting) {
        plot.peakConfig.thres = setting;
    }
    setting = loadJSON('peakLag');
    if (setting) {
        plot.peakConfig.lag = setting;
    }
    setting = loadJSON('peakWidth');
    if (setting) {
        plot.peakConfig.width = setting;
    }
    setting = loadJSON('seekWidth');
    if (setting) {
        plot.peakConfig.seekWidth = setting;
    }
    setting = loadJSON('plotDownload');
    if (setting) {
        plot.downloadFormat = setting;
    }
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
            if (localStorageAvailable) {
                saveJSON(name, boolVal);
            }
            break;
        case 'customURL':
            try {
                const newUrl = new URL(value);
                isoListURL = newUrl.href;
                reloadIsotopes();
                if (localStorageAvailable) {
                    saveJSON(name, isoListURL);
                }
            }
            catch (e) {
                popupNotification('setting-error');
                console.error('Custom URL Error', e);
            }
            break;
        case 'fileDelimiter':
            raw.delimiter = value;
            if (localStorageAvailable) {
                saveJSON(name, value);
            }
            break;
        case 'fileChannels':
            numVal = parseInt(value);
            raw.adcChannels = numVal;
            if (localStorageAvailable) {
                saveJSON(name, numVal);
            }
            break;
        case 'timeLimitBool':
            boolVal = element.checked;
            document.getElementById('ser-limit').disabled = !boolVal;
            document.getElementById('ser-limit-btn').disabled = !boolVal;
            maxRecTimeEnabled = boolVal;
            if (localStorageAvailable) {
                saveJSON(name, boolVal);
            }
            break;
        case 'timeLimit':
            numVal = parseFloat(value);
            maxRecTime = numVal * 1000;
            if (localStorageAvailable) {
                saveJSON(name, maxRecTime);
            }
            break;
        case 'maxIsoDist':
            numVal = parseFloat(value);
            maxDist = numVal;
            if (localStorageAvailable) {
                saveJSON(name, maxDist);
            }
            break;
        case 'plotRefreshRate':
            numVal = parseFloat(value);
            refreshRate = numVal * 1000;
            if (localStorageAvailable) {
                saveJSON(name, refreshRate);
            }
            break;
        case 'serBufferSize':
            numVal = parseInt(value);
            ser.maxSize = numVal;
            if (localStorageAvailable) {
                saveJSON(name, ser.maxSize);
            }
            break;
        case 'baudRate':
            numVal = parseInt(value);
            serOptions.baudRate = numVal;
            if (localStorageAvailable) {
                saveJSON(name, serOptions.baudRate);
            }
            break;
        case 'eolChar':
            ser.eolChar = value;
            if (localStorageAvailable) {
                saveJSON(name, value);
            }
            break;
        case 'serChannels':
            numVal = parseInt(value);
            ser.adcChannels = numVal;
            if (localStorageAvailable) {
                saveJSON(name, numVal);
            }
            break;
        case 'peakThres':
            numVal = parseFloat(value);
            plot.peakConfig.thres = numVal;
            plot.updatePlot(spectrumData);
            if (localStorageAvailable) {
                saveJSON(name, numVal);
            }
            break;
        case 'peakLag':
            numVal = parseInt(value);
            plot.peakConfig.lag = numVal;
            plot.updatePlot(spectrumData);
            if (localStorageAvailable) {
                saveJSON(name, numVal);
            }
            break;
        case 'peakWidth':
            numVal = parseInt(value);
            plot.peakConfig.width = numVal;
            plot.updatePlot(spectrumData);
            if (localStorageAvailable) {
                saveJSON(name, numVal);
            }
            break;
        case 'seekWidth':
            numVal = parseFloat(value);
            plot.peakConfig.seekWidth = numVal;
            plot.updatePlot(spectrumData);
            if (localStorageAvailable) {
                saveJSON(name, numVal);
            }
            break;
        case 'plotDownload':
            plot.downloadFormat = value;
            plot.updatePlot(spectrumData);
            if (localStorageAvailable) {
                saveJSON(name, value);
            }
            break;
        default:
            popupNotification('setting-error');
            return;
    }
    popupNotification('setting-success');
}
document.getElementById('reset-gamma-mca').onclick = () => resetMCA();
function resetMCA() {
    if (localStorageAvailable) {
        localStorage.clear();
    }
    window.location.reload();
}
document.getElementById('s1').onchange = event => selectSerialType(event.target);
document.getElementById('s2').onchange = event => selectSerialType(event.target);
function selectSerialType(button) {
    ser.orderType = button.value;
}
function serialConnect() {
    listSerial();
    popupNotification('serial-connect');
}
;
function serialDisconnect(event) {
    for (const key in portsAvail) {
        if (portsAvail[key] == event.target) {
            delete portsAvail[key];
            break;
        }
    }
    if (event.target === ser.port) {
        disconnectPort(true);
    }
    listSerial();
    popupNotification('serial-disconnect');
}
;
document.getElementById('serial-list-btn').onclick = () => listSerial();
async function listSerial() {
    const portSelector = document.getElementById('port-selector');
    for (const index in portSelector.options) {
        portSelector.remove(parseInt(index));
    }
    const ports = await navigator.serial.getPorts();
    for (const index in ports) {
        portsAvail[index] = ports[index];
        const option = document.createElement('option');
        const usbId = ports[index].getInfo().usbProductId;
        option.text = `Port ${index} (Id: 0x${usbId?.toString(16)})`;
        portSelector.add(option, parseInt(index));
    }
    const serSettingsElements = document.getElementsByClassName('ser-settings');
    if (ports.length === 0) {
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
            const max = Math.max(...intKeys);
            portsAvail[max + 1] = port;
        }
        listSerial();
    }
    catch (err) {
        console.warn('Aborted adding a new port!', err);
    }
}
document.getElementById('plot-cps').onclick = event => toggleCps(event.target);
function toggleCps(button, off = false) {
    if (off) {
        plot.cps = false;
    }
    else {
        plot.cps = !plot.cps;
    }
    if (plot.cps) {
        button.innerText = 'CPS';
    }
    else {
        button.innerText = 'Total';
    }
    plot.updatePlot(spectrumData);
}
async function selectPort() {
    const selector = document.getElementById('port-selector');
    const index = selector.selectedIndex;
    const newport = portsAvail[index];
    if (ser.port !== newport) {
        ser.port = newport;
        clearConsoleLog();
    }
}
let keepReading = false;
let reader;
let recordingType;
let startTime = 0;
let timeDone = 0;
async function readUntilClosed() {
    while (ser.port?.readable && keepReading) {
        try {
            reader = ser.port.readable.getReader();
            while (true) {
                const { value, done } = await reader.read();
                if (value) {
                    ser.addRaw(value, onlyConsole);
                }
                if (done) {
                    break;
                }
            }
        }
        catch (err) {
            console.error('Misc Serial Read Error:', err);
            popupNotification('misc-ser-error');
        }
        finally {
            reader?.releaseLock();
            reader = undefined;
        }
    }
    await ser.port?.close();
}
document.getElementById('resume-button').onclick = () => startRecord(true);
document.getElementById('record-spectrum-btn').onclick = () => startRecord(false, 'data');
document.getElementById('record-bg-btn').onclick = () => startRecord(false, 'background');
let closed;
let firstLoad = false;
let startDate;
let endDate;
async function startRecord(pause = false, type = recordingType) {
    try {
        selectPort();
        if (ser.port === undefined) {
            throw 'Port is undefined! This should not be happening.';
        }
        await ser.port.open(serOptions);
        keepReading = true;
        recordingType = type;
        ser.flushData();
        if (!pause) {
            removeFile(recordingType);
            firstLoad = true;
            timeDone = 0;
            startDate = new Date();
        }
        document.getElementById('export-button').disabled = false;
        document.getElementById('stop-button').disabled = false;
        document.getElementById('pause-button').classList.remove('d-none');
        document.getElementById('record-button').classList.add('d-none');
        document.getElementById('resume-button').classList.add('d-none');
        for (const ele of document.getElementsByClassName('recording-spinner')) {
            ele.classList.remove('d-none');
        }
        startTime = performance.now();
        refreshRender(recordingType);
        refreshMeta(recordingType);
        if (pause) {
            cpsValues.pop();
        }
        else {
            cpsValues.shift();
        }
        closed = readUntilClosed();
        plot.updatePlot(spectrumData);
    }
    catch (err) {
        console.error('Connection Error:', err);
        popupNotification('serial-connect-error');
    }
}
window.addEventListener('show.bs.modal', (event) => {
    if (event.target.getAttribute('id') === 'serialConsoleModal') {
        readSerial();
    }
});
window.addEventListener('hide.bs.modal', (event) => {
    if (event.target.getAttribute('id') === 'serialConsoleModal') {
        if (onlyConsole) {
            disconnectPort(true);
            onlyConsole = false;
        }
        clearTimeout(consoleTimeout);
    }
});
let onlyConsole = false;
async function readSerial() {
    try {
        selectPort();
        if (ser.port === undefined) {
            throw 'Port is undefined! This should not be happening.';
        }
        if (keepReading) {
            refreshConsole();
            onlyConsole = false;
            return;
        }
        else {
            onlyConsole = true;
        }
        await ser.port.open(serOptions);
        keepReading = true;
        refreshConsole();
        closed = readUntilClosed();
    }
    catch (err) {
        console.error('Connection Error:', err);
        popupNotification('serial-connect-error');
        onlyConsole = false;
    }
}
document.getElementById('send-command').onclick = () => sendSerial(document.getElementById('ser-command').value);
async function sendSerial(command) {
    try {
        if (ser.port === undefined) {
            throw 'Port is undefined! This should not be happening.';
        }
        const textEncoder = new TextEncoderStream();
        const writer = textEncoder.writable.getWriter();
        const writableStreamClosed = textEncoder.readable.pipeTo(ser.port.writable);
        const formatCommand = command.trim() + '\n';
        writer.write(formatCommand);
        await writer.close();
        await writableStreamClosed;
        document.getElementById('ser-command').value = '';
    }
    catch (err) {
        console.error('Connection Error:', err);
        popupNotification('serial-connect-error');
    }
}
document.getElementById('pause-button').onclick = () => disconnectPort();
document.getElementById('stop-button').onclick = () => disconnectPort(true);
async function disconnectPort(stop = false) {
    timeDone += performance.now() - startTime;
    document.getElementById('pause-button').classList.add('d-none');
    for (const ele of document.getElementsByClassName('recording-spinner')) {
        ele.classList.add('d-none');
    }
    if (stop) {
        document.getElementById('stop-button').disabled = true;
        document.getElementById('record-button').classList.remove('d-none');
        cpsValues = [];
        const cpsButton = document.getElementById('plot-cps');
        toggleCps(cpsButton, true);
        ser.clearBaseHist();
        endDate = new Date();
    }
    document.getElementById('resume-button').classList.toggle('d-none', stop);
    keepReading = false;
    ser.flushData();
    try {
        clearTimeout(refreshTimeout);
        clearTimeout(metaTimeout);
        clearTimeout(consoleTimeout);
    }
    catch (err) {
        console.warn('No timeout to clear.', err);
    }
    try {
        reader?.cancel();
    }
    catch (err) {
        console.warn('Nothing to disconnect.', err);
    }
    await closed;
}
document.getElementById('reconnect-console-log').onclick = () => reconnectConsole();
async function reconnectConsole() {
    if (onlyConsole) {
        await disconnectPort(true);
    }
    clearTimeout(consoleTimeout);
    readSerial();
}
document.getElementById('clear-console-log').onclick = () => clearConsoleLog();
function clearConsoleLog() {
    document.getElementById('ser-output').innerText = '';
    ser.flushRawData();
}
let consoleTimeout;
function refreshConsole() {
    if (ser.port?.readable) {
        document.getElementById('ser-output').innerText = ser.getRawData();
        consoleTimeout = setTimeout(refreshConsole, CONSOLE_REFRESH);
    }
}
let metaTimeout;
function refreshMeta(type) {
    if (ser.port?.readable) {
        const nowTime = performance.now();
        const totalTimeElement = document.getElementById('total-record-time');
        const timeElement = document.getElementById('record-time');
        const progressBar = document.getElementById('ser-time-progress-bar');
        const delta = new Date(nowTime - startTime + timeDone);
        timeElement.innerText = addLeadingZero(delta.getUTCHours().toString()) + ':' + addLeadingZero(delta.getUTCMinutes().toString()) + ':' + addLeadingZero(delta.getUTCSeconds().toString());
        if (maxRecTimeEnabled) {
            const progressElement = document.getElementById('ser-time-progress');
            const progress = Math.round(delta.getTime() / maxRecTime * 100);
            progressElement.style.width = progress + '%';
            progressElement.innerText = progress + '%';
            progressElement.setAttribute('aria-valuenow', progress.toString());
            const totalTime = new Date(maxRecTime);
            totalTimeElement.innerText = ' / ' + addLeadingZero(totalTime.getUTCHours().toString()) + ':' + addLeadingZero(totalTime.getUTCMinutes().toString()) + ':' + addLeadingZero(totalTime.getUTCSeconds().toString());
        }
        else {
            totalTimeElement.innerText = '';
        }
        progressBar.classList.toggle('d-none', !maxRecTimeEnabled);
        if (delta.getTime() > maxRecTime && maxRecTimeEnabled) {
            disconnectPort(true);
            popupNotification('auto-stop');
        }
        else {
            const finishDelta = performance.now() - nowTime;
            if (REFRESH_META_TIME - finishDelta > 0) {
                metaTimeout = setTimeout(refreshMeta, REFRESH_META_TIME - finishDelta, type);
            }
            else {
                metaTimeout = setTimeout(refreshMeta, 1, type);
            }
        }
    }
}
let lastUpdate = performance.now();
let refreshTimeout;
function refreshRender(type) {
    if (ser.port?.readable) {
        const startDelay = performance.now();
        const newData = ser.getData();
        const endDelay = performance.now();
        const delta = new Date(timeDone - startTime + startDelay);
        spectrumData[type] = ser.updateData(spectrumData[type], newData);
        spectrumData[`${type}Cps`] = spectrumData[type].map(val => val / delta.getTime() * 1000);
        if (firstLoad) {
            plot.plotData(spectrumData, false);
            bindPlotEvents();
            firstLoad = false;
        }
        else {
            plot.updatePlot(spectrumData);
        }
        const deltaLastRefresh = endDelay - lastUpdate;
        lastUpdate = endDelay;
        const cpsValue = newData.length / deltaLastRefresh * 1000;
        document.getElementById('cps').innerText = cpsValue.toFixed(1) + ' cps';
        cpsValues.push(cpsValue);
        let mean = 0;
        cpsValues.forEach(item => mean += item);
        mean /= cpsValues.length;
        document.getElementById('avg-cps').innerHTML = 'Avg: ' + mean.toFixed(1);
        let std = 0;
        cpsValues.forEach(item => std += Math.pow(item - mean, 2));
        std /= (cpsValues.length - 1);
        std = Math.sqrt(std);
        document.getElementById('avg-cps-std').innerHTML = ` &plusmn; ${std.toFixed(1)} cps (&#916; ${Math.round(std / mean * 100)}%)`;
        document.getElementById('total-spec-cts').innerText = spectrumData.getTotalCounts(spectrumData.data).toString();
        document.getElementById('total-bg-cts').innerText = spectrumData.getTotalCounts(spectrumData.background).toString();
        const finishDelta = performance.now() - startDelay;
        if (refreshRate - finishDelta > 0) {
            refreshTimeout = setTimeout(refreshRender, refreshRate - finishDelta, type);
        }
        else {
            refreshTimeout = setTimeout(refreshRender, 1, type);
        }
    }
}
