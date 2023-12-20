import { SpectrumPlot, SeekClosest, CalculateFWHM } from './plot.js';
import { RawData } from './raw-data.js';
import { SerialManager, WebSerial, WebUSBSerial } from './serial.js';
import { ToastNotification, launchSysNotification } from './notifications.js';
import { applyTheming, autoThemeChange } from './global-theming.js';
export class SpectrumData {
    data = [];
    background = [];
    dataCps = [];
    backgroundCps = [];
    dataTime = 1000;
    backgroundTime = 1000;
    getTotalCounts(type, start = 0, end = this[type].length - 1) {
        const dataArr = this[type];
        let sum = 0;
        if (start < 0 || start >= dataArr.length || end < 0 || end >= dataArr.length || start > end) {
            console.warn('Invalid sum range! Return default 0.');
            return sum;
        }
        for (let i = start; i <= end; i++) {
            sum += dataArr[i];
        }
        return sum;
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
let portsAvail = [];
let refreshRate = 1000;
let maxRecTimeEnabled = false;
let maxRecTime = 1800000;
const REFRESH_META_TIME = 200;
const CONSOLE_REFRESH = 200;
const AUTOSAVE_TIME = 900000;
let cpsValues = [];
let isoListURL = 'assets/isotopes_energies_min.json';
const isoList = {};
let checkNearIso = false;
let maxDist = 100;
const APP_VERSION = '2023-12-20';
const localStorageAvailable = 'localStorage' in self;
const wakeLockAvailable = 'wakeLock' in navigator;
const notificationsAvailable = 'Notification' in window;
let allowNotifications = notificationsAvailable;
let fileSystemWritableAvail = false;
let firstInstall = false;
const isoTableSortDirections = ['none', 'none', 'none'];
const faSortClasses = {
    none: 'fa-sort',
    asc: 'fa-sort-up',
    desc: 'fa-sort-down'
};
const hotkeys = {
    'r': 'reset-plot',
    's': 'sma-label',
    'x': 'xAxis',
    'y': 'yAxis',
    'c': 'plot-cps',
    't': 'plot-type',
    'i': 'iso-hover-label',
    'p': 'peak-finder-btn',
    '1': 'file-import-tab',
    '2': 'serial-tab',
    '3': 'calibration-tab',
    '4': 'metadata-tab',
};
window.addEventListener('DOMContentLoaded', () => {
    if (localStorageAvailable) {
        plot.darkMode = applyTheming() === 'dark';
        resetPlot(false);
    }
});
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (localStorageAvailable) {
        plot.darkMode = autoThemeChange() === 'dark';
        resetPlot(false);
    }
});
document.body.onload = async function () {
    fileSystemWritableAvail = (window.FileSystemHandle && 'createWritable' in FileSystemFileHandle.prototype);
    if (localStorageAvailable) {
        loadSettingsStorage();
    }
    else {
        console.error('Browser does not support local storage. OOF, it must be ancient. Dude, update your browser. For real.');
    }
    if (navigator.serviceWorker) {
        const reg = await navigator.serviceWorker.register('/service-worker.js');
        if (localStorageAvailable) {
            reg.addEventListener('updatefound', () => {
                if (firstInstall)
                    return;
                new ToastNotification('updateInstalled');
                launchSysNotification('New Update!', 'An update has been installed and will be applied once you reload Gamma MCA.');
            });
        }
    }
    if ('standalone' in window.navigator || window.matchMedia('(display-mode: standalone)').matches) {
        document.title += ' PWA';
        document.getElementById('main').classList.remove('p-1');
        const borderModeElements = document.getElementsByClassName('border-mode');
        for (const element of borderModeElements) {
            element.classList.add('border-0');
        }
        document.getElementById('plot-tab').classList.add('border-start-0', 'border-end-0');
    }
    else {
        document.getElementById('main').classList.remove('pb-1');
        document.title += ' web application';
    }
    isoListURL = new URL(isoListURL, window.location.origin).href;
    if (navigator.serial || navigator.usb) {
        const serErrDiv = document.getElementById('serial-error');
        serErrDiv.parentNode.removeChild(serErrDiv);
        navigator[navigator.serial ? 'serial' : 'usb'].addEventListener('connect', serialConnect);
        navigator[navigator.serial ? 'serial' : 'usb'].addEventListener('disconnect', serialDisconnect);
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
            if (fileSystemWritableAvail) {
                if (fileEnding === 'json' || fileEnding === 'xml') {
                    dataFileHandle = launchParams.files[0];
                    document.getElementById('overwrite-button').disabled = false;
                }
            }
            const spectrumEndings = ['csv', 'tka', 'xml', 'txt', 'json'];
            if (spectrumEndings.includes(fileEnding))
                getFileData(file, 'data');
            console.warn('File could not be imported!');
        });
    }
    resetPlot();
    document.getElementById('version-tag').innerText += ` ${APP_VERSION}.`;
    if (localStorageAvailable) {
        if (loadJSON('lastVisit') <= 0) {
            new ToastNotification('welcomeMessage');
            if (notificationsAvailable)
                legacyPopupNotification('ask-notifications');
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
        new ToastNotification('welcomeMessage');
    }
    loadSettingsDefault();
    sizeCheck();
    bindInputs();
    const menuElements = document.getElementById('main-tabs').getElementsByTagName('button');
    for (const button of menuElements) {
        button.addEventListener('shown.bs.tab', () => {
            const toggleCalChartElement = document.getElementById('toggle-calibration-chart');
            const toggleEvolChartElement = document.getElementById('toggle-evolution-chart');
            if (toggleCalChartElement.checked || toggleEvolChartElement.checked) {
                toggleCalChartElement.checked = false;
                toggleEvolChartElement.checked = false;
                toggleCalChart(false);
                toogleEvolChart(false);
            }
            else {
                plot.updatePlot(spectrumData);
            }
        });
    }
    const isoTable = document.getElementById('table');
    const thList = isoTable.querySelectorAll('th[data-sort-by]');
    thList.forEach(th => {
        th.addEventListener('click', () => {
            const columnIndex = Number(th.dataset.sortBy);
            const sortDirection = isoTableSortDirections[columnIndex];
            isoTableSortDirections.fill('none');
            isoTableSortDirections[columnIndex] = sortDirection === 'asc' ? 'desc' : 'asc';
            thList.forEach((loopTableHeader, index) => {
                const sortIcon = loopTableHeader.querySelector('.fa-solid');
                sortIcon.classList.remove(...Object.values(faSortClasses));
                sortIcon.classList.add(faSortClasses[isoTableSortDirections[index + 1]]);
            });
            sortTableByColumn(isoTable, columnIndex, isoTableSortDirections[columnIndex]);
        });
    });
    if (notificationsAvailable) {
        document.getElementById('notifications-toggle').disabled = false;
    }
    else {
        console.error('Browser does not support Notifications API.');
    }
    bindHotkeys();
    if (localStorageAvailable)
        checkAutosave();
    const loadingOverlay = document.getElementById('loading');
    loadingOverlay.parentNode.removeChild(loadingOverlay);
};
window.onbeforeunload = (event) => {
    event.preventDefault();
    return event.returnValue = 'Are you sure you want to exit?';
};
window.onpagehide = () => {
    localStorage.removeItem('autosave');
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
            legacyPopupNotification('pwa-installer');
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
document.getElementById('notifications-toggle').onclick = event => toggleNotifications(event.target.checked);
document.getElementById('notifications-toast-btn').onclick = () => toggleNotifications(true);
function toggleNotifications(toggle) {
    allowNotifications = toggle;
    if (Notification.permission !== 'granted') {
        if (allowNotifications) {
            Notification.requestPermission().then((permission) => {
                if (permission === 'granted') {
                    launchSysNotification('Success!', 'Notifications for Gamma MCA are now enabled.', true);
                }
                allowNotifications = allowNotifications && (permission === 'granted');
                document.getElementById('notifications-toggle').checked = allowNotifications;
                const result = saveJSON('allowNotifications', allowNotifications);
                new ToastNotification(result ? 'settingSuccess' : 'settingError');
            });
        }
    }
    hideNotification('ask-notifications');
    document.getElementById('notifications-toggle').checked = allowNotifications;
    const result = saveJSON('allowNotifications', allowNotifications);
    new ToastNotification(result ? 'settingSuccess' : 'settingError');
}
document.getElementById('data').onclick = event => clickFileInput(event, 'data');
document.getElementById('background').onclick = event => clickFileInput(event, 'background');
const openFileTypes = [
    {
        description: 'Combination data file',
        accept: {
            'application/json': ['.json'],
            'application/xml': ['.xml']
        }
    },
    {
        description: 'Single spectrum file',
        accept: {
            'text/csv': ['.csv'],
            'text/txt': ['.txt'],
            'text/TKA': ['.TKA']
        }
    }
];
let dataFileHandle;
let backgroundFileHandle;
async function clickFileInput(event, type) {
    if (window.FileSystemHandle && window.showOpenFilePicker) {
        event.preventDefault();
        const openFilePickerOptions = {
            types: openFileTypes,
            multiple: false
        };
        let fileHandle;
        try {
            [fileHandle] = await window.showOpenFilePicker(openFilePickerOptions);
        }
        catch (error) {
            console.warn('File Picker error:', error);
            return;
        }
        const file = await fileHandle.getFile();
        getFileData(file, type);
        const fileExtension = file.name.split('.')[1].toLowerCase();
        if (fileExtension !== 'json' && fileExtension !== 'xml') {
            return;
        }
        if (type === 'background') {
            backgroundFileHandle = fileHandle;
        }
        else {
            dataFileHandle = fileHandle;
        }
        if (fileSystemWritableAvail) {
            document.getElementById('overwrite-button').disabled = false;
        }
    }
}
document.getElementById('data').onchange = event => importFile(event.target, 'data');
document.getElementById('background').onchange = event => importFile(event.target, 'background');
function importFile(input, type) {
    if (!input.files?.length)
        return;
    getFileData(input.files[0], type);
}
function getFileData(file, type) {
    const reader = new FileReader();
    const fileEnding = file.name.split('.')[1];
    reader.readAsText(file);
    reader.onerror = () => {
        new ToastNotification('fileError');
        return;
    };
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
                    type = 'both';
                }
                else if (!espectrum?.length && !bgspectrum?.length) {
                    new ToastNotification('fileError');
                }
                else if (type !== 'both') {
                    const fileData = espectrum?.length ? espectrum : bgspectrum;
                    const fileDataTime = (espectrum?.length ? meta.dataMt : meta.backgroundMt) * 1000;
                    const fileDataType = type;
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
                    toggleCal(true);
                }
            }
            else {
                console.error('No DOM parser in this browser!');
            }
        }
        else if (fileEnding.toLowerCase() === 'json') {
            const jsonData = await raw.jsonToObject(result);
            if (jsonData.length > 1) {
                const fileSelectModalElement = document.getElementById('file-select-modal');
                const fileSelectModal = new window.bootstrap.Modal(fileSelectModalElement);
                const selectElement = document.getElementById('select-spectrum');
                selectElement.options.length = 0;
                for (const dataPackage of jsonData) {
                    if (checkJSONImportError(file.name, dataPackage))
                        return;
                    const opt = document.createElement('option');
                    const optionValue = {
                        'filename': file.name,
                        'package': dataPackage,
                        'type': type,
                    };
                    opt.value = JSON.stringify(optionValue);
                    opt.text = `${dataPackage.sampleInfo?.name} (${dataPackage.resultData.startTime ?? 'Undefined Time'})`;
                    selectElement.add(opt);
                }
                fileSelectModal.show();
            }
            else {
                const importData = jsonData[0];
                if (checkJSONImportError(file.name, importData))
                    return;
                npesFileImport(file.name, importData, type);
            }
            return;
        }
        else if (type === 'background') {
            spectrumData.backgroundTime = 1000;
            spectrumData.background = raw.csvToArray(result);
        }
        else {
            spectrumData.dataTime = 1000;
            spectrumData.data = raw.csvToArray(result);
        }
        finalizeFileImport(file.name, type);
    };
}
function checkJSONImportError(filename, data) {
    if ('code' in data && 'description' in data) {
        const importErrorModalElement = document.getElementById('import-error-modal');
        const fileImportErrorModal = new window.bootstrap.Modal(importErrorModalElement);
        document.getElementById('error-filename').innerText = filename;
        document.getElementById('error-code').innerText = data.code;
        document.getElementById('error-desc').innerText = data.description;
        fileImportErrorModal.show();
        return true;
    }
    return false;
}
function npesFileImport(filename, importData, type) {
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
        type = 'both';
    }
    else if (type !== 'both') {
        const dataObj = espectrum ?? bgspectrum;
        const fileData = dataObj?.spectrum ?? [];
        const fileDataTime = (dataObj?.measurementTime ?? 1) * 1000;
        const fileDataType = type;
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
        toggleCal(true);
    }
    finalizeFileImport(filename, type);
}
function finalizeFileImport(filename, type) {
    console.log('hello');
    if (type === 'both') {
        document.getElementById('data-form-label').innerText = filename;
        document.getElementById('background-form-label').innerText = filename;
    }
    else {
        document.getElementById(`${type}-form-label`).innerText = filename;
    }
    updateSpectrumCounts();
    updateSpectrumTime();
    if (spectrumData.background.length !== spectrumData.data.length && spectrumData.data.length && spectrumData.background.length) {
        new ToastNotification('dataError');
        removeFile(type);
    }
    plot.resetPlot(spectrumData);
    bindPlotEvents();
}
document.getElementById('spectrum-select-btn').onclick = () => getJSONSelectionData();
function getJSONSelectionData() {
    const fileSelectData = JSON.parse(document.getElementById('select-spectrum').value);
    npesFileImport(fileSelectData.filename, fileSelectData.package, fileSelectData.type);
    const fileSelectModalElement = document.getElementById('file-select-modal');
    const closeButton = fileSelectModalElement.querySelector('.btn-close');
    closeButton.click();
}
function checkAutosave() {
    const data = loadJSON('autosave');
    if (data)
        legacyPopupNotification('autosave-dialog');
}
document.getElementById('restore-data-btn').onclick = () => loadAutosave(true);
document.getElementById('discard-data-btn').onclick = () => loadAutosave(false);
async function loadAutosave(restore) {
    const data = loadJSON('autosave');
    if (data) {
        localStorage.removeItem('autosave');
        if (restore) {
            const objData = await raw.jsonToObject(data);
            if (objData.length) {
                const importData = objData[0];
                npesFileImport('Autosave Data', importData, 'data');
            }
            else {
                console.error('Could not load autosaved data!');
            }
        }
    }
}
function sizeCheck() {
    const minWidth = 1100;
    const minHeight = 700;
    if (document.documentElement.clientWidth <= minWidth || document.documentElement.clientHeight <= minHeight) {
        console.warn(`Small screen detected. Screen should be at least ${minWidth}x${minHeight} px for the best experience.`);
    }
}
document.getElementById('clear-data').onclick = () => removeFile('data');
document.getElementById('clear-bg').onclick = () => removeFile('background');
function removeFile(type) {
    let removeType;
    if (type === 'both') {
        removeType = ['data', 'background'];
    }
    else {
        removeType = [type];
    }
    for (const id of removeType) {
        spectrumData[id] = [];
        spectrumData[`${id}Time`] = 0;
        document.getElementById(id).value = '';
        document.getElementById(`${id}-form-label`).innerText = 'No File Chosen';
        if (id === 'data')
            dataFileHandle = undefined;
        if (id === 'background')
            backgroundFileHandle = undefined;
        if (!dataFileHandle && !backgroundFileHandle && fileSystemWritableAvail) {
            document.getElementById('overwrite-button').disabled = true;
        }
        document.getElementById(id + '-icon').classList.add('d-none');
    }
    updateSpectrumCounts();
    updateSpectrumTime();
    plot.resetPlot(spectrumData);
    bindPlotEvents();
}
function addImportLabel() {
    document.getElementById('calibration-title').classList.remove('d-none');
}
function updateSpectrumCounts() {
    const sCounts = spectrumData.getTotalCounts('data');
    const bgCounts = spectrumData.getTotalCounts('background');
    document.getElementById('total-spec-cts').innerText = sCounts.toString();
    document.getElementById('total-bg-cts').innerText = bgCounts.toString();
    if (sCounts)
        document.getElementById('data-icon').classList.remove('d-none');
    if (bgCounts)
        document.getElementById('background-icon').classList.remove('d-none');
}
function updateSpectrumTime() {
    document.getElementById('spec-time').innerText = getRecordTimeStamp(spectrumData.dataTime);
    document.getElementById('bg-time').innerText = getRecordTimeStamp(spectrumData.backgroundTime);
}
document.getElementById('r1').onchange = event => selectFileType(event.target);
document.getElementById('r2').onchange = event => selectFileType(event.target);
function selectFileType(button) {
    raw.fileType = parseInt(button.value);
    raw.valueIndex = parseInt(button.value);
    saveJSON('fileDataMode', button.id);
}
document.getElementById('reset-plot').onclick = () => resetPlot();
function resetPlot(hardReset = true) {
    if (hardReset) {
        if (plot.xAxis === 'log')
            changeAxis(document.getElementById('xAxis'));
        if (plot.yAxis === 'log')
            changeAxis(document.getElementById('yAxis'));
        if (plot.sma)
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
document.getElementById('sma').onclick = event => toggleSma(event.target.checked);
function toggleSma(value, thisValue = null) {
    plot.sma = value;
    if (thisValue)
        thisValue.checked = false;
    plot.updatePlot(spectrumData);
}
document.getElementById('sma-val').oninput = event => changeSma(event.target);
function changeSma(input) {
    const parsedInput = parseInt(input.value);
    if (isNaN(parsedInput)) {
        new ToastNotification('smaError');
    }
    else {
        plot.smaLength = parsedInput;
        plot.updatePlot(spectrumData);
        saveJSON('smaLength', parsedInput);
    }
}
function bindPlotEvents() {
    if (!plot.plotDiv)
        return;
    const myPlot = plot.plotDiv;
    myPlot.on('plotly_hover', hoverEvent);
    myPlot.on('plotly_unhover', unHover);
    myPlot.on('plotly_click', clickEvent);
    myPlot.on('plotly_selected', selectEvent);
    myPlot.addEventListener('contextmenu', (event) => {
        event.preventDefault();
    });
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
let prevClickLine;
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
    if (prevClickLine)
        plot.toggleLine(prevClickLine, prevClickLine.toString(), false);
    if (data.event.button === 0) {
        const newLine = Math.round(data.points[0].x);
        plot.toggleLine(newLine, newLine.toString(), true);
        prevClickLine = newLine;
    }
    else if (data.event.button === 2) {
        prevClickLine = undefined;
    }
    plot.updatePlot(spectrumData);
}
function selectEvent(data) {
    const roiElement = document.getElementById('roi-info');
    const infoElement = document.getElementById('static-info');
    if (!data?.range?.x.length) {
        roiElement.classList.add('d-none');
        infoElement.classList.remove('d-none');
        return;
    }
    roiElement.classList.remove('d-none');
    infoElement.classList.add('d-none');
    let range = data.range.x;
    range = range.map(value => Math.round(value));
    let start = range[0];
    let end = range[1];
    document.getElementById('roi-range').innerText = `${start.toString()} - ${end.toString()}`;
    document.getElementById('roi-range-unit').innerText = plot.calibration.enabled ? ' keV' : '';
    if (plot.calibration.enabled) {
        const max = Math.max(spectrumData.data.length, spectrumData.background.length);
        const calAxis = plot.getCalAxis(max);
        const axisLength = calAxis.length;
        const findPoints = [start, end];
        const numberOfPoints = findPoints.length;
        const binPoints = [];
        let compareIndex = 0;
        for (let i = 0; i < axisLength; i++) {
            const value = calAxis[i];
            const compareValue = findPoints[compareIndex];
            if (value > compareValue) {
                binPoints.push(i);
                compareIndex++;
                if (compareIndex >= numberOfPoints)
                    break;
            }
        }
        start = binPoints[0];
        end = binPoints[1];
    }
    const total = spectrumData.getTotalCounts('data', start, end);
    const bg = spectrumData.getTotalCounts('background', start, end);
    const net = total - bg;
    document.getElementById('total-counts').innerText = total.toString();
    document.getElementById('net-counts').innerText = net.toString();
    document.getElementById('bg-counts').innerText = bg.toString();
    document.getElementById('bg-ratio').innerText = (net / bg * 100).toFixed();
}
document.getElementById('apply-cal').onclick = event => toggleCal(event.target.checked);
async function toggleCal(enabled) {
    const button = document.getElementById('calibration-label');
    button.innerHTML = enabled ? '<i class="fa-solid fa-rotate-left"></i> Reset' : '<i class="fa-solid fa-check"></i> Calibrate';
    document.getElementById('apply-cal').checked = enabled;
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
                    new ToastNotification('calibrationApplyError');
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
            await plot.computeCoefficients();
        }
    }
    displayCoeffs();
    plot.calibration.enabled = enabled;
    plot.resetPlot(spectrumData);
    bindPlotEvents();
}
function displayCoeffs() {
    const arr = ['c1', 'c2', 'c3'];
    for (const elem of arr) {
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
document.getElementById('plot-type').onclick = () => changeType();
function changeType() {
    const button = document.getElementById('plot-type');
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
            new ToastNotification('calibrationImportError');
        }
    };
    reader.onerror = () => {
        new ToastNotification('fileError');
        return;
    };
}
document.getElementById('toggle-calibration-chart').onclick = event => toggleCalChart(event.target.checked);
function toggleCalChart(enabled) {
    const buttonLabel = document.getElementById('toggle-cal-chart-label');
    buttonLabel.innerHTML = enabled ? '<i class="fa-solid fa-eye-slash fa-beat-fade"></i> Hide Chart' : '<i class="fa-solid fa-eye"></i> Show Chart';
    plot.setChartType(enabled ? 'calibration' : 'default', spectrumData);
    if (!enabled)
        bindPlotEvents();
}
document.getElementById('toggle-evolution-chart').onclick = event => toogleEvolChart(event.target.checked);
function toogleEvolChart(enabled) {
    const buttonLabel = document.getElementById('toggle-evol-chart-label');
    buttonLabel.innerHTML = enabled ? '<i class="fa-solid fa-eye-slash fa-beat-fade"></i> Hide Evolution' : '<i class="fa-solid fa-eye"></i> Show Evolution';
    plot.setChartType(enabled ? 'evolution' : 'default', spectrumData, cpsValues);
    if (!enabled)
        bindPlotEvents();
}
function addLeadingZero(number) {
    if (parseFloat(number) < 10)
        return '0' + number;
    return number;
}
function getDateString() {
    const time = new Date();
    return time.getFullYear() + '-' + addLeadingZero((time.getMonth() + 1).toString()) + '-' + addLeadingZero(time.getDate().toString()) + '_' + addLeadingZero(time.getHours().toString()) + '-' + addLeadingZero(time.getMinutes().toString());
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
    download(`calibration_${getDateString()}.json`, JSON.stringify(calObj), 'CAL');
}
document.getElementById('xml-export-btn').onclick = () => downloadXML();
function downloadXML() {
    const filename = `spectrum_${getDateString()}.xml`;
    const content = generateXML();
    download(filename, content, 'XML');
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
    const data = spectrumData[type];
    for (const datapoint of data) {
        const d = document.createElementNS(null, 'DataPoint');
        d.textContent = datapoint.toString();
        s.appendChild(d);
    }
    return root;
}
function generateXML() {
    const formatVersion = 230124;
    const spectrumName = getDateStringMin() + ' Energy Spectrum';
    const backgroundName = getDateStringMin() + ' Background Energy Spectrum';
    const doc = document.implementation.createDocument(null, 'ResultDataFile');
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
    return new XMLSerializer().serializeToString(doc);
}
document.getElementById('npes-export-btn').onclick = () => downloadNPES();
function downloadNPES() {
    const filename = `spectrum_${getDateString()}.json`;
    const data = generateNPES();
    download(filename, data, 'JSON');
}
function makeJSONSpectrum(type) {
    const spec = {
        numberOfChannels: spectrumData[type].length,
        validPulseCount: spectrumData.getTotalCounts(type),
        measurementTime: 0,
        spectrum: spectrumData[type]
    };
    spec.measurementTime = Math.round(spectrumData[`${type}Time`] / 1000);
    if (plot.calibration.enabled) {
        const calObj = {
            polynomialOrder: 0,
            coefficients: []
        };
        calObj.polynomialOrder = 2;
        calObj.coefficients = [plot.calibration.coeff.c3, plot.calibration.coeff.c2, plot.calibration.coeff.c1];
        spec.energyCalibration = calObj;
    }
    return spec;
}
function generateNPES() {
    const data = {
        schemaVersion: 'NPESv2',
        data: []
    };
    const dataPackage = {
        deviceData: {
            softwareName: 'Gamma MCA, ' + APP_VERSION,
            deviceName: document.getElementById('device-name').value.trim()
        },
        sampleInfo: {
            name: document.getElementById('sample-name').value.trim(),
            location: document.getElementById('sample-loc').value.trim(),
            note: document.getElementById('add-notes').value.trim()
        },
        resultData: {}
    };
    let val = parseFloat(document.getElementById('sample-weight').value.trim());
    if (val)
        dataPackage.sampleInfo.weight = val;
    val = parseFloat(document.getElementById('sample-vol').value.trim());
    if (val)
        dataPackage.sampleInfo.volume = val;
    const tval = document.getElementById('sample-time').value.trim();
    if (tval.length && new Date(tval))
        dataPackage.sampleInfo.time = toLocalIsoString(new Date(tval));
    if (startDate) {
        dataPackage.resultData.startTime = toLocalIsoString(startDate);
        if (endDate && endDate.getTime() - startDate.getTime() >= 0) {
            dataPackage.resultData.endTime = toLocalIsoString(endDate);
        }
        else {
            dataPackage.resultData.endTime = toLocalIsoString(new Date());
        }
    }
    if (spectrumData.data.length && spectrumData.getTotalCounts('data'))
        dataPackage.resultData.energySpectrum = makeJSONSpectrum('data');
    if (spectrumData.background.length && spectrumData.getTotalCounts('background'))
        dataPackage.resultData.backgroundEnergySpectrum = makeJSONSpectrum('background');
    if (!dataPackage.resultData.energySpectrum && !dataPackage.resultData.backgroundEnergySpectrum) {
        return undefined;
    }
    data.data.push(dataPackage);
    return JSON.stringify(data);
}
document.getElementById('download-spectrum-btn').onclick = () => downloadData('spectrum', 'data');
document.getElementById('download-bg-btn').onclick = () => downloadData('background', 'background');
function downloadData(filename, data) {
    filename += `_${getDateString()}.csv`;
    let text = '';
    spectrumData[data].forEach(item => text += item + '\n');
    download(filename, text, 'CSV');
}
document.getElementById('overwrite-button').onclick = () => overwriteFile();
async function overwriteFile() {
    if (dataFileHandle && backgroundFileHandle) {
        new ToastNotification('saveMultipleAtOnce');
        return;
    }
    if (!dataFileHandle && !backgroundFileHandle) {
        console.error('No file handlers found to save to!');
        return;
    }
    const handler = (dataFileHandle ?? backgroundFileHandle);
    const writable = await handler.createWritable();
    const file = await handler.getFile();
    const fileExtension = file.name.split('.')[1].toLowerCase();
    let content;
    if (fileExtension === 'xml') {
        content = generateXML();
    }
    else {
        content = generateNPES();
    }
    if (!content?.trim()) {
        new ToastNotification('fileEmptyError');
        return;
    }
    await writable.write(content);
    await writable.close();
    new ToastNotification('saveFile');
}
const saveFileTypes = {
    'CAL': {
        description: 'Calibration data file',
        accept: {
            'application/json': ['.json']
        }
    },
    'XML': {
        description: 'Combination data file (XML)',
        accept: {
            'application/xml': ['.xml']
        }
    },
    'JSON': {
        description: 'Combination data file (NPESv2, smaller size)',
        accept: {
            'application/json': ['.json']
        }
    },
    'CSV': {
        description: 'Single spectrum file',
        accept: {
            'text/csv': ['.csv']
        }
    }
};
async function download(filename, text, type) {
    if (!text?.trim()) {
        new ToastNotification('fileEmptyError');
        return;
    }
    if (window.FileSystemHandle && window.showSaveFilePicker) {
        const saveFilePickerOptions = {
            suggestedName: filename,
            types: [saveFileTypes[type]]
        };
        let newHandle;
        try {
            newHandle = await window.showSaveFilePicker(saveFilePickerOptions);
        }
        catch (error) {
            console.warn('File SaveAs error:', error);
            return;
        }
        if (dataFileHandle) {
            dataFileHandle = newHandle;
        }
        else if (backgroundFileHandle) {
            backgroundFileHandle = newHandle;
        }
        const writableStream = await newHandle.createWritable();
        await writableStream.write(text);
        await writableStream.close();
        new ToastNotification('saveFile');
    }
    else {
        const element = document.createElement('a');
        element.setAttribute('href', `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`);
        element.setAttribute('download', filename);
        element.style.display = 'none';
        element.click();
    }
    localStorage.removeItem('autosave');
    const exportModalElement = document.getElementById('export-modal');
    const closeButton = exportModalElement.querySelector('.btn-close');
    closeButton.click();
}
document.getElementById('reset-meta-values').onclick = () => resetSampleInfo();
function resetSampleInfo() {
    const toBeReset = document.getElementsByClassName('sample-info');
    for (const element of toBeReset) {
        element.value = '';
    }
}
document.getElementById('print-report').onclick = () => printReport();
function printReport() {
    const copyPeakFlag = plot.peakConfig.enabled;
    if (!copyPeakFlag)
        useGaussPeakMode(document.getElementById('peak-finder-btn'));
    const dataArray = plot.computePulseHeightData(spectrumData);
    const metaDataString = generateNPES();
    if (!copyPeakFlag)
        useIdlePeakMode(document.getElementById('peak-finder-btn'));
    if (!dataArray.length || !metaDataString) {
        console.error('Nothing to analyze, no data found. Cannot print report!');
        new ToastNotification('reportError');
        return;
    }
    const printWindow = window.open('/print.html', '_blank');
    if (printWindow) {
        printWindow.onload = () => {
            const printDocument = printWindow.document;
            const metaData = JSON.parse(metaDataString).data[0];
            printDocument.getElementById('sample-name').innerText = metaData.sampleInfo?.name || 'N/A';
            printDocument.getElementById('sample-loc').innerText = metaData.sampleInfo?.location || 'N/A';
            printDocument.getElementById('sample-time').innerText = metaData.sampleInfo?.time || 'N/A';
            printDocument.getElementById('note').innerText = metaData.sampleInfo?.note || 'N/A';
            printDocument.getElementById('device-name').innerText = metaData.deviceData?.deviceName || 'N/A';
            printDocument.getElementById('software-name').innerText = metaData.deviceData?.softwareName || 'N/A';
            printDocument.getElementById('start-time').innerText = metaData.resultData.startTime ?? 'N/A';
            printDocument.getElementById('end-time').innerText = metaData.resultData.endTime ?? 'N/A';
            printDocument.getElementById('total-time-gross').innerText = metaData.resultData.energySpectrum?.measurementTime?.toString() || 'N/A';
            printDocument.getElementById('total-time-bg').innerText = metaData.resultData.backgroundEnergySpectrum?.measurementTime?.toString() || 'N/A';
            printDocument.getElementById('cal-coeffs').innerText = JSON.stringify(plot.calibration.enabled ? plot.calibration.coeff : { c1: 0, c2: 0, c3: 0 }) || 'N/A';
            const tableHeadRow = printDocument.getElementById('peak-table-head-row');
            const cell1 = document.createElement('th');
            cell1.innerHTML = 'Peak Number <br>[1]';
            tableHeadRow.appendChild(cell1);
            const cell2 = document.createElement('th');
            cell2.innerHTML = `Energy <br>[${plot.calibration.enabled ? 'keV' : 'bin'}]`;
            tableHeadRow.appendChild(cell2);
            const cell3 = document.createElement('th');
            cell3.innerHTML = 'Net Peak Area <br>(3&sigma;) [cts]';
            tableHeadRow.appendChild(cell3);
            const cell4 = document.createElement('th');
            cell4.innerHTML = 'Background Peak Area <br>(3&sigma;) [cts]';
            tableHeadRow.appendChild(cell4);
            const cell5 = document.createElement('th');
            cell5.innerHTML = `FWHM <br>[${plot.calibration.enabled ? 'keV' : 'bin'}]`;
            tableHeadRow.appendChild(cell5);
            const cell6 = document.createElement('th');
            cell6.innerHTML = 'FWHM <br>[%]';
            tableHeadRow.appendChild(cell6);
            const cell7 = document.createElement('th');
            cell7.innerHTML = 'Net Peak Counts/s <br>(3&sigma;) [cps]';
            tableHeadRow.appendChild(cell7);
            const tableBody = printDocument.getElementById('peak-table-body');
            const dataX = dataArray[0].x;
            const dataY = dataArray[0].y;
            const peaks = plot.peakFinder(dataY);
            let index = 1;
            for (const peak of peaks) {
                const xPosition = dataX[Math.round(peak)];
                if (xPosition < 0)
                    continue;
                const peakFWHM = new CalculateFWHM([xPosition], dataArray[1].x, dataArray[1].y).compute()[xPosition];
                const energyResolution = new CalculateFWHM([xPosition], dataArray[1].x, dataArray[1].y).getResolution()[xPosition];
                const sigmaMaxCenterDistance = 2 * peakFWHM / (2 * Math.sqrt(2 * Math.LN2));
                const peakCounterXMin = xPosition - sigmaMaxCenterDistance;
                const peakCounterXMax = xPosition + sigmaMaxCenterDistance;
                let spectrumValue = 0;
                let backgroundValue = 0;
                for (const i in dataX) {
                    const xPos = dataX[i];
                    if (xPos >= peakCounterXMin && xPos <= peakCounterXMax) {
                        spectrumValue += dataArray[1].y[i];
                        if (dataArray.length > 2)
                            backgroundValue += dataArray[2].y[i];
                    }
                }
                const row = tableBody.insertRow();
                const cell1 = document.createElement('th');
                cell1.innerText = index.toString();
                row.appendChild(cell1);
                const cell2 = row.insertCell();
                cell2.innerText = xPosition.toFixed(2);
                const cell3 = row.insertCell();
                cell3.innerText = (peakFWHM > 0 && peakFWHM < 0.9 * CalculateFWHM.resolutionLimit * xPosition) ? (spectrumValue * (plot.cps ? metaData.resultData.energySpectrum?.measurementTime ?? 1 : 1)).toFixed(0) : 'N/A';
                const cell4 = row.insertCell();
                cell4.innerText = (peakFWHM > 0 && peakFWHM < 0.9 * CalculateFWHM.resolutionLimit * xPosition) ? (backgroundValue * (plot.cps ? metaData.resultData.backgroundEnergySpectrum?.measurementTime ?? 1 : 1)).toFixed(0) : 'N/A';
                const cell5 = row.insertCell();
                cell5.innerText = (peakFWHM > 0 && peakFWHM < 0.9 * CalculateFWHM.resolutionLimit * xPosition) ? peakFWHM.toFixed(3) : 'OVF';
                const cell6 = row.insertCell();
                cell6.innerText = (energyResolution > 0 && energyResolution < 0.9 * CalculateFWHM.resolutionLimit) ? (energyResolution * 100).toFixed(2) : 'OVF';
                const cell7 = row.insertCell();
                cell7.innerText = (peakFWHM > 0 && peakFWHM < 0.9 * CalculateFWHM.resolutionLimit * xPosition) ? (plot.cps ? spectrumValue : spectrumValue / (metaData.resultData.energySpectrum?.measurementTime ?? 1)).toExponential(3) : 'N/A';
                index++;
            }
            window.Plotly.toImage(plot.plotDiv, { format: 'png', height: 400, width: 1000 }).then(function (url) {
                const img = printDocument.getElementById('plot-image');
                img.src = url;
                img.onload = () => printWindow.print();
            });
        };
        printWindow.onafterprint = () => printWindow.close();
    }
    else {
        console.error('Unable to open a new window for printing.');
    }
}
function legacyPopupNotification(id) {
    const toast = new window.bootstrap.Toast(document.getElementById(id));
    if (!toast.isShown())
        toast.show();
}
function hideNotification(id) {
    const toast = new window.bootstrap.Toast(document.getElementById(id));
    if (toast.isShown())
        toast.hide();
}
function sortTableByColumn(table, columnIndex, sortDirection) {
    const tbody = table.tBodies[0];
    const rows = Array.from(tbody.rows);
    rows.sort((a, b) => {
        const aCellValue = a.cells[columnIndex].textContent?.trim() ?? '';
        const bCellValue = b.cells[columnIndex].textContent?.trim() ?? '';
        const aNumValue = parseFloat(aCellValue.replace(/[^\d.-]/g, ''));
        const bNumValue = parseFloat(bCellValue.replace(/[^\d.-]/g, ''));
        if (isNaN(aNumValue) || isNaN(bNumValue)) {
            return aCellValue.localeCompare(bCellValue);
        }
        const comparison = aNumValue - bNumValue;
        return sortDirection === 'asc' ? comparison : -comparison;
    });
    tbody.append(...rows);
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
            const table = document.getElementById('table');
            const tableElement = table.querySelector('#iso-table');
            tableElement.innerHTML = '';
            for (const [key, energyArr] of Object.entries(json)) {
                let index = 0;
                const lowercaseName = key.toLowerCase().replace(/[^a-z0-9 -]/gi, '').trim();
                const name = lowercaseName.charAt(0).toUpperCase() + lowercaseName.slice(1);
                for (const energy of energyArr) {
                    if (isNaN(energy))
                        continue;
                    if (isoList[name]) {
                        isoList[name].push(energy);
                    }
                    else {
                        isoList[name] = [energy];
                    }
                    const uniqueName = name + '-' + index;
                    index++;
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
                    cell1.innerHTML = `<input class="form-check-input iso-table-label" id="${uniqueName}" type="checkbox" value="${energy}">`;
                    cell3.innerText = energy.toFixed(2);
                    const clickBox = document.getElementById(uniqueName);
                    clickBox.onclick = () => plotIsotope(clickBox);
                    const strArr = name.split('-');
                    cell2.innerHTML = `<sup>${strArr[1]}</sup>${strArr[0]}`;
                }
            }
            if (isoTableSortDirections[2] !== 'asc') {
                const sortButton = table.querySelector('th[data-sort-by="2"]');
                sortButton.click();
            }
            else {
                sortTableByColumn(table, 2, 'asc');
            }
            plot.clearAnnos();
            plot.updatePlot(spectrumData);
            plot.isotopeSeeker = new SeekClosest(isoList);
            isotopeSeeker = new SeekClosest(isoList);
        }
        else {
            isoError.innerText = `Could not load isotope list! HTTP Error: ${response.status}. Please try again.`;
            isoError.classList.remove('d-none');
            successFlag = false;
        }
    }
    catch (err) {
        console.error(err);
        isoError.innerText = 'Could not load isotope list! Connection refused - you are probably offline.';
        isoError.classList.remove('d-none');
        successFlag = false;
    }
    loadingElement.classList.add('d-none');
    return successFlag;
}
document.getElementById('iso-hover').onclick = () => toggleIsoHover();
let prevIso;
function toggleIsoHover() {
    checkNearIso = !checkNearIso;
    closestIso(-100000);
}
let isotopeSeeker;
async function closestIso(value) {
    if (!await loadIsotopes())
        return;
    if (!isotopeSeeker)
        isotopeSeeker = new SeekClosest(isoList);
    if (prevIso)
        plot.toggleLine(prevIso[1], prevIso[0], false);
    const { energy, name } = isotopeSeeker.seek(value, maxDist);
    if (energy && name) {
        const newIso = [name, energy];
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
function useIdlePeakMode(button) {
    plot.clearPeakFinder();
    plot.peakConfig.enabled = false;
    button.innerText = 'None';
}
function useGaussPeakMode(button) {
    plot.peakConfig.enabled = true;
    plot.peakConfig.mode = 'gaussian';
    button.innerText = 'Gaussian';
}
function useEnergyPeakMode(button) {
    plot.peakConfig.mode = 'energy';
    button.innerText = 'Energy';
}
async function useIsotopePeakMode(button) {
    plot.clearPeakFinder();
    await loadIsotopes();
    plot.peakConfig.mode = 'isotopes';
    button.innerText = 'Isotopes';
}
document.getElementById('peak-finder-btn').onclick = event => findPeaks(event.target);
async function findPeaks(button) {
    if (plot.peakConfig.enabled) {
        switch (plot.peakConfig.mode) {
            case 'gaussian':
                useEnergyPeakMode(button);
                break;
            case 'energy':
                await useIsotopePeakMode(button);
                break;
            case 'isotopes':
                useIdlePeakMode(button);
                break;
        }
    }
    else {
        useGaussPeakMode(button);
    }
    plot.updatePlot(spectrumData);
}
function bindHotkeys() {
    document.addEventListener('keydown', (event) => {
        if (event.key.toLowerCase() === 'escape') {
            const offcanvasElement = document.getElementById('offcanvas');
            if (offcanvasElement && !offcanvasElement.classList.contains('show')) {
                if (!offcanvasElement.classList.contains('showing')) {
                    new window.bootstrap.Offcanvas(offcanvasElement).show();
                }
            }
        }
    });
    const settingsButton = document.getElementById('toggle-menu');
    if (settingsButton)
        settingsButton.title += ' (ESC)';
    for (const [key, buttonId] of Object.entries(hotkeys)) {
        const button = document.getElementById(buttonId);
        document.addEventListener('keydown', (event) => {
            if (event.altKey && event.key.toLowerCase() === key.toLowerCase()) {
                event.preventDefault();
                if (!event.repeat)
                    button?.click();
            }
        });
        if (button)
            button.title += ` (ALT+${key.toUpperCase()})`;
    }
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
function bindInputs() {
    const nonSettingsEnterPressElements = {
        'sma-val': 'sma',
        'ser-command': 'send-command'
    };
    for (const [inputId, buttonId] of Object.entries(nonSettingsEnterPressElements)) {
        document.getElementById(inputId).onkeydown = event => {
            if (event.key === 'Enter')
                document.getElementById(buttonId)?.click();
        };
    }
    const settingsEnterPressElements = {
        'iso-hover-prox': 'maxIsoDist',
        'custom-url': 'customURL',
        'custom-delimiter': 'fileDelimiter',
        'custom-file-adc': 'fileChannels',
        'custom-baud': 'baudRate',
        'eol-char': 'eolChar',
        'ser-limit-h': 'timeLimit',
        'ser-limit-m': 'timeLimit',
        'ser-limit-s': 'timeLimit',
        'custom-ser-refresh': 'plotRefreshRate',
        'custom-ser-buffer': 'serBufferSize',
        'custom-ser-adc': 'serChannels',
        'peak-thres': 'peakThres',
        'peak-lag': 'peakLag',
        'seek-width': 'seekWidth',
        'gauss-sigma': 'gaussSigma'
    };
    for (const [inputId, settingsName] of Object.entries(settingsEnterPressElements)) {
        const valueElement = document.getElementById(inputId);
        valueElement.onkeydown = event => {
            if (event.key === 'Enter')
                changeSettings(settingsName, valueElement);
        };
        const buttonElement = document.getElementById(`${inputId}-btn`);
        if (buttonElement)
            buttonElement.onclick = () => changeSettings(settingsName, valueElement);
    }
    document.getElementById('new-flags').onclick = event => changeSettings('newPeakStyle', event.target);
    document.getElementById('enable-res').onclick = event => changeSettings('showEnergyRes', event.target);
    document.getElementById('fwhm-fast').onclick = event => changeSettings('useFWHMFast', event.target);
    document.getElementById('edit-plot').onclick = event => changeSettings('editMode', event.target);
    document.getElementById('toggle-time-limit').onclick = event => changeSettings('timeLimitBool', event.target);
    document.getElementById('download-format').onchange = event => changeSettings('plotDownload', event.target);
    document.getElementById('theme-select').onchange = event => changeSettings('theme', event.target);
}
function loadSettingsDefault() {
    if (notificationsAvailable) {
        document.getElementById('notifications-toggle').checked = allowNotifications && (Notification.permission === 'granted');
    }
    document.getElementById('custom-url').value = isoListURL;
    document.getElementById('edit-plot').checked = plot.editableMode;
    document.getElementById('custom-delimiter').value = raw.delimiter;
    document.getElementById('custom-file-adc').value = raw.adcChannels.toString();
    document.getElementById('custom-ser-refresh').value = (refreshRate / 1000).toString();
    document.getElementById('custom-ser-buffer').value = SerialManager.maxSize.toString();
    document.getElementById('custom-ser-adc').value = SerialManager.adcChannels.toString();
    const time = new Date(maxRecTime);
    document.getElementById('ser-limit-h').value = (time.getUTCHours() + (time.getUTCDate() - 1) * 24).toString();
    document.getElementById('ser-limit-m').value = time.getUTCMinutes().toString();
    document.getElementById('ser-limit-s').value = time.getUTCSeconds().toString();
    document.getElementById('toggle-time-limit').checked = maxRecTimeEnabled;
    document.getElementById('iso-hover-prox').value = maxDist.toString();
    document.getElementById('custom-baud').value = SerialManager.baudRate.toString();
    document.getElementById('eol-char').value = SerialManager.eolChar;
    document.getElementById('sma-val').value = plot.smaLength.toString();
    document.getElementById('new-flags').checked = plot.peakConfig.newPeakStyle;
    document.getElementById('enable-res').checked = plot.peakConfig.showFWHM;
    document.getElementById('fwhm-fast').checked = CalculateFWHM.fastMode;
    document.getElementById('peak-thres').value = plot.peakConfig.thres.toString();
    document.getElementById('peak-lag').value = plot.peakConfig.lag.toString();
    document.getElementById('seek-width').value = SeekClosest.seekWidth.toString();
    document.getElementById('gauss-sigma').value = plot.gaussSigma.toString();
    const formatSelector = document.getElementById('download-format');
    const formatLen = formatSelector.options.length;
    const format = plot.downloadFormat;
    for (let i = 0; i < formatLen; i++) {
        if (formatSelector.options[i].value === format)
            formatSelector.selectedIndex = i;
    }
    const themeSelector = document.getElementById('theme-select');
    const themeLen = themeSelector.options.length;
    const theme = loadJSON('theme');
    for (let i = 0; i < themeLen; i++) {
        if (themeSelector.options[i].value === theme)
            themeSelector.selectedIndex = i;
    }
}
function loadSettingsStorage() {
    let setting = loadJSON('allowNotifications');
    if (notificationsAvailable && setting !== null)
        allowNotifications = setting && (Notification.permission === 'granted');
    setting = loadJSON('customURL');
    if (setting)
        isoListURL = new URL(setting).href;
    setting = loadJSON('editMode');
    if (setting !== null)
        plot.editableMode = setting;
    setting = loadJSON('fileDelimiter');
    if (setting !== null)
        raw.delimiter = setting;
    setting = loadJSON('fileChannels');
    if (setting !== null)
        raw.adcChannels = setting;
    setting = loadJSON('plotRefreshRate');
    if (setting !== null)
        refreshRate = setting;
    setting = loadJSON('serBufferSize');
    if (setting !== null)
        SerialManager.maxSize = setting;
    setting = loadJSON('timeLimitBool');
    if (setting !== null)
        maxRecTimeEnabled = setting;
    setting = loadJSON('timeLimit');
    if (setting !== null)
        maxRecTime = setting;
    setting = loadJSON('maxIsoDist');
    if (setting !== null)
        maxDist = setting;
    setting = loadJSON('baudRate');
    if (setting !== null)
        SerialManager.baudRate = setting;
    setting = loadJSON('eolChar');
    if (setting !== null)
        SerialManager.eolChar = setting;
    setting = loadJSON('serChannels');
    if (setting !== null)
        SerialManager.adcChannels = setting;
    setting = loadJSON('smaLength');
    if (setting !== null)
        plot.smaLength = setting;
    setting = loadJSON('peakThres');
    if (setting !== null)
        plot.peakConfig.thres = setting;
    setting = loadJSON('peakLag');
    if (setting !== null)
        plot.peakConfig.lag = setting;
    setting = loadJSON('seekWidth');
    if (setting !== null)
        SeekClosest.seekWidth = setting;
    setting = loadJSON('plotDownload');
    if (setting !== null)
        plot.downloadFormat = setting;
    setting = loadJSON('gaussSigma');
    if (setting !== null)
        plot.gaussSigma = setting;
    setting = loadJSON('showEnergyRes');
    if (setting !== null)
        plot.peakConfig.showFWHM = setting;
    setting = loadJSON('useFWHMFast');
    if (setting !== null)
        CalculateFWHM.fastMode = setting;
    setting = loadJSON('newPeakStyle');
    if (setting !== null)
        plot.peakConfig.newPeakStyle = setting;
}
function changeSettings(name, element) {
    const stringValue = element.value.trim();
    let result = false;
    if (!element.checkValidity() || !stringValue) {
        new ToastNotification('settingType');
        return;
    }
    switch (name) {
        case 'editMode': {
            const boolVal = element.checked;
            plot.editableMode = boolVal;
            plot.resetPlot(spectrumData);
            bindPlotEvents();
            result = saveJSON(name, boolVal);
            break;
        }
        case 'customURL': {
            try {
                isoListURL = new URL(stringValue).href;
                loadIsotopes(true);
                result = saveJSON(name, isoListURL);
            }
            catch (e) {
                new ToastNotification('settingError');
                console.error('Custom URL Error', e);
            }
            break;
        }
        case 'fileDelimiter': {
            raw.delimiter = stringValue;
            result = saveJSON(name, stringValue);
            break;
        }
        case 'fileChannels': {
            const numVal = parseInt(stringValue);
            raw.adcChannels = numVal;
            result = saveJSON(name, numVal);
            break;
        }
        case 'timeLimitBool': {
            const boolVal = element.checked;
            maxRecTimeEnabled = boolVal;
            result = saveJSON(name, boolVal);
            break;
        }
        case 'timeLimit': {
            const timeElements = element.id.split('-');
            const elementIds = ['s', 'm', 'h'];
            let value = 0;
            for (const index in elementIds) {
                value += parseInt(document.getElementById(`${timeElements[0]}-${timeElements[1]}-${elementIds[index]}`).value.trim()) * 60 ** parseInt(index);
            }
            value *= 1000;
            maxRecTime = value;
            result = saveJSON(name, maxRecTime);
            break;
        }
        case 'maxIsoDist': {
            const numVal = parseFloat(stringValue);
            maxDist = numVal;
            result = saveJSON(name, maxDist);
            break;
        }
        case 'plotRefreshRate': {
            const numVal = parseFloat(stringValue);
            refreshRate = numVal * 1000;
            result = saveJSON(name, refreshRate);
            break;
        }
        case 'serBufferSize': {
            const numVal = parseInt(stringValue);
            SerialManager.maxSize = numVal;
            result = saveJSON(name, SerialManager.maxSize);
            break;
        }
        case 'baudRate': {
            const numVal = parseInt(stringValue);
            SerialManager.baudRate = numVal;
            result = saveJSON(name, SerialManager.baudRate);
            break;
        }
        case 'eolChar': {
            SerialManager.eolChar = stringValue;
            result = saveJSON(name, stringValue);
            break;
        }
        case 'serChannels': {
            const numVal = parseInt(stringValue);
            SerialManager.adcChannels = numVal;
            result = saveJSON(name, numVal);
            break;
        }
        case 'peakThres': {
            const numVal = parseFloat(stringValue);
            plot.peakConfig.thres = numVal;
            plot.updatePlot(spectrumData);
            result = saveJSON(name, numVal);
            break;
        }
        case 'peakLag': {
            const numVal = parseInt(stringValue);
            plot.peakConfig.lag = numVal;
            plot.updatePlot(spectrumData);
            result = saveJSON(name, numVal);
            break;
        }
        case 'seekWidth': {
            const numVal = parseFloat(stringValue);
            SeekClosest.seekWidth = numVal;
            plot.updatePlot(spectrumData);
            result = saveJSON(name, numVal);
            break;
        }
        case 'plotDownload': {
            plot.downloadFormat = stringValue;
            plot.updatePlot(spectrumData);
            result = saveJSON(name, stringValue);
            break;
        }
        case 'theme': {
            result = saveJSON(name, stringValue);
            plot.darkMode = applyTheming() === 'dark';
            resetPlot(false);
            break;
        }
        case 'gaussSigma': {
            const numVal = parseInt(stringValue);
            plot.gaussSigma = numVal;
            plot.updatePlot(spectrumData);
            result = saveJSON(name, numVal);
            break;
        }
        case 'showEnergyRes': {
            const boolVal = element.checked;
            plot.peakConfig.showFWHM = boolVal;
            plot.updatePlot(spectrumData);
            result = saveJSON(name, boolVal);
            break;
        }
        case 'useFWHMFast': {
            const boolVal = element.checked;
            CalculateFWHM.fastMode = boolVal;
            plot.updatePlot(spectrumData);
            result = saveJSON(name, boolVal);
            break;
        }
        case 'newPeakStyle': {
            const boolVal = element.checked;
            plot.peakConfig.newPeakStyle = boolVal;
            plot.updatePlot(spectrumData);
            result = saveJSON(name, boolVal);
            break;
        }
        default: {
            new ToastNotification('settingError');
            return;
        }
    }
    if (result)
        new ToastNotification('settingSuccess');
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
    new ToastNotification('serialConnect');
}
function serialDisconnect(event) {
    if (serRecorder?.isThisPort(event.target))
        disconnectPort(true);
    listSerial();
    new ToastNotification('serialDisconnect');
}
document.getElementById('serial-list-btn').onclick = () => listSerial();
async function listSerial() {
    const portSelector = document.getElementById('port-selector');
    const optionsLen = portSelector.options.length;
    for (let i = optionsLen; i >= 0; i--) {
        portSelector.remove(i);
    }
    portsAvail = [];
    if (navigator.serial) {
        const ports = await navigator.serial.getPorts();
        for (const port of ports) {
            portsAvail.push(new WebSerial(port));
        }
    }
    else {
        if (navigator.usb) {
            const ports = await navigator.usb.getDevices();
            for (const port of ports) {
                portsAvail.push(new WebUSBSerial(port));
            }
        }
    }
    let selectIndex = 0;
    for (const index in portsAvail) {
        const option = document.createElement('option');
        option.text = `Port ${index} (${portsAvail[index]?.getInfo()})`;
        portSelector.add(option, parseInt(index));
        if (serRecorder?.isThisPort(portsAvail[index]?.getPort())) {
            selectIndex = parseInt(index);
            option.text = '> ' + option.text;
        }
    }
    const serSettingsElements = document.getElementsByClassName('ser-settings');
    if (!portSelector.options.length) {
        const option = document.createElement('option');
        option.text = 'No Ports Available';
        portSelector.add(option);
        for (const element of serSettingsElements) {
            element.disabled = true;
        }
    }
    else {
        portSelector.selectedIndex = selectIndex;
        for (const element of serSettingsElements) {
            element.disabled = false;
        }
    }
}
document.getElementById('serial-add-device').onclick = () => requestSerial();
async function requestSerial() {
    try {
        if (navigator.serial) {
            await navigator.serial.requestPort();
        }
        else {
            await navigator.usb.requestDevice({
                filters: WebUSBSerial.deviceFilters
            });
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
    if (newport && !serRecorder?.isThisPort(newport.getPort())) {
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
let wakeLock;
async function startRecord(pause = false, type) {
    try {
        selectPort();
        await serRecorder?.startRecord(pause);
    }
    catch (err) {
        console.error('Connection Error:', err);
        new ToastNotification('serialConnectError');
        return;
    }
    if (wakeLockAvailable) {
        try {
            wakeLock = await navigator.wakeLock.request('screen');
            document.addEventListener('visibilitychange', async () => {
                if (wakeLock !== null && document.visibilityState === 'visible') {
                    wakeLock = await navigator.wakeLock.request('screen');
                }
            });
        }
        catch (err) {
            console.error('Screen Wake Lock Error:', err);
        }
    }
    recordingType = type;
    if (!pause) {
        removeFile(type);
        document.getElementById(`${type}-form-label`).innerText = 'Serial Recording';
        startDate = new Date();
    }
    document.getElementById('toggle-evolution-chart').disabled = false;
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
    autoSaveData();
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
    wakeLock?.release().then(() => {
        wakeLock = null;
    });
    try {
        clearTimeout(autosaveTimeout);
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
        new ToastNotification('miscSerialError');
        launchSysNotification('Recording Crashed!', 'A fatal error occured with the connected serial device and the recording has stopped.');
    }
}
document.getElementById('clear-console-log').onclick = () => clearConsoleLog();
function clearConsoleLog() {
    document.getElementById('ser-output').innerText = '';
    serRecorder?.flushRawData();
}
document.getElementById('serial-console-modal').addEventListener('show.bs.modal', () => {
    readSerial();
});
document.getElementById('serial-console-modal').addEventListener('hide.bs.modal', async () => {
    await serRecorder?.hideConsole();
    clearTimeout(consoleTimeout);
});
async function readSerial() {
    try {
        const portNumber = selectPort();
        document.getElementById('serial-console-title').innerText = `(Port ${portNumber})`;
        await serRecorder?.showConsole();
    }
    catch (err) {
        console.error('Connection Error:', err);
        new ToastNotification('serialConnectError');
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
        new ToastNotification('serialConnectError');
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
    if (serRecorder?.port?.isOpen) {
        document.getElementById('ser-output').innerText = serRecorder.getRawData();
        consoleTimeout = setTimeout(refreshConsole, CONSOLE_REFRESH);
        if (autoscrollEnabled)
            document.getElementById('ser-output').scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
}
let autosaveTimeout;
function autoSaveData() {
    const autosaveBadgeElement = document.getElementById('autosave-badge');
    const data = generateNPES();
    if (data) {
        if (saveJSON('autosave', data)) {
            const formatOptions = {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: 'numeric',
                hour12: false,
            };
            const formatter = new Intl.DateTimeFormat('en-US', formatOptions);
            const currentDateTimeString = formatter.format(new Date());
            autosaveBadgeElement.title = `The data was last saved automatically on ${currentDateTimeString}.`;
            autosaveBadgeElement.innerHTML = `<i class="fa-solid fa-check"></i> Autosaved ${currentDateTimeString}`;
        }
    }
    autosaveBadgeElement?.classList.toggle('d-none', data ? false : true);
    autosaveTimeout = setTimeout(autoSaveData, AUTOSAVE_TIME);
}
function getRecordTimeStamp(time) {
    const dateTime = new Date(time);
    return addLeadingZero((dateTime.getUTCHours() + (dateTime.getUTCDate() - 1) * 24).toString()) + ':' + addLeadingZero(dateTime.getUTCMinutes().toString()) + ':' + addLeadingZero(dateTime.getUTCSeconds().toString());
}
let metaTimeout;
function refreshMeta(type) {
    if (serRecorder?.port?.isOpen) {
        const nowTime = performance.now();
        const totalTimeElement = document.getElementById('total-record-time');
        const totalMeasTime = serRecorder.getTime();
        spectrumData[`${type}Time`] = totalMeasTime;
        document.getElementById('record-time').innerText = getRecordTimeStamp(totalMeasTime);
        const delta = new Date(totalMeasTime);
        const progressBar = document.getElementById('ser-time-progress-bar');
        progressBar.classList.toggle('d-none', !maxRecTimeEnabled);
        if (maxRecTimeEnabled) {
            const progressElement = document.getElementById('ser-time-progress');
            const progress = Math.round(delta.getTime() / maxRecTime * 100);
            progressElement.style.width = progress + '%';
            progressElement.innerText = progress + '%';
            progressBar.setAttribute('aria-valuenow', progress.toString());
            totalTimeElement.innerText = ' / ' + getRecordTimeStamp(maxRecTime);
        }
        else {
            totalTimeElement.innerText = '';
        }
        updateSpectrumTime();
        if (delta.getTime() >= maxRecTime && maxRecTimeEnabled) {
            disconnectPort(true);
            new ToastNotification('autoStop');
            launchSysNotification('Recording Stopped!', 'Your desired recording time has expired and the recording has automatically stopped.');
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
    if (serRecorder?.port?.isOpen) {
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
            plot.resetPlot(spectrumData, cpsValues);
            bindPlotEvents();
        }
        else {
            plot.updatePlot(spectrumData, cpsValues);
        }
        const deltaLastRefresh = measTime - lastUpdate;
        lastUpdate = measTime;
        const cpsValue = ((SerialManager.orderType === 'chron') ? newData.length : newData.reduce((acc, curr) => acc + curr, 0)) / deltaLastRefresh * 1000;
        cpsValues.push(cpsValue);
        document.getElementById('cps').innerText = cpsValue.toFixed(1) + ' cps';
        const mean = cpsValues.reduce((acc, curr) => acc + curr, 0) / cpsValues.length;
        const std = Math.sqrt(cpsValues.reduce((acc, curr) => acc + (curr - mean) ** 2, 0) / (cpsValues.length - 1));
        document.getElementById('avg-cps').innerText = 'Avg: ' + mean.toFixed(1);
        document.getElementById('avg-cps-std').innerHTML = ` &plusmn; ${std.toFixed(1)} cps (&#916; ${Math.round(std / mean * 100)}%)`;
        updateSpectrumCounts();
        const finishDelta = performance.now() - startDelay;
        refreshTimeout = setTimeout(refreshRender, (refreshRate - finishDelta > 0) ? (refreshRate - finishDelta) : 1, type);
    }
}
//# sourceMappingURL=main.js.map