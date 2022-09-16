/*

  Gamma MCA: free, open-source web-MCA for gamma spectroscopy
  2022, NuclearPhoenix.- Phoenix1747
  https://nuclearphoenix.xyz

  ===============================

  Possible Future Improvements:
    - (?) Hotkey to open/close settings
    - (?) Add desktop notifications

    - Sorting isotope list
    - Social media share function
    - FWHM calculation for peaks
    - Serial console read capability
    - !!! Check Calibration Regression

    - Improve Mobile Layout
    - Support XML combi-file export

  Known Performance Issues:
    - (Un)Selecting all isotopes from gamma-ray energies list (Plotly)

*/

import './external/bootstrap.min.js';

import {SpectrumPlot} from './plot.js';
import {RawData} from './raw-data.js';
import {SerialData} from './serial.js';

export interface isotopeList {
  [key: number]: string | undefined;
};

interface portList {
  [key: number]: SerialPort | undefined;
};

type calType = 'a' | 'b' | 'c';
type dataType = 'data' | 'background';

export class SpectrumData { // Will hold the measurement data globally.
  data: number[] = [];
  background: number[] = [];
  dataCps: number[] = [];
  backgroundCps: number[] = [];

  getTotalCounts = (data: number[]) => {
    let sum = 0;
    data.forEach(item => {
      sum += item;
    });
    return sum;
  };
};

let spectrumData = new SpectrumData();
let plot = new SpectrumPlot('plot');
let raw = new RawData(1); // 2=raw, 1=hist
let ser = new SerialData();

let calClick = { a: false, b: false, c: false };
let oldCalVals = { a: '', b: '', c: ''};
let portsAvail: portList = {};

let serOptions = { baudRate: 9600 }; // Standard baud-rate of 9600 bps
let refreshRate = 1000; // Delay in ms between serial plot updates
let maxRecTimeEnabled = false;
let maxRecTime = 1800000; // 30 mins
const REFRESH_META_TIME = 100; // 100 ms

let cpsValues: number[] = [];

let isoListURL = 'assets/isotopes_energies_min.json';
let isoList: isotopeList = {};
let checkNearIso = false;
let maxDist = 100; // Max energy distance to highlight

const APP_VERSION = '2022-09-16';
let localStorageAvailable = false;
let firstInstall = false;

/*
  Startup of the page
*/
document.body.onload = async function(): Promise<void> {
  localStorageAvailable = 'localStorage' in self; // Test for localStorage, for old browsers

  if (localStorageAvailable) {
    loadSettingsStorage();
  }

  if ('serviceWorker' in navigator) { // Add service worker for PWA
    const reg = await navigator.serviceWorker.register('/service-worker.js'); // Onload async because of this... good? hmmm.

    if (localStorageAvailable) {
      reg.addEventListener('updatefound', () => {
          if (firstInstall) { // "Update" will always be installed on first load (service worker installation)
            return;
          }
        popupNotification('update-installed');
      });
    }
  }

  const isStandalone = window.matchMedia('(display-mode: standalone)').matches; // Detect PWA or browser
  if ('standalone' in window.navigator || isStandalone) { // Standalone PWA mode
    document.title += ' PWA';
  } else { // Default browser window
    document.getElementById('main')!.className = document.getElementById('main')!.className.replaceAll('pb-1', 'p-1');
    document.title += ' web application';
  }

  const domain = new URL(isoListURL, window.location.origin);
  isoListURL = domain.href;

  if ('serial' in navigator) { // Web Serial API
    document.getElementById('serial-div')!.className = ''; // Remove visually-hidden and invisible
    navigator.serial.addEventListener('connect', serialConnect);
    navigator.serial.addEventListener('disconnect', serialDisconnect);
    listSerial(); // List Available Serial Ports
  } else {
    const serError = document.getElementById('serial-error')!;
    serError.className = serError.className.replaceAll(' visually-hidden', '');

    const serSettingsElements = document.getElementsByClassName('ser-settings');
    for (const element of serSettingsElements) { // Disable serial settings
      (<HTMLSelectElement | HTMLButtonElement>element).disabled = true;
    }
    const serControlsElements = document.getElementsByClassName('serial-controls');
    for (const element of serControlsElements) { // Disable serial controls
      (<HTMLSelectElement | HTMLButtonElement>element).disabled = true;
    }
  }

  if ('launchQueue' in window && 'LaunchParams' in window) { // File Handling API
    (window as any).launchQueue.setConsumer(
      async (launchParams: { files: any[] }) => {
        if (!launchParams.files.length) {
          return;
        }
        const fileHandle = launchParams.files[0];
        const file: File = await fileHandle.getFile();

        const fileEnding = file.name.split('.')[1].toLowerCase();
        const spectrumEndings = ['csv', 'tka', 'xml', 'txt'];
        if (spectrumEndings.includes(fileEnding)) {
          getFileData(file);
        } else if (fileEnding === 'json') {
          importCal(file);
        }
        console.warn('File could not be imported!');
    });
  }

  plot.resetPlot(spectrumData);
  bindPlotEvents(); // Bind click and hover events provided by plotly

  document.getElementById('version-tag')!.innerText += ` ${APP_VERSION}.`;

  if (localStorageAvailable) {
    if (loadJSON('lastVisit') <= 0) {
      popupNotification('welcomeMsg');
      firstInstall = true;
    }
    const time = new Date();
    saveJSON('lastVisit', time.getTime());
    saveJSON('lastUsedVersion', APP_VERSION);

    const settingsNotSaveAlert = document.getElementById('ls-unavailable')!; // Remove saving alert
    settingsNotSaveAlert.parentNode!.removeChild(settingsNotSaveAlert);
  } else {
    const settingsSaveAlert = document.getElementById('ls-available')!; // Remove saving alert
    settingsSaveAlert.parentNode!.removeChild(settingsSaveAlert);
    popupNotification('welcomeMsg');
  }

  loadSettingsDefault();
  sizeCheck();

  const loadingSpinner = document.getElementById('loading')!;
  loadingSpinner.parentNode!.removeChild(loadingSpinner); // Delete Loading Thingymajig
};


// Exit website confirmation alert
window.onbeforeunload = (/*event*/) => {
  return 'Are you sure to leave?';
};


// Needed For Responsiveness! DO NOT REMOVE OR THE LAYOUT GOES TO SHIT!!!
document.body.onresize = () => {
  plot.updatePlot(spectrumData);
  //sizeCheck(); // Do not spam the size warning notification
};


// User changed from browser window to PWA (after installation) or backwards
window.matchMedia('(display-mode: standalone)').addEventListener('change', (/*event*/) => {
  /*
  let displayMode = 'browser';
  if (event.matches) {
    displayMode = 'standalone';
  }
  */
  window.location.reload(); // Just reload the page?
});


let deferredPrompt: any;

window.addEventListener('beforeinstallprompt', (event: Event) => {
  event.preventDefault(); // Prevent the mini-infobar from appearing on mobile
  deferredPrompt = event;

  if (localStorageAvailable) {
    if (!loadJSON('installPrompt')) {
      popupNotification('pwa-installer'); // Show notification on first visit
      saveJSON('installPrompt', true);
    }
  }

  const installButton = document.getElementById('manual-install')!;
  installButton.className = installButton.className.replaceAll('visually-hidden', '');
});


document.getElementById('install-pwa-btn')!.onclick = () => installPWA();
document.getElementById('install-pwa-toast-btn')!.onclick = () => installPWA();

async function installPWA() {
  //hideNotification('pwa-installer');
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
}


window.addEventListener('onappinstalled', () => {
  deferredPrompt = null;
  hideNotification('pwa-installer');
  document.getElementById('manual-install')!.className += 'visually-hidden';
});

/*
document.onkeydown = async function(event) {
  console.log(event.keyCode);
  if (event.keyCode === 27) { // ESC
    const offcanvasElement = document.getElementById('offcanvas');
    const offcanvas = new bootstrap.Offcanvas(offcanvasElement);

    //event.preventDefault();

    await offcanvas.toggle();
  }
};
*/
document.getElementById('data')!.onclick = event => {(<HTMLInputElement>event.target).value = ''};
document.getElementById('background')!.onclick = event => {(<HTMLInputElement>event.target).value = ''};

document.getElementById('data')!.onchange = event => importFile(<HTMLInputElement>event.target);
document.getElementById('background')!.onchange = event => importFile(<HTMLInputElement>event.target, true);

function importFile(input: HTMLInputElement, background = false): void {
  if (input.files === null || input.files.length === 0) { // File selection has been canceled
    return;
  }
  getFileData(input.files[0], background);
}


function getFileData(file: File, background = false): void { // Gets called when a file has been selected.
  let reader = new FileReader();

  const fileEnding = file.name.split('.')[1];

  reader.readAsText(file);

  reader.onload = () => {
    const result = (<string>reader.result).trim(); // A bit unclean for typescript, I'm sorry

    if (fileEnding.toLowerCase() === 'xml') {
      if (window.DOMParser) {
        const {espectrum, bgspectrum, coeff} = raw.xmlToArray(result);

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

          for (const element of document.getElementsByClassName('cal-setting')) {
            const changeType = <HTMLInputElement>element;
            changeType.disabled = true;
          }

          addImportLabel();
        }

      } else {
        console.error('No DOM parser in this browser!');
      }
    } else if (background) {
      spectrumData.background = raw.csvToArray(result);
    } else {
      spectrumData.data = raw.csvToArray(result);
    }

    const sCounts = spectrumData.getTotalCounts(spectrumData.data);
    const bgCounts = spectrumData.getTotalCounts(spectrumData.background);
    document.getElementById('total-spec-cts')!.innerText = sCounts.toString();
    document.getElementById('total-bg-cts')!.innerText = bgCounts.toString();

    const dataLabel = document.getElementById('data-icon')!;
    const bgLabel = document.getElementById('background-icon')!;

    if (sCounts > 0) {
      dataLabel.className = dataLabel.className.replaceAll(' visually-hidden', '');
    }
    if (bgCounts > 0) {
      bgLabel.className = bgLabel.className.replaceAll(' visually-hidden', '');
    }

    /*
      Error Msg Problem with RAW Stream selection?
    */
    if (!(spectrumData.background.length === spectrumData.data.length || spectrumData.data.length === 0 || spectrumData.background.length === 0)) {
      popupNotification('data-error');
      if (background) { // Remove file again
        removeFile('background');
      } else {
        removeFile('data');
      }
    }

    plot.plotData(spectrumData, false);
    bindPlotEvents(); // needed, because of "false" above
  };

  reader.onerror = () => {
    popupNotification('file-error');
    return;
  };
}


function sizeCheck(): void {
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = document.documentElement.clientHeight;
  if (viewportWidth < 1250 || viewportHeight < 750) {
    popupNotification('screen-size-warning');
  } else {
    hideNotification('screen-size-warning');
  }
}


document.getElementById('clear-data')!.onclick = () => removeFile('data');
document.getElementById('clear-bg')!.onclick = () => removeFile('background');

function removeFile(id: dataType): void {
  spectrumData[id] = [];
  (<HTMLInputElement>document.getElementById(id)).value = '';
  plot.resetPlot(spectrumData);

  document.getElementById('total-spec-cts')!.innerText = spectrumData.getTotalCounts(spectrumData.data).toString();
  document.getElementById('total-bg-cts')!.innerText = spectrumData.getTotalCounts(spectrumData.background).toString();

  const dataLabel = document.getElementById(id + '-icon')!;
  dataLabel.className += ' visually-hidden';

  bindPlotEvents(); // Re-Bind Events for new plot
}


const IMPORT_STRING = ': imported';

function addImportLabel() {
  const titleElement = document.getElementById('calibration-title')!;

  if (!titleElement.innerText.includes(IMPORT_STRING)) {
    titleElement.innerText += IMPORT_STRING;
  }
}


function bindPlotEvents(): void {
  const myPlot = <any>document.getElementById(plot.divId); // Using Plotly on functions
  myPlot.on('plotly_hover', hoverEvent);
  myPlot.on('plotly_unhover', unHover);
  myPlot.on('plotly_click', clickEvent);
}


document.getElementById('r1')!.onchange = event => selectFileType(<HTMLInputElement>event.target);
document.getElementById('r2')!.onchange = event => selectFileType(<HTMLInputElement>event.target);

function selectFileType(button: HTMLInputElement): void {
  raw.fileType = parseInt(button.value);
  raw.valueIndex = parseInt(button.value);
}


document.getElementById('reset-plot')!.onclick = () => resetPlot();

function resetPlot(): void {
  if (plot.xAxis === 'log'){
    changeAxis(<HTMLButtonElement>document.getElementById('xAxis'));
  }
  if (plot.yAxis === 'log'){
    changeAxis(<HTMLButtonElement>document.getElementById('yAxis'));
  }
  if(plot.sma) {
    toggleSma(false, <HTMLInputElement>document.getElementById('sma'));
  }
  plot.clearAnnos();
  (<HTMLInputElement>document.getElementById('check-all-isos')).checked = false; // reset "select all" checkbox
  loadIsotopes(true);
  plot.resetPlot(spectrumData);
  bindPlotEvents(); // Fix Reset Bug: Hovering and Clicking not working.
}


document.getElementById('xAxis')!.onclick = event => changeAxis(<HTMLButtonElement>event.target);
document.getElementById('yAxis')!.onclick = event => changeAxis(<HTMLButtonElement>event.target);

function changeAxis(button: HTMLButtonElement): void {
  let id = button.id as 'xAxis' | 'yAxis';
  if (plot[id] === 'linear') {
    plot[id] = 'log';
    button.innerText = 'Log';
  } else {
    plot[id] = 'linear';
    button.innerText = 'Linear';
  }
  plot.updatePlot(spectrumData);
}


// Do this by classes? Way more efficient, v e r y ugly!
document.getElementById('smaVal')!.onkeydown = event => enterPress(event, 'sma');
document.getElementById('ser-command')!.onkeydown = event => enterPress(event, 'send-command');
document.getElementById('iso-hover-prox')!.onkeydown = event => enterPress(event, 'setting1');
document.getElementById('custom-url')!.onkeydown = event => enterPress(event, 'setting2');
document.getElementById('custom-delimiter')!.onkeydown = event => enterPress(event, 'setting3');
document.getElementById('custom-file-adc')!.onkeydown = event => enterPress(event, 'setting4');
document.getElementById('custom-baud')!.onkeydown = event => enterPress(event, 'setting5');
document.getElementById('eol-char')!.onkeydown = event => enterPress(event, 'setting5-1');
document.getElementById('ser-limit')!.onkeydown = event => enterPress(event, 'ser-limit-btn');
document.getElementById('custom-ser-refresh')!.onkeydown = event => enterPress(event, 'setting6');
document.getElementById('custom-ser-buffer')!.onkeydown = event => enterPress(event, 'setting7');
document.getElementById('custom-ser-adc')!.onkeydown = event => enterPress(event, 'setting8');
document.getElementById('peak-thres')!.onkeydown = event => enterPress(event, 'setting9');
document.getElementById('peak-lag')!.onkeydown = event => enterPress(event, 'setting10');
document.getElementById('peak-width')!.onkeydown = event => enterPress(event, 'setting11');
document.getElementById('seek-width')!.onkeydown = event => enterPress(event, 'setting12');

function enterPress(event: KeyboardEvent, id: string): void {
  if (event.key === 'Enter') { // ENTER key
    const button = document.getElementById(id);
    button?.click();
  }
}


document.getElementById('sma')!.onclick = event => toggleSma((<HTMLInputElement>event.target).checked);

function toggleSma(value: boolean, thisValue: HTMLInputElement | null = null ): void {
  plot.sma = value;
  if (thisValue !== null) {
    thisValue.checked = false;
  }
  plot.updatePlot(spectrumData);
}


document.getElementById('smaVal')!.oninput = event => changeSma(<HTMLInputElement>event.target);

function changeSma(input: HTMLInputElement): void {
  const parsedInput = parseInt(input.value);
  if (isNaN(parsedInput)) {
    popupNotification('sma-error');
  } else {
    plot.smaLength = parsedInput;
    plot.updatePlot(spectrumData);
    saveJSON('smaLength', parsedInput);
  }
}


function hoverEvent(data: any): void {
  const hoverData = document.getElementById('hover-data')!;
  hoverData.innerText = data.points[0].x.toFixed(2) + data.points[0].xaxis.ticksuffix + ': ' + data.points[0].y.toFixed(2) + data.points[0].yaxis.ticksuffix;

  for (const key in calClick) {
    const castKey = <calType>key;
    if (calClick[castKey]) {
      (<HTMLInputElement>document.getElementById(`adc-${castKey}`)).value = data.points[0].x.toFixed(2);
    }
  }

  if (checkNearIso) {
    closestIso(data.points[0].x);
  }
}


function unHover(/*data: any*/): void {
  const hoverData = document.getElementById('hover-data')!;
  hoverData.innerText = 'None';

  for (const key in calClick) {
    const castKey = <calType>key;
    if (calClick[castKey]) {
      (<HTMLInputElement>document.getElementById(`adc-${castKey}`)).value = oldCalVals[castKey];
    }
  }

  /*
  if (Object.keys(prevIso).length > 0) {
    closestIso(-maxDist); // Force Reset Iso Highlighting
  }
  */
}


function clickEvent(data: any): void {
  const clickData = document.getElementById('click-data')!;
  clickData.innerText = data.points[0].x.toFixed(2) + data.points[0].xaxis.ticksuffix + ': ' + data.points[0].y.toFixed(2) + data.points[0].yaxis.ticksuffix;

  for (const key in calClick) {
    const castKey = <calType>key;
    if (calClick[castKey]) {
      (<HTMLInputElement>document.getElementById(`adc-${castKey}`)).value = data.points[0].x.toFixed(2);
      oldCalVals[castKey] = data.points[0].x.toFixed(2);
      calClick[castKey] = false;
      (<HTMLInputElement>document.getElementById(`select-${castKey}`)).checked = calClick[<calType>key];
    }
  }
}


document.getElementById('apply-cal')!.onclick = event => toggleCal((<HTMLInputElement>event.target).checked);

function toggleCal(enabled: boolean): void {
  const button = document.getElementById('calibration-label')!;

  if (enabled) {
    button.innerHTML = '<i class="fa-solid fa-rotate-left"></i> Reset';
  } else {
    button.innerHTML = '<i class="fa-solid fa-check"></i> Calibrate';
  }
  /*
    Reset Plot beforehand, to prevent x-range from dying when zoomed?
  */
  if (enabled) {
    if (!plot.calibration.imported) {

      let readoutArray = [
        [(<HTMLInputElement>document.getElementById('adc-a')).value, (<HTMLInputElement>document.getElementById('cal-a')).value],
        [(<HTMLInputElement>document.getElementById('adc-b')).value, (<HTMLInputElement>document.getElementById('cal-b')).value],
        [(<HTMLInputElement>document.getElementById('adc-c')).value, (<HTMLInputElement>document.getElementById('cal-c')).value]
      ];

      let invalid = 0;
      let validArray: number[][] = [];

      for (const pair of readoutArray) {
        const float1 = parseFloat(pair[0]);
        const float2 = parseFloat(pair[1]);

        if (isNaN(float1) || isNaN(float2)) {
          //validArray.push([-1, -1]);
          invalid += 1;
        } else {
          validArray.push([float1, float2]);
        }
        if (invalid > 1) {
          popupNotification('cal-error');
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
  document.getElementById('c1-coeff')!.innerText = plot.calibration.coeff.c1.toString();
  document.getElementById('c2-coeff')!.innerText = plot.calibration.coeff.c2.toString();
  document.getElementById('c3-coeff')!.innerText = plot.calibration.coeff.c3.toString();

  plot.calibration.enabled = enabled;
  plot.plotData(spectrumData, false);
  bindPlotEvents(); // needed, because of "false" above
}


document.getElementById('calibration-reset')!.onclick = () => resetCal();

function resetCal(): void {
  for (const point in calClick) {
    calClick[<calType>point] = false;
  }

  for (const element of document.getElementsByClassName('cal-setting')) {
    const changeType = <HTMLInputElement>element;
    changeType.disabled = false;
  }
  const titleElement = document.getElementById('calibration-title')!;
  titleElement.innerText = titleElement.innerText.replaceAll(IMPORT_STRING, '');

  plot.clearCalibration();
  toggleCal(false);
}


// Pretty ugly, but will get changed when implementing the n-poly calibration
document.getElementById('select-a')!.onclick = event => toggleCalClick('a', (<HTMLInputElement>event.target).checked);
document.getElementById('select-b')!.onclick = event => toggleCalClick('b', (<HTMLInputElement>event.target).checked);
document.getElementById('select-c')!.onclick = event => toggleCalClick('c', (<HTMLInputElement>event.target).checked);

function toggleCalClick(point: calType, value: boolean): void {
  calClick[point] = value;
}


document.getElementById('plotType')!.onclick = () => changeType(<HTMLButtonElement>document.getElementById('plotType'));

function changeType(button: HTMLButtonElement): void {
  if (plot.plotType === 'scatter') {
    button.innerHTML = '<i class="fas fa-chart-bar"></i> Bar';
    plot.plotType = 'bar';
  } else {
    button.innerHTML = '<i class="fas fa-chart-line"></i> Line';
    plot.plotType = 'scatter';
  }
  plot.updatePlot(spectrumData);
}


document.getElementById('cal-input')!.onchange = event => importCalButton(<HTMLInputElement>event.target);

function importCalButton(input: HTMLInputElement): void {
  if (input.files === null || input.files.length === 0) { // File selection has been canceled
    return;
  }
  importCal(input.files[0]);
}


function importCal(file: File): void {
  let reader = new FileReader();

  reader.readAsText(file);

  reader.onload = () => {
    try {
      const result = (<string>reader.result).trim(); // A bit unclean for typescript, I'm sorry
      const obj = JSON.parse(result);

      let readoutArray = [
        <HTMLInputElement>document.getElementById('adc-a'),
        <HTMLInputElement>document.getElementById('cal-a'),
        <HTMLInputElement>document.getElementById('adc-b'),
        <HTMLInputElement>document.getElementById('cal-b'),
        <HTMLInputElement>document.getElementById('adc-c'),
        <HTMLInputElement>document.getElementById('cal-c')
      ];


      if (obj.imported) {

        for (const element of document.getElementsByClassName('cal-setting')) {
          const changeType = <HTMLInputElement>element;
          changeType.disabled = true;
        }

        addImportLabel();

        plot.calibration.coeff = obj.coeff;
        plot.calibration.imported = true;

      } else {

        const inputArr = ['aFrom', 'aTo', 'bFrom', 'bTo', 'cFrom', 'cTo'];
        for (const index in inputArr) {
          if (obj.points === undefined || typeof obj.points === 'number') { // Keep compatability with old calibration files
            readoutArray[index].value = obj[inputArr[index]];
          } else { // New calibration files
            const value: number = obj.points[inputArr[index]];
            if (value === -1) {
              readoutArray[index].value = '';
            } else {
              readoutArray[index].value = obj.points[inputArr[index]];
            }
          }
        }

        oldCalVals.a = readoutArray[0].value;
        oldCalVals.b = readoutArray[2].value;
        oldCalVals.c = readoutArray[4].value;
      }

    } catch(e) {
      console.error('Calibration Import Error:', e);
      popupNotification('cal-import-error');
    }
  };

  reader.onerror = () => {
    popupNotification('file-error');
    return;
  };
}


function addLeadingZero(number: string): string {
  if (parseFloat(number) < 10) {
    return '0' + number;
  } else {
    return number;
  }
}


function getDateString(): string {
  const time = new Date();
  return time.getFullYear() + addLeadingZero((time.getMonth() + 1).toString()) + addLeadingZero(time.getDate().toString()) + addLeadingZero(time.getHours().toString()) + addLeadingZero(time.getMinutes().toString());
}


document.getElementById('calibration-download')!.onclick = () => downloadCal();

function downloadCal(): void {
  const filename = `calibration_${getDateString()}.json`;
  download(filename, JSON.stringify(plot.calibration));
}


document.getElementById('download-spectrum-btn')!.onclick = () => downloadData('spectrum', 'data');
document.getElementById('download-bg-btn')!.onclick = () => downloadData('background', 'background');

function downloadData(filename: string, data: dataType): void {
  filename += `_${getDateString()}.csv`;

  let text = '';
  spectrumData[data].forEach(item => text += item + '\n');

  download(filename, text);
}


function download(filename: string, text: string): void {
    let element = document.createElement('a');
    element.setAttribute('href', `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`);

    element.setAttribute('download', filename);

    element.style.display = 'none';
    document.body.appendChild(element);

    element.click();

    document.body.removeChild(element);
}


document.getElementById('show-coefficients')!.onclick = () => popupNotification('coefficients');

function popupNotification(id: string): void {
  // Uses Bootstrap Toasts already defined in HTML
  const element = document.getElementById(id);
  // @ts-ignore // Works just fine without TS complaining
  const toast = new bootstrap.Toast(element);
  toast.show();
}


function hideNotification(id: string): void {
  const element = document.getElementById(id);
  // @ts-ignore // Works just fine without TS complaining
  const toast = new bootstrap.Toast(element);
  toast.hide();
}


document.getElementById('toggle-menu')!.onclick = () => loadIsotopes();

let loadedIsos = false;

async function loadIsotopes(reload = false): Promise<Boolean> { // Load Isotope Energies JSON ONCE
  if (loadedIsos && !reload) { // Isotopes already loaded
    return true;
  }

  const loadingElement = document.getElementById('iso-loading')!;
  loadingElement.className = loadingElement.className.replaceAll(' visually-hidden', '');

  const options: RequestInit = {
    cache: 'no-cache',
    headers: {
      'Content-Type': 'text/plain; application/json; charset=UTF-8',
    },
  };

  const isoError = document.getElementById('iso-load-error')!;
  //isoError.innerText = ''; // Remove any old error msges
  isoError.className += ' visually-hidden'; // Hide any old errors
  let successFlag = true; // Ideally no errors

  try {
    let response = await fetch(isoListURL, options);

    if (response.ok) { // If HTTP-status is 200-299
      const json = await response.json();
      loadedIsos = true;

      const tableElement = <HTMLTableElement>document.getElementById('iso-table');
      tableElement.innerHTML = ''; // Delete old table
      plot.clearAnnos(); // Delete all isotope lines
      plot.updatePlot(spectrumData);

      let intKeys = Object.keys(json);
      intKeys.sort((a, b) => parseFloat(a) - parseFloat(b)); // Sort Energies numerically

      let index = 0; // Index used to avoid HTML id duplicates

      for (const key of intKeys) {
        index++;
        isoList[parseFloat(key)] = json[key];

        const row = tableElement.insertRow();
        const cell1 = row.insertCell(0);
        const cell2 = row.insertCell(1);
        const cell3 = row.insertCell(2);

        cell1.onclick = () => (<HTMLInputElement>cell1.firstChild).click();
        cell2.onclick = () => (<HTMLInputElement>cell1.firstChild).click();
        cell3.onclick = () => (<HTMLInputElement>cell1.firstChild).click();

        cell1.style.cursor = 'pointer'; // Change cursor pointer to "click-ready"
        cell2.style.cursor = 'pointer';
        cell3.style.cursor = 'pointer';

        const energy = parseFloat(key.trim());
        const dirtyName: string = json[key].toLowerCase();
        const lowercaseName = dirtyName.replace(/[^a-z0-9 -]/gi, '').trim(); // Fixes security issue. Clean everything except for letters, numbers and minus. See GitHub: #2
        const name = lowercaseName.charAt(0).toUpperCase() + lowercaseName.slice(1) + '-' + index; // Capitalize Name and append index number

        cell1.innerHTML = `<input class="form-check-input iso-table-label" id="${name}" type="checkbox" value="${energy}">`;
        cell3.innerHTML = `<span class="iso-table-label">${energy.toFixed(2)}</span>`; //`<label for="${name}">${energy.toFixed(2)}</label>`;

        const clickBox = <HTMLInputElement>document.getElementById(name);
        clickBox.onclick = () => plotIsotope(clickBox);

        const strArr = name.split('-');

        cell2.innerHTML = `<span class="iso-table-label"><sup>${strArr[1]}</sup>${strArr[0]}</span>`; //`<label for="${name}"><sup>${strArr[1]}</sup>${strArr[0]}</label>`;
      }
      plot.isoList = isoList; // Copy list to plot object
    } else {
      isoError.innerText = `Could not load isotope list! HTTP Error: ${response.status}. Please try again.`;
      isoError.className = isoError.className.replaceAll(' visually-hidden', '');
      successFlag = false;
    }
  } catch (err) { // No network connection!
    isoError.innerText = 'Could not load isotope list! Connection refused - you are probably offline.';
    isoError.className = isoError.className.replaceAll(' visually-hidden', '');
    successFlag = false;
  }

  loadingElement.className += ' visually-hidden';
  return successFlag;
}


document.getElementById('reload-isos-btn')!.onclick = () => reloadIsotopes();

function reloadIsotopes(): void {
  //loadedIsos = false;
  loadIsotopes(true);
}


function seekClosest(value: number): {energy: number, name: string} | {energy: undefined, name: undefined} {
  const closeVals = Object.keys(isoList).filter(energy => { // Only allow closest values and disregard undefined
    if (energy) {
      return Math.abs(parseFloat(energy) - value) <= maxDist;
    }
    return false;
  });
  const closeValsNum = closeVals.map(energy => parseFloat(energy)) // After this step there are 100% only numbers left

  if (closeValsNum.length > 0) {
    const closest = closeValsNum.reduce((prev, curr) => Math.abs(curr - value) < Math.abs(prev - value) ? curr : prev);
    const name = isoList[closest]!; // closest will always be somewhere in isoList with a key, because we got it from there!

    return {energy: closest, name: name};
  } else {
    return {energy: undefined, name: undefined};
  }
}


document.getElementById('iso-hover')!.onclick = () => toggleIsoHover();

let prevIso: isotopeList = {};

function toggleIsoHover(): void {
  checkNearIso = !checkNearIso;
  closestIso(-100000);
}


async function closestIso(value: number): Promise<void> {
  if(!await loadIsotopes()) { // User has not yet opened the settings panel
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
    let newIso: isotopeList = {};
    newIso[energy] = name;

    if (prevIso !== newIso) {
      prevIso = newIso;
    }

    plot.toggleLine(energy, name);
  }
  plot.updatePlot(spectrumData);
}


function plotIsotope(checkbox: HTMLInputElement): void {
  const wordArray = checkbox.id.split('-');
  const name = wordArray[0] + '-' + wordArray[1];
  plot.toggleLine(parseFloat(checkbox.value), name, checkbox.checked);
  plot.updatePlot(spectrumData);
}


document.getElementById('check-all-isos')!.onclick = (event) => selectAll(<HTMLInputElement>event.target);

function selectAll(selectBox: HTMLInputElement): void {
  // Bad performance mostly because of the updatePlot with that many lines!
  const tableElement = <HTMLTableElement>document.getElementById('table'); //selectBox.closest('table');
  const tableBody = tableElement.tBodies[0];
  const tableRows = tableBody.rows;

  for (const row of tableRows) {
    const checkBox = <HTMLInputElement>row.cells[0].firstChild;
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


document.getElementById('peak-finder-btn')!.onclick = event => findPeaks(<HTMLButtonElement>event.target);

async function findPeaks(button: HTMLButtonElement): Promise<void> {
  if (plot.peakConfig.enabled) {
    if (plot.peakConfig.mode === 0) {
      //plot.peakFinder(false); // Delete all old lines
      await loadIsotopes();
      plot.peakConfig.mode++;
      button.innerText = 'Isotope';
    } else {
      plot.peakFinder(false); // Delete all old lines
      plot.peakConfig.enabled = false;
      button.innerText = 'None';
    }
  } else {
    plot.peakConfig.enabled = true;
    plot.peakConfig.mode = 0;
    button.innerText = 'Energy';
  }

  plot.updatePlot(spectrumData);
}

/*
=========================================
  LOADING AND SAVING
=========================================
*/

function saveJSON(name: string, value: string | boolean | number): void {
  localStorage.setItem(name, JSON.stringify(value));
}


function loadJSON(name: string): any {
  return JSON.parse(<string>localStorage.getItem(name));
}


function loadSettingsDefault(): void {
  (<HTMLInputElement>document.getElementById('custom-url')).value = isoListURL;
  (<HTMLInputElement>document.getElementById('edit-plot')).checked = plot.editableMode;
  (<HTMLInputElement>document.getElementById('custom-delimiter')).value = raw.delimiter;
  (<HTMLInputElement>document.getElementById('custom-file-adc')).value = raw.adcChannels.toString();
  (<HTMLInputElement>document.getElementById('custom-ser-refresh')).value = (refreshRate / 1000).toString(); // convert ms to s
  (<HTMLInputElement>document.getElementById('custom-ser-buffer')).value = ser.maxSize.toString();
  (<HTMLInputElement>document.getElementById('custom-ser-adc')).value = ser.adcChannels.toString();
  const autoStop = <HTMLInputElement>document.getElementById('ser-limit');
  autoStop.value = (maxRecTime / 1000).toString(); // convert ms to s
  autoStop.disabled = !maxRecTimeEnabled;
  (<HTMLInputElement>document.getElementById('ser-limit-btn')).disabled = !maxRecTimeEnabled;
  (<HTMLInputElement>document.getElementById('toggle-time-limit')).checked = maxRecTimeEnabled;
  (<HTMLInputElement>document.getElementById('iso-hover-prox')).value = maxDist.toString();
  (<HTMLInputElement>document.getElementById('custom-baud')).value = serOptions.baudRate.toString();
  (<HTMLInputElement>document.getElementById('eol-char')).value = ser.eolChar;

  (<HTMLInputElement>document.getElementById('smaVal')).value = plot.smaLength.toString();

  (<HTMLInputElement>document.getElementById('peak-thres')).value = plot.peakConfig.thres.toString();
  (<HTMLInputElement>document.getElementById('peak-lag')).value = plot.peakConfig.lag.toString();
  (<HTMLInputElement>document.getElementById('peak-width')).value = plot.peakConfig.width.toString();
  (<HTMLInputElement>document.getElementById('seek-width')).value = plot.peakConfig.seekWidth.toString();

  const formatSelector = <HTMLSelectElement>document.getElementById('download-format');
  for (let i = 0; i < formatSelector.options.length; i++) {
    if (formatSelector.options[i].value === plot.downloadFormat) {
      formatSelector.selectedIndex = i;
    }
  }
}


function loadSettingsStorage(): void {
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


// Do this by classes? Way more efficient, v e r y ugly!
document.getElementById('edit-plot')!.onclick = event => changeSettings('editMode', <HTMLInputElement>event.target);
document.getElementById('setting1')!.onclick = () => changeSettings('maxIsoDist', <HTMLInputElement>document.getElementById('iso-hover-prox'));
document.getElementById('setting2')!.onclick = () => changeSettings('customURL', <HTMLInputElement>document.getElementById('custom-url'));
document.getElementById('download-format')!.onchange = event => changeSettings('plotDownload', <HTMLSelectElement>event.target);
document.getElementById('setting3')!.onclick = () => changeSettings('fileDelimiter', <HTMLInputElement>document.getElementById('custom-delimiter'));
document.getElementById('setting4')!.onclick = () => changeSettings('fileChannels', <HTMLInputElement>document.getElementById('custom-file-adc'));
document.getElementById('setting5')!.onclick = () => changeSettings('baudRate', <HTMLInputElement>document.getElementById('custom-baud'));
document.getElementById('setting5-1')!.onclick = () => changeSettings('eolChar', <HTMLInputElement>document.getElementById('eol-char'));
document.getElementById('toggle-time-limit')!.onclick = event => changeSettings('timeLimitBool', <HTMLInputElement>event.target);
document.getElementById('ser-limit-btn')!.onclick = () => changeSettings('timeLimit', <HTMLInputElement>document.getElementById('ser-limit'));
document.getElementById('setting6')!.onclick = () => changeSettings('plotRefreshRate', <HTMLInputElement>document.getElementById('custom-ser-refresh'));
document.getElementById('setting7')!.onclick = () => changeSettings('serBufferSize', <HTMLInputElement>document.getElementById('custom-ser-buffer'));
document.getElementById('setting8')!.onclick = () => changeSettings('serChannels', <HTMLInputElement>document.getElementById('custom-ser-adc'));
document.getElementById('setting9')!.onclick = () => changeSettings('peakThres', <HTMLInputElement>document.getElementById('peak-thres'));
document.getElementById('setting10')!.onclick = () => changeSettings('peakLag', <HTMLInputElement>document.getElementById('peak-lag'));
document.getElementById('setting11')!.onclick = () => changeSettings('peakWidth', <HTMLInputElement>document.getElementById('peak-width'));
document.getElementById('setting12')!.onclick = () => changeSettings('seekWidth', <HTMLInputElement>document.getElementById('seek-width'));

function changeSettings(name: string, element: HTMLInputElement | HTMLSelectElement): void {
  if (!element.checkValidity()) {
    popupNotification('setting-type');
    return;
  }

  const value = element.value;
  let boolVal: boolean;
  let numVal: number;

  switch (name) {
    case 'editMode':
      boolVal = (<HTMLInputElement>element).checked;
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

      } catch(e) {
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
      boolVal = (<HTMLInputElement>element).checked;
      (<HTMLInputElement>document.getElementById('ser-limit')).disabled = !boolVal;
      (<HTMLButtonElement>document.getElementById('ser-limit-btn')).disabled = !boolVal;

      maxRecTimeEnabled = boolVal;

      if (localStorageAvailable) {
        saveJSON(name, boolVal);
      }
      break;

    case 'timeLimit':
      numVal = parseFloat(value);
      maxRecTime = numVal * 1000; // convert s to ms

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
      refreshRate = numVal * 1000; // convert s to ms

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
  popupNotification('setting-success'); // Success Toast
}


document.getElementById('reset-gamma-mca')!.onclick = () => resetMCA();

function resetMCA(): void {
  if (localStorageAvailable) {
    localStorage.clear();
  }
  window.location.reload();
}

/*
=========================================
  SERIAL DATA
=========================================
*/

function serialConnect(/*event: Event*/) {
  listSerial();
  popupNotification('serial-connect');
};


function serialDisconnect(event: Event): void {
  for (const key in portsAvail) {
    if (portsAvail[key] == event.target) { // Maybe use a strict === ?
      delete portsAvail[key];
      break;
    }
  }
  if (event.target === ser.port) {
    disconnectPort(true);
  }

  listSerial();

  popupNotification('serial-disconnect');
};


document.getElementById('serial-list-btn')!.onclick = () => listSerial();

async function listSerial(): Promise<void> {
  const portSelector = <HTMLSelectElement>document.getElementById('port-selector');
  for (const index in portSelector.options) { // Remove all "old" ports
    portSelector.remove(parseInt(index));
  }

  const ports = await navigator.serial.getPorts();

  for (const index in ports) { // List new Ports
    portsAvail[index] = ports[index];

    const option = document.createElement('option');
    const usbId = ports[index].getInfo().usbProductId;

    option.text = `Port ${index} (Id: 0x${usbId?.toString(16)})`;

    portSelector.add(option, parseInt(index));
  }

  const serSettingsElements = document.getElementsByClassName('ser-settings') as HTMLCollectionOf<HTMLInputElement> | HTMLCollectionOf<HTMLSelectElement>;

  if (ports.length === 0) {
    const option = document.createElement('option');
    option.text = 'No Ports Available';
    portSelector.add(option);

    for (const element of serSettingsElements) {
      element.disabled = true;
    }
  } else {
    for (const element of serSettingsElements) {
      element.disabled = false;
    }
  }
}


document.getElementById('serial-add-device')!.onclick = () => requestSerial();

async function requestSerial(): Promise<void> {
  try {
    const port = await navigator.serial.requestPort();

    if (Object.keys(portsAvail).length === 0) {
      portsAvail[0] = port;
    } else {
      const intKeys = Object.keys(portsAvail).map(value => parseInt(value));
      const max = Math.max(...intKeys);
      portsAvail[max + 1] = port; // Put new port in max+1 index  to get a new, unused number
    }
    listSerial();
  } catch(err) {
    console.warn('Aborted adding a new port!', err); // Do nothing.
  }
}


document.getElementById('plot-cps')!.onclick = event => toggleCps(<HTMLButtonElement>event.target);

function toggleCps(button: HTMLButtonElement, off = false): void {
  if (off) { // Override
    plot.cps = false;
  } else {
    plot.cps = !plot.cps;
  }

  if (plot.cps) {
    button.innerText = 'CPS';
  } else {
    button.innerText = 'Total';
  }
  plot.updatePlot(spectrumData);
}


async function selectPort(): Promise<void> {
  const selector = <HTMLSelectElement>document.getElementById('port-selector');
  const index = selector.selectedIndex;
  ser.port = portsAvail[index];
}


let keepReading = false;
let reader: ReadableStreamDefaultReader | undefined;
let recordingType: dataType;
let startTime = 0;
let timeDone = 0;

async function readUntilClosed(): Promise<void> {
  while (ser.port?.readable && keepReading) {
    try {
      reader = ser.port.readable.getReader();

      while (true) {
        const {value, done} = await reader.read();
        if (value) {
          // value is a Uint8Array.
          ser.addRaw(value);
        }
        if (done) {
          // reader.cancel() has been called.
          break;
        }
      }
    } catch (err) {
      // Sudden device disconnect can cause this
      console.error('Misc Serial Read Error:', err);
      popupNotification('misc-ser-error');
    } finally {
      // Allow the serial port to be closed later.
      reader?.releaseLock();
      reader = undefined;
    }
  }

  await ser.port?.close();
}


document.getElementById('resume-button')!.onclick = () => startRecord(true);
document.getElementById('record-spectrum-btn')!.onclick = () => startRecord(false, 'data');
document.getElementById('record-bg-btn')!.onclick = () => startRecord(false, 'background');

let closed: Promise<void>;
let firstLoad = false;

async function startRecord(pause = false, type = <dataType>recordingType): Promise<void> {
  try {
    selectPort();

    if (ser.port === undefined) {
      throw 'Port is undefined! This should not be happening.';
    }

    await ser.port.open(serOptions); // Baud-Rate optional

    keepReading = true; // Reset keepReading
    recordingType = type;

    if (!pause) {
      removeFile(recordingType); // Remove old spectrum
      firstLoad = true;
    }

    (<HTMLButtonElement>document.getElementById('export-button')).disabled = false;
    (<HTMLButtonElement>document.getElementById('stop-button')).disabled = false;
    document.getElementById('pause-button')!.className = document.getElementById('pause-button')!.className.replaceAll(' visually-hidden','');
    document.getElementById('record-button')!.className += ' visually-hidden';
    document.getElementById('resume-button')!.className += ' visually-hidden';
    document.getElementById('recording-spinner')!.className = document.getElementById('recording-spinner')!.className.replaceAll(' visually-hidden','');

    const timer = new Date();
    startTime = timer.getTime();

    refreshRender(recordingType); // Start updating the plot
    refreshMeta(recordingType); // Start updating the meta data

    if (pause) {
      cpsValues.pop(); // Last cps value after pausing is always 0, remove.
    } else {
      cpsValues.shift(); // First cps value is always a zero, so remove that.
    }

    closed = readUntilClosed();
  } catch(err) {
    console.error('Connection Error:', err);
    popupNotification('serial-connect-error');
  }
}


document.getElementById('send-command')!.onclick = () => sendSerial((<HTMLInputElement>document.getElementById('ser-command')).value);

async function sendSerial(command: string): Promise<void> {
  const wasReading = keepReading;

  try {
    if (wasReading) {
      await disconnectPort();
    }

    selectPort();

    if (ser.port === undefined) {
      throw 'Port is undefined! This should not be happening.';
    }

    await ser.port.open(serOptions); // Baud-Rate optional

    const textEncoder = new TextEncoderStream();
    const writer = textEncoder.writable.getWriter();
    const writableStreamClosed = textEncoder.readable.pipeTo(ser.port.writable);

    let formatCommand = command.trim() + '\n';

    writer.write(formatCommand);
    //writer.write('\x03\n');

    //writer.releaseLock();
    await writer.close();
    await writableStreamClosed;

    document.getElementById('ser-output')!.innerText += '> ' + formatCommand.trim() + '\n';
    (<HTMLInputElement>document.getElementById('ser-command')).value = '';

  } catch (err) {
    console.error('Connection Error:', err);
    popupNotification('serial-connect-error');
  } finally {

    await ser.port?.close();

    if (wasReading) {
      startRecord(true);
    }

  }
}


document.getElementById('pause-button')!.onclick = () => disconnectPort();
document.getElementById('stop-button')!.onclick = () => disconnectPort(true);

async function disconnectPort(stop = false): Promise<void> {
  const nowTime = new Date();
  timeDone += nowTime.getTime() - startTime;

  document.getElementById('pause-button')!.className += ' visually-hidden';
  document.getElementById('recording-spinner')!.className += ' visually-hidden';

  if (stop) {
    (<HTMLButtonElement>document.getElementById('stop-button')).disabled = true;
    document.getElementById('record-button')!.className = document.getElementById('record-button')!.className.replaceAll(' visually-hidden','');
    document.getElementById('resume-button')!.className += ' visually-hidden';
    //recordingType = '';
    timeDone = 0;
    cpsValues = [];

    const cpsButton = <HTMLButtonElement>document.getElementById('plot-cps');
    toggleCps(cpsButton, true); // Disable CPS again
  } else {
    document.getElementById('resume-button')!.className = document.getElementById('resume-button')!.className.replaceAll(' visually-hidden','');
  }

  keepReading = false;
  ser.flushData(); // Remove all old data

  try {
    clearTimeout(refreshTimeout);
    clearTimeout(metaTimeout);
  } catch (err) {
    console.warn('No timeout to clear.', err);
  }

  try {
    reader?.cancel();
  } catch(err) {
    console.warn('Nothing to disconnect.', err);
  }
  await closed;
}


let metaTimeout: NodeJS.Timeout;

function refreshMeta(type: dataType): void {
  if (ser.port?.readable) {
    const nowTime = new Date();

    const totalTimeElement = document.getElementById('total-record-time')!;
    const timeElement = document.getElementById('record-time')!;
    const progressBar = document.getElementById('ser-time-progress-bar')!;

    const delta = new Date(nowTime.getTime() - startTime + timeDone);

    timeElement.innerText = addLeadingZero(delta.getUTCHours().toString()) + ':' + addLeadingZero(delta.getUTCMinutes().toString()) + ':' + addLeadingZero(delta.getUTCSeconds().toString());

    if (maxRecTimeEnabled) {
      const progressElement = document.getElementById('ser-time-progress')!;
      const progress = Math.round(delta.getTime() / maxRecTime * 100);
      progressElement.style.width = progress + '%';
      progressElement.innerText = progress + '%';
      progressElement.setAttribute('aria-valuenow', progress.toString())

      const totalTime = new Date(maxRecTime);
      totalTimeElement.innerText = ' / ' +  addLeadingZero(totalTime.getUTCHours().toString()) + ':' + addLeadingZero(totalTime.getUTCMinutes().toString()) + ':' + addLeadingZero(totalTime.getUTCSeconds().toString());
      progressBar.className = progressBar.className.replaceAll(' visually-hidden','');
    } else {
      totalTimeElement.innerText = '';
      progressBar.className += ' visually-hidden';
    }

    if (delta.getTime() > maxRecTime && maxRecTimeEnabled) {
      disconnectPort(true);
      popupNotification('auto-stop');
    } else {
      const finishDelta = new Date().getTime() - nowTime.getTime();
      if (REFRESH_META_TIME - finishDelta > 0) { // Only re-schedule if still available
        metaTimeout = setTimeout(refreshMeta, REFRESH_META_TIME - finishDelta, type);
      } else {
        metaTimeout = setTimeout(refreshMeta, 1, type);
      }
    }
  }
}


let lastUpdate = new Date();
let refreshTimeout: NodeJS.Timeout;

function refreshRender(type: dataType): void {
  if (ser.port?.readable) {
    const startDelay = new Date();
    const newData = ser.getData(); // Get all the new data
    const endDelay = new Date();

    const delta = new Date(timeDone - startTime + startDelay.getTime());

    spectrumData[type] = ser.updateData(spectrumData[type], newData); // Depends on Background/Spectrum Aufnahme
    spectrumData[`${type}Cps`] = spectrumData[type].map(val => val / delta.getTime() * 1000);

    if (firstLoad) {
      plot.plotData(spectrumData, false);
      bindPlotEvents(); // needed, because of "false" above
      firstLoad = false;
    } else {
      plot.updatePlot(spectrumData);
    }

    const deltaLastRefresh = endDelay.getTime() - lastUpdate.getTime();
    lastUpdate = endDelay;

    const cpsValue = newData.length / deltaLastRefresh * 1000;
    document.getElementById('cps')!.innerText = cpsValue.toFixed(1) + ' cps';

    cpsValues.push(cpsValue);

    let mean = 0;
    cpsValues.forEach(item => mean += item);
    mean /= cpsValues.length;

    document.getElementById('avg-cps')!.innerHTML = 'Avg: ' + mean.toFixed(1);

    let std = 0;
    cpsValues.forEach(item => std += Math.pow(item - mean, 2));
    std /= (cpsValues.length - 1);
    std = Math.sqrt(std);

    document.getElementById('avg-cps-std')!.innerHTML = ` &plusmn; ${std.toFixed(1)} cps (&#916; ${Math.round(std/mean*100)}%)`;

    document.getElementById('total-spec-cts')!.innerText = spectrumData.getTotalCounts(spectrumData.data).toString();
    document.getElementById('total-bg-cts')!.innerText = spectrumData.getTotalCounts(spectrumData.background).toString();

    const finishDelta = new Date().getTime() - startDelay.getTime();
    if (refreshRate - finishDelta > 0) { // Only re-schedule if still available
      refreshTimeout = setTimeout(refreshRender, refreshRate - finishDelta, type);
    } else {
      refreshTimeout = setTimeout(refreshRender, 1, type);
    }
  }
}