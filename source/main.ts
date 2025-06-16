/*

  Gamma MCA: free, open-source web-MCA for gamma spectroscopy
  2022, NuclearPhoenix.- Phoenix1747
  https://nuclearphoenix.xyz

  ===============================

  Possible Future Improvements:
    - (?) Highlight plot lines in ROI selection
    - (?) Isotope list: Add grouped display, e.g. show all Bi-214 lines with a (right-)click
    - (?) Add pulse limit analog to time limit for serial recordings
    - (?) Use Window Controls Overlay API
    - (?) Dead time correction for cps
    - (?) Hist mode: First cps value is always zero?

    - NPESv2: Create additional save (append) button that allows users to save multiple data packages in one file
    - NPESv2: Let user remove data packages from file in the import selection dialog
    - Web Worker for Isotope Seek, FWHM Calculation, Plot update, Gaussian correlation (improved performance?)
    - Add full custom efficiency calibration
    - Add support for IndexedDB API to store spectra locally inside the browser/app without the need for a filesystem (discussions/227)

    - Automatically close system notifications when the user interacts with the page again
    - Sound card spectrometry prove of concept

    - Plotly.js has to be manually updated for the plot.ts script HTML export function!!!

  Known Issues/Problems/Limitations:
    - Plot.ts: Gaussian Correlation Filtering still has pretty bad performance despite many optimizations already.
    - Plotly.js: Plot updates takes forever, but there is no real way to improve it (?)
    - Plotly.js: Would love to use ScatterGL (WebGL) that VASTLY improves performance, but stackgroups don't work there: https://github.com/plotly/plotly.js/issues/5365
    - Plotly.js: Selection Box is technically not supported on scatter traces w/o text or markers, that's why it's spamming errors : https://github.com/plotly/plotly.js/issues/170

*/

// Import the main CSS file
import './css/main.scss';

// Import Bootstrap plugins
import 'bootstrap/js/dist/alert';
import 'bootstrap/js/dist/button';
import 'bootstrap/js/dist/collapse';
import 'bootstrap/js/dist/tab';
import Modal from 'bootstrap/js/dist/modal';
import Offcanvas from 'bootstrap/js/dist/offcanvas';
import Toast from 'bootstrap/js/dist/toast';

// Import Plotly.js
import Plotly, { PlotHoverEvent, PlotMouseEvent, PlotSelectionEvent, PlotlyHTMLElement } from 'plotly.js-basic-dist-min';

// Import other TS modules
import { SpectrumPlot, SeekClosest, DownloadFormat, CalculateFWHM, CoeffPoints } from './plot';
import { RawData, NPESv1, NPESv1Spectrum, JSONParseError, NPESv2 } from './raw-data';
import { SerialManager, WebSerial, WebUSBSerial } from './serial';
import { ToastNotification, launchSysNotification } from './notifications';
import { applyTheming, autoThemeChange } from './global-theming';

export interface IsotopeList {
  [key: string]: number[];
}

export interface SaveTypeList {
  [key: string]: FilePickerAcceptType;
}

interface FileSelectData {
  'filename': string,
  'package': NPESv1;
  'type': FileImportType;
}

export type DataOrder = 'hist' | 'chron';
type DataType = 'data' | 'background';
type PortList = (WebSerial | WebUSBSerial | undefined)[];
type DownloadType = 'CAL' | 'XML' | 'JSON' | 'EVOL' | 'CSV';
type SortTypes = 'asc' | 'desc' | 'none';
type FileImportType = DataType | 'both';

export class SpectrumData { // Will hold the measurement data globally.
  data: number[] = [];
  background: number[] = [];
  dataCps: number[] = [];
  backgroundCps: number[] = [];
  dataTime = 1000; // Measurement time in ms
  backgroundTime = 1000; // Measurement time in ms

  getTotalCounts(type: DataType, start = 0, end = this[type].length - 1): number {
    //return this[type].reduce((acc,curr) => acc + curr, 0);
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

  addPulseData(type: DataType, newDataArr: number[], adcChannels: number): void {
    if (!this[type].length) this[type] = Array(adcChannels).fill(0);

    for (const value of newDataArr) {
      this[type][value] += 1;
    }
  }

  addHist(type: DataType, newHistArr: number[]): void {
    if (!this[type].length) this[type] = newHistArr;

    for (const index in newHistArr) {
      this[type][index] += newHistArr[index];
    }
  }
}

// Holds all the classes
const spectrumData = new SpectrumData();
const plot = new SpectrumPlot('plot');
const raw = new RawData(1); // 2=raw, 1=hist

// Other "global" vars
const calClick = new Set<number>();
const oldCalVals: { [key: number ]: number | undefined } = {};

let portsAvail: PortList = [];
let refreshRate = 1000; // Delay in ms between serial plot updates
let maxRecTimeEnabled = false;
let maxRecTime = 1800000; // 30 minutes
const REFRESH_META_TIME = 200; // Milliseconds
const CONSOLE_REFRESH = 200; // Milliseconds
const AUTOSAVE_TIME = 900_000; // Milliseconds === 15 minutes

let cpsValues: number[] = [];

// Default isotope lists
const defaultIsotopeLists: string[] = ['assets/isotopes_energies_min.json', 'assets/isotopes_energies_norm_min.json', 'assets/isotopes_energies_artificial_min.json'];

let currentIsoListURL = defaultIsotopeLists[0]; // Use default isotope list URL
let customIsoListURL = ''; // Custom isotope list URL, set by user in settings
let isoList: IsotopeList = {};
let checkNearIso = false;
let maxDist = 100; // Max energy distance to highlight

const APP_VERSION = '2025-06-15';
const localStorageAvailable = 'localStorage' in self; // Test for localStorage, for old browsers
const wakeLockAvailable = 'wakeLock' in navigator; // Test for Screen Wake Lock API
const notificationsAvailable = 'Notification' in window; // Test for Notifications API
let allowNotifications = notificationsAvailable;
let fileSystemWritableAvail = false;
let firstInstall = false;

// Isotope table variables
const isoTableSortDirections: SortTypes[] = ['none', 'none', 'none'];
const faSortClasses: {[key: string]: string} = {
  none: 'fa-sort',
  asc: 'fa-sort-up',
  desc: 'fa-sort-down'
};

// Key combinations for hotkey function: ALT+KEY
const hotkeys = {
  'r': 'reset-plot',
  's': 'sma-label',
  'x': 'xAxis',
  'y': 'yAxis',
  'c': 'plot-cps',
  't': 'plot-type',
  'i': 'iso-hover-label',
  'p': 'peak-finder-btn',
  'e': 'enhance-eff-label',
  '1': 'file-import-tab',
  '2': 'serial-tab',
  '3': 'sound-tab',
  '4': 'calibration-tab',
  '5': 'metadata-tab',
};


/*
  Theming-related function calls
*/
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


/*
  Startup of the page
*/
document.body.onload = async function(): Promise<void> {
  fileSystemWritableAvail = (window.FileSystemHandle && 'createWritable' in FileSystemFileHandle.prototype); // Test for File System Access API

  if (localStorageAvailable) {
    loadSettingsStorage();
  } else {
    console.error('Browser does not support local storage. OOF, it must be ancient. Dude, update your browser. For real.');
  }

  if (navigator.serviceWorker) { // Add service worker for PWA
    const reg = await navigator.serviceWorker.register('/service-worker.js'); // Onload async because of this... good? hmmm.

    if (localStorageAvailable) {
      reg.addEventListener('updatefound', () => {
        if (firstInstall) return; // "Update" will always be installed on first load (service worker installation)

        new ToastNotification('updateInstalled'); //popupNotification('update-installed');
        launchSysNotification('New Update!', 'An update has been installed and will be applied once you reload Gamma MCA.');
      });
    }
  }

  if ('standalone' in window.navigator || window.matchMedia('(display-mode: standalone)').matches) { // Standalone PWA mode
    document.title += ' PWA';
    document.getElementById('main')!.classList.remove('p-1');

    const borderModeElements = document.getElementsByClassName('border-mode');
    for (const element of borderModeElements) {
      element.classList.add('border-0');
    }

    document.getElementById('plot-tab')!.classList.add('border-start-0', 'border-end-0');
  } else { // Default browser window
    document.getElementById('main')!.classList.remove('pb-1');
    document.title += ' web application';
  }

  currentIsoListURL = new URL(currentIsoListURL, window.location.origin).href; // Make sure the isotope list URL is absolute

  if (navigator.serial || navigator.usb) { // Web Serial API or fallback Web USB API with FTDx JS driver
    document.getElementById('serial-error')?.remove(); // Delete Serial Not Supported Warning
    navigator[navigator.serial ? 'serial' : 'usb'].addEventListener('connect', serialConnect);
    navigator[navigator.serial ? 'serial' : 'usb'].addEventListener('disconnect', serialDisconnect);
    listSerial(); // List Available Serial Ports
  } else {
    document.getElementById('serial-div')?.remove(); // Delete Serial Control Div
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
    (<any>window).launchQueue.setConsumer(
      async (launchParams: { files: FileSystemFileHandle[] }) => {
        if (!launchParams.files.length) return;

        const file: File = await launchParams.files[0].getFile();
        const filenameSplitArr: string[] = file.name.split('.');
        const fileExtension = filenameSplitArr[filenameSplitArr.length - 1].toLowerCase();

        if (fileSystemWritableAvail) { // Try to use the File System Access API if possible
          if (fileExtension === 'json' || fileExtension === 'xml') {
            dataFileHandle = launchParams.files[0];
            showSaveButton(dataFileHandle.name); // Only show "Save" button if it can be used
          }
        }

        const spectrumEndings = ['csv', 'tka', 'xml', 'txt', 'json'];
        if (spectrumEndings.includes(fileExtension)) getFileData(file, 'data');
        /* else if (fileExtension === 'json') {
          importCal(file);
        } */
        console.warn('File could not be imported!');
      });
  }

  resetPlot(); // Set up plot window

  document.getElementById('version-tag')!.innerText += ` ${APP_VERSION}.`;

  if (localStorageAvailable) {
    const lastVisit = loadJSON('lastVisit');
    if (!(typeof lastVisit === 'number' && lastVisit > 0)) {
      new ToastNotification('welcomeMessage'); //popupNotification('welcome-msg');
      if (notificationsAvailable) legacyPopupNotification('ask-notifications'); // Show notifications notification on first visit

      firstInstall = true;
    }

    saveJSON('lastVisit', Date.now());
    saveJSON('lastUsedVersion', APP_VERSION);

    const sVal = loadJSON('serialDataMode'); // ids: s1, s2
    const rVal = loadJSON('fileDataMode'); // ids: r1, r2

    if (typeof sVal === 'string') {
      const element = <HTMLInputElement>document.getElementById(sVal);
      element.checked = true;
      selectSerialType(element);
    }

    if (typeof rVal === 'string') {
      const element = <HTMLInputElement>document.getElementById(rVal);
      element.checked = true;
      selectFileType(element);
    }

    document.getElementById('ls-unavailable')?.remove(); // Remove saving alert

    const getAutoScrollValue = loadJSON('consoleAutoscrollEnabled');
    if (typeof getAutoScrollValue === 'boolean' && getAutoScrollValue) {
      autoscrollEnabled = getAutoScrollValue;
      (<HTMLInputElement>document.getElementById('autoscroll-console')).checked = getAutoScrollValue;
    }
  } else {
    document.getElementById('ls-available')?.remove(); // Remove saving alert
    new ToastNotification('welcomeMessage'); //popupNotification('welcome-msg');
  }

  loadSettingsDefault();
  sizeCheck();

  bindInputs(); // Enable settings enter press and onclick buttons

  const menuElements = document.getElementById('main-tabs')!.getElementsByTagName('button');
  for (const button of menuElements) {
    button.addEventListener('shown.bs.tab', (/*event: Event*/): void => {
      const toggleCalChartElement = <HTMLInputElement>document.getElementById('toggle-calibration-chart');
      const toggleEvolChartElement = <HTMLInputElement>document.getElementById('toggle-evolution-chart');

      if (toggleCalChartElement && toggleCalChartElement.checked) { // Leave cal/evol chart when changing tabs
        toggleCalChartElement.checked = false;
        toggleCalChart(false);
      } else if (toggleEvolChartElement && toggleEvolChartElement.checked) {
        toggleEvolChartElement.checked = false;
        toogleEvolChart(false);
      } else {
        plot.updatePlot(spectrumData); // Adjust Plot Size For Main Tab Menu Content Size
      }
    });
  }

  const isoTable = <HTMLTableElement>document.getElementById('table');
  
  const thList = <NodeListOf<HTMLTableCellElement>>isoTable.querySelectorAll('th[data-sort-by]'); // Add click event listeners to table header cells
  thList.forEach(th => {
    th.addEventListener('click', () => {
      const columnIndex = Number(th.dataset.sortBy);
      const sortDirection = isoTableSortDirections[columnIndex];

      // Toggle the sort direction
      isoTableSortDirections.fill('none');
      isoTableSortDirections[columnIndex] = sortDirection === 'asc' ? 'desc' : 'asc';

      thList.forEach((loopTableHeader, index) => {
        const sortIcon = loopTableHeader.querySelector('.fa-solid');
        if (sortIcon) {
          sortIcon.classList.remove(...Object.values(faSortClasses)); // Remove all old icons
          sortIcon.classList.add(faSortClasses[isoTableSortDirections[index+1]]); // Set new icons
        }
      });

      sortTableByColumn(isoTable, columnIndex, isoTableSortDirections[columnIndex]); // Actually sort the table rows
    });
  });

  // Activate notification button if the Notifications API is supported by the browser
  if (notificationsAvailable) {
    (<HTMLInputElement>document.getElementById('notifications-toggle')).disabled = false;
  } else {
    console.error('Browser does not support Notifications API.');
  }

  bindHotkeys();

  checkAndIncreaseCalibrationEntries(2); // Add at least two calibration bins for linear calibration

  if (localStorageAvailable) checkAutosave(); // Check for the last autosaved spectrum

  document.getElementById('loading')?.remove(); // Delete Loading Thingymajig
};


// Exit website confirmation alert
window.onbeforeunload = (event): string => {
  event.preventDefault();

  // Included for legacy support, e.g. Chrome/Edge < 119
  return event.returnValue = 'Are you sure you want to exit?';
};


window.onpagehide = (): void => {
  // Delete autosave data when user deliberately leaves the page without saving
  localStorage.removeItem('autosave');
}


// Needed For Responsiveness! DO NOT REMOVE OR THE LAYOUT GOES TO SHIT!!!
document.body.onresize = (): void => {
  plot.updatePlot(spectrumData);
  if (navigator.userAgent.toLowerCase().match(/mobile|tablet|android|webos|iphone|ipad|ipod|blackberry|bb|playbook|iemobile|windows phone|kindle|silk|opera mini/i)) {
    // Mobile device
  } else {
    sizeCheck();
  }
};


// User changed from browser window to PWA (after installation) or backwards
window.matchMedia('(display-mode: standalone)').addEventListener('change', (/*event*/): void => {
  /*
  let displayMode = 'browser';
  if (event.matches) {
    displayMode = 'standalone';
  }
  */
  window.location.reload(); // Just reload the page?
});


let deferredPrompt: any;

window.addEventListener('beforeinstallprompt', (event: Event): void => {
  event.preventDefault(); // Prevent the mini-infobar from appearing on mobile
  deferredPrompt = event;

  if (localStorageAvailable) {
    if (!loadJSON('installPrompt')) {
      legacyPopupNotification('pwa-installer'); // Show notification on first visit
      saveJSON('installPrompt', true);
    }
  }

  document.getElementById('manual-install')!.classList.remove('d-none');
});


document.getElementById('install-pwa-btn')!.onclick = () => installPWA();
document.getElementById('install-pwa-toast-btn')!.onclick = () => installPWA();

async function installPWA(): Promise<void> {
  //hideNotification('pwa-installer');
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
}


window.addEventListener('onappinstalled', (): void => {
  deferredPrompt = null;
  hideNotification('pwa-installer');
  document.getElementById('manual-install')!.classList.add('d-none');
});


document.getElementById('notifications-toggle')!.onclick = event => toggleNotifications((<HTMLInputElement>event.target).checked);
document.getElementById('notifications-toast-btn')!.onclick = () => toggleNotifications(true);

function toggleNotifications(toggle: boolean): void {
  allowNotifications = toggle;

  if (Notification.permission !== 'granted') {
    if (allowNotifications) {
      // Request permission from user to use notifications
      Notification.requestPermission().then((permission) => {
        if (permission === 'granted') {
          launchSysNotification('Success!', 'Notifications for Gamma MCA are now enabled.', true);
        }
        allowNotifications = allowNotifications && (permission === 'granted');

        (<HTMLInputElement>document.getElementById('notifications-toggle')).checked = allowNotifications;
        const result = saveJSON('allowNotifications', allowNotifications);
        new ToastNotification(result ? 'settingSuccess' : 'settingError'); // Success or error toast
      });
    }
  }
  
  hideNotification('ask-notifications');
  (<HTMLInputElement>document.getElementById('notifications-toggle')).checked = allowNotifications;
  const result = saveJSON('allowNotifications', allowNotifications);
  new ToastNotification(result ? 'settingSuccess' : 'settingError'); // Success or error toast
}


function showSaveButton(filename: string): void {
  const overwriteButton = <HTMLButtonElement>document.getElementById('overwrite-button');
  overwriteButton.disabled = false;
  overwriteButton.title = `Overwrite "${filename}" with current data.`;
}


document.getElementById('data')!.onclick = event => clickFileInput(event, 'data');
document.getElementById('background')!.onclick = event => clickFileInput(event, 'background');

const openFileTypes: FilePickerAcceptType[] = [
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
let dataFileHandle: FileSystemFileHandle | undefined;
let backgroundFileHandle: FileSystemFileHandle | undefined;

async function clickFileInput(event: MouseEvent, type: DataType): Promise<void> {
  //(<HTMLInputElement>event.target).value = ''; // No longer necessary?

  if (window.FileSystemHandle && window.showOpenFilePicker) { // Try to use the File System Access API if possible
    event.preventDefault(); // Don't show the "standard" HTML file picker...

    const openFilePickerOptions = {
      types: openFileTypes,
      multiple: false
    };

    let fileHandle: FileSystemFileHandle;

    try {
      [fileHandle] = await window.showOpenFilePicker(openFilePickerOptions); // ...instead show a File System Access API picker
    } catch (error) {
      console.warn('File Picker error:', error);
      return;
    }
    
    const file = await fileHandle.getFile();

    getFileData(file, type);

    const filenameSplitArr: string[] = file.name.split('.');
    const fileExtension = filenameSplitArr[filenameSplitArr.length - 1].toLowerCase();

    if (fileExtension !== 'json' && fileExtension !== 'xml') {
      //console.info('The "Save" action is not supported on the imported file.');
      return;
    }

    // File System Access API specific stuff
    if (type === 'background') {
      backgroundFileHandle = fileHandle;
    } else {
      dataFileHandle = fileHandle;
    }

    // Only show "Save" button if it can be used
    if (fileSystemWritableAvail) showSaveButton(fileHandle.name);
  }
}


document.getElementById('data')!.onchange = event => importFile(<HTMLInputElement>event.target, 'data');
document.getElementById('background')!.onchange = event => importFile(<HTMLInputElement>event.target, 'background');

function importFile(input: HTMLInputElement, type: DataType): void {
  if (!input.files?.length) return; // File selection has been canceled
  getFileData(input.files[0], type);
}


function getFileData(file: File, type: FileImportType): void { // Gets called when a file has been selected.
  const reader = new FileReader();

  const filenameSplitArr: string[] = file.name.split('.');
  const fileExtension = filenameSplitArr[filenameSplitArr.length - 1].toLowerCase();

  reader.readAsText(file);

  reader.onerror = () => {
    new ToastNotification('fileError'); //popupNotification('file-error');
    return;
  };

  reader.onload = async () => {
    const result = (<string>reader.result).trim(); // A bit unclean for typescript, I'm sorry

    if (fileExtension === 'xml') {
      if (window.DOMParser) {
        // Only grabs the first spectrum if there are multiple
        // Use JSON (NPES) if you want to have the option to select the spectrum to show
        const {espectrum, bgspectrum, coeff, meta} = raw.xmlToArray(result);

        (<HTMLInputElement>document.getElementById('sample-name')).value = meta.name;
        (<HTMLInputElement>document.getElementById('sample-loc')).value = meta.location;

        if (meta.time) {
          const date = new Date(meta.time);
          const rightDate = new Date(date.getTime() - date.getTimezoneOffset()*60*1000);
          (<HTMLInputElement>document.getElementById('sample-time')).value = rightDate.toISOString().slice(0,16);
        }

        (<HTMLInputElement>document.getElementById('sample-vol')).value = meta.volume?.toString() ?? '';
        (<HTMLInputElement>document.getElementById('sample-weight')).value = meta.weight?.toString() ?? '';
        (<HTMLInputElement>document.getElementById('device-name')).value = meta.deviceName;
        (<HTMLInputElement>document.getElementById('add-notes')).value = meta.notes;

        startDate = new Date(meta.startTime);
        endDate = new Date(meta.endTime);

        if (espectrum?.length && bgspectrum?.length) { // Both files ok
          spectrumData.data = espectrum;
          spectrumData.background = bgspectrum;
          spectrumData.dataTime = meta.dataMt*1000;
          spectrumData.backgroundTime = meta.backgroundMt*1000;
        
          if (meta.dataMt) spectrumData.dataCps = spectrumData.data.map(val => val / meta.dataMt);
          if (meta.backgroundMt) spectrumData.backgroundCps = spectrumData.background.map(val => val / meta.backgroundMt);

          type = 'both'; // Update type to reflect that both spectra have been loaded

        } else if (!espectrum?.length && !bgspectrum?.length) { // No spectrum
          new ToastNotification('fileError'); //popupNotification('file-error');
        } else if (type !== 'both') { // Only one spectrum
          const fileData = espectrum?.length ? espectrum : bgspectrum;
          const fileDataTime = (espectrum?.length ? meta.dataMt : meta.backgroundMt)*1000;
          const fileDataType = type;

          spectrumData[fileDataType] = fileData;
          spectrumData[`${fileDataType}Time`] = fileDataTime;
          
          if (fileDataTime) spectrumData[`${fileDataType}Cps`] = spectrumData[fileDataType].map(val => val / fileDataTime * 1000);
        }

        const importedCount = Object.values(coeff).filter(value => value !== 0).length;

        if (importedCount >= 2) {
          resetCal(); // Reset in case of old calibration

          checkAndIncreaseCalibrationEntries(importedCount);

          plot.calibration.coeff = coeff;
          plot.calibration.imported = true;
          displayCoeffs();

          const calSettings = document.getElementsByClassName('cal-setting');
          for (const element of calSettings) {
            (<HTMLInputElement>element).disabled = true;
          }

          addImportLabel();
          toggleCal(true);
        }
      } else {
        console.error('No DOM parser in this browser!');
        (<HTMLButtonElement>document.getElementById('overwrite-button')).disabled = true; // Disable save button again, if it could be used
        return;
      }
    } else if (fileExtension === 'json') { // THIS SECTION MAKES EVERYTHING ASYNC DUE TO THE JSON THING!!!
      const jsonData = await raw.jsonToObject(result);

      // Check if multiple files/errors were imported
      if (jsonData.length > 1) {
        const fileSelectModalElement = document.getElementById('file-select-modal')!;
        const fileSelectModal = new Modal(fileSelectModalElement);
        const selectElement = (<HTMLSelectElement>document.getElementById('select-spectrum'));

        // Delete all previous options
        selectElement.options.length = 0;

        // Fill with all the info and check for errors at the same time
        for (const dataPackage of jsonData) {
          // Check if there are any error packages
          if (checkJSONImportError(file.name, dataPackage)) return;

          const opt = document.createElement('option');
          const optionValue: FileSelectData = {
            'filename': file.name,
            'package': <NPESv1>dataPackage,
            'type': type,
          };

          opt.value = JSON.stringify(optionValue);
          opt.text = `${(<NPESv1>dataPackage).sampleInfo?.name} (${(<NPESv1>dataPackage).resultData.startTime ?? 'Undefined Time'})`;
          selectElement.add(opt);
        }

        fileSelectModal.show();
        
      } else {
        const importData = jsonData[0]; // Select first element to probe for errors

        // Check if it's an error
        if (checkJSONImportError(file.name, importData)) {
          (<HTMLButtonElement>document.getElementById('overwrite-button')).disabled = true; // Disable save button again, if it could be used
          return;
        }

        npesFileImport(file.name, <NPESv1>importData, type);
      }
      return; // Nothing else to do, imported successfully or continue doing stuff when the user has finished interacting with the modal
    } else if (type === 'background' || type === 'data') {
      spectrumData[`${type}Time`] = 1000;
      const csvData = raw.csvToArray(result);
      spectrumData[type] = csvData.histogramData;

      if (csvData.calibrationCoefficients) {
        resetCal(); // Reset in case of old calibration

        checkAndIncreaseCalibrationEntries(csvData.calibrationCoefficients.length);

        for (const index in csvData.calibrationCoefficients) {
          plot.calibration.coeff[`c${parseInt(index)+1}`] = csvData.calibrationCoefficients[index];
        }
        plot.calibration.imported = true;
        displayCoeffs();

        const calSettings = document.getElementsByClassName('cal-setting');
        for (const element of calSettings) {
          (<HTMLInputElement>element).disabled = true;
        }
        addImportLabel();
        toggleCal(true);
      }
    } else {
      console.error('Could not import file, some kind of critical mistake happened. This is very bad and should not have happened!');
    }

    finalizeFileImport(file.name, type);
  };
}


function checkJSONImportError(filename: string, data: NPESv1 | JSONParseError): boolean {
  if ('code' in data && 'description' in data) {
    //new ToastNotification('npesError'); //popupNotification('npes-error');
    // Pop up modal with more error information instead of just toast with oopsy
    const importErrorModalElement = document.getElementById('import-error-modal')!;
    const fileImportErrorModal = new Modal(importErrorModalElement);

    // Change content according to error
    document.getElementById('error-filename')!.innerText = filename;
    document.getElementById('error-code')!.innerText = data.code;
    document.getElementById('error-desc')!.innerText = data.description;

    fileImportErrorModal.show();
    return true;
  }

  return false;
}


function npesFileImport(filename: string, importData: NPESv1, type: FileImportType): void {
  // Import all the data from a JSON spectrum file to the active program
  (<HTMLInputElement>document.getElementById('device-name')).value = importData?.deviceData?.deviceName ?? '';
  (<HTMLInputElement>document.getElementById('sample-name')).value = importData?.sampleInfo?.name ?? '';
  (<HTMLInputElement>document.getElementById('sample-loc')).value = importData?.sampleInfo?.location ?? '';

  if (importData.sampleInfo?.time) {
    const date = new Date(importData.sampleInfo.time);
    const rightDate = new Date(date.getTime() - date.getTimezoneOffset()*60*1000);

    (<HTMLInputElement>document.getElementById('sample-time')).value = rightDate.toISOString().slice(0,16);
  }

  (<HTMLInputElement>document.getElementById('sample-weight')).value = importData.sampleInfo?.weight?.toString() ?? '';
  (<HTMLInputElement>document.getElementById('sample-vol')).value = importData.sampleInfo?.volume?.toString() ?? '';
  (<HTMLInputElement>document.getElementById('add-notes')).value = importData.sampleInfo?.note ?? '';

  const resultData = importData.resultData;

  if (resultData.startTime && resultData.endTime) {
    startDate = new Date(resultData.startTime);
    endDate = new Date(resultData.endTime);
  }

  const espectrum = resultData.energySpectrum;
  const bgspectrum = resultData.backgroundEnergySpectrum;
  if (espectrum && bgspectrum) { // Both files ok
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

    type = 'both'; // Update type to reflect that both spectra have been loaded

  } else if (type !== 'both') { // Only one spectrum
    const dataObj = espectrum ?? bgspectrum;
    const fileData = dataObj?.spectrum ?? [];
    const fileDataTime = (dataObj?.measurementTime ?? 1) * 1000;
    const fileDataType = type;

    spectrumData[fileDataType] = fileData;
    spectrumData[`${fileDataType}Time`] = fileDataTime;
    
    if (fileDataTime) spectrumData[`${fileDataType}Cps`] = spectrumData[fileDataType].map(val => val / fileDataTime * 1000);
  }

  const calDataObj = (espectrum ?? bgspectrum)?.energyCalibration; // Grab calibration preferably from energy spectrum

  if (calDataObj) {
    const coeffArray: number[] = calDataObj.coefficients;

    resetCal(); // Reset in case of old calibration

    checkAndIncreaseCalibrationEntries(coeffArray.length);

    for (const index in coeffArray) {
      plot.calibration.coeff[`c${parseInt(index) + 1}`] = coeffArray[index];
    }
    plot.calibration.imported = true;
    displayCoeffs();

    const calSettings = document.getElementsByClassName('cal-setting');
    for (const element of calSettings) {
      (<HTMLInputElement>element).disabled = true;
    }
    addImportLabel();
    toggleCal(true);
  }

  finalizeFileImport(filename, type);
}


function finalizeFileImport(filename: string, type: FileImportType): void {
  if (type === 'both') { // Set file name(s) to the openers
    document.getElementById('data-form-label')!.innerText = filename;
    document.getElementById('background-form-label')!.innerText = filename;
  } else {
    document.getElementById(`${type}-form-label`)!.innerText = filename;
  } 

  updateSpectrumCounts();
  updateSpectrumTime();

  /*
    Error Msg Problem with RAW Stream selection?
  */
  if (spectrumData.background.length !== spectrumData.data.length && spectrumData.data.length && spectrumData.background.length) {
    new ToastNotification('dataError'); //popupNotification('data-error');
    removeFile(type); // Remove file again
  }

  plot.resetPlot(spectrumData);
  bindPlotEvents();
}


document.getElementById('spectrum-select-btn')!.onclick = () => getJSONSelectionData();

function getJSONSelectionData(): void {
  const fileSelectData = <FileSelectData>JSON.parse((<HTMLSelectElement>document.getElementById('select-spectrum')).value);

  npesFileImport(fileSelectData.filename, fileSelectData.package, fileSelectData.type);

  const fileSelectModalElement = document.getElementById('file-select-modal')!; // Close the modal if the file saving has been successful
  const closeButton = <HTMLButtonElement>fileSelectModalElement.querySelector('.btn-close'); // Find some close button
  closeButton.click();
}


function checkAutosave(): void {
  const data = loadJSON('autosave');

  if (data) legacyPopupNotification('autosave-dialog'); // Show notification on first visit
}


document.getElementById('restore-data-btn')!.onclick = () => loadAutosave(true);
document.getElementById('discard-data-btn')!.onclick = () => loadAutosave(false);

async function loadAutosave(restore: boolean): Promise<void> {
  const data = loadJSON('autosave');

  if (data) {
    localStorage.removeItem('autosave'); // Delete autosave data

    if (restore && typeof data === 'string') {
      const objData = await raw.jsonToObject(data);

      if (objData.length) {
        const importData = objData[0]; // Select first element to probe for errors

        // TODO: Check if it's an error?
        //if (checkJSONImportError(file.name, importData)) return;

        npesFileImport('Autosave Data', <NPESv1>importData, 'data');
      } else {
        console.error('Could not load autosaved data!');
      }
    }
  }
}


/*
document.getElementById('delete-spectrum')!.onclick = () => deleteJSONSelectionData();

function deleteJSONSelectionData(): void {
  const selectElement = <HTMLSelectElement>document.getElementById('select-spectrum');
  const selectedValue = selectElement.value;
  
  // Remove from file and save contents

  selectElement.remove(selectElement.selectedIndex);
}
*/


function sizeCheck(): void {
  const minWidth = 1100;
  const minHeight = 700;
  if (document.documentElement.clientWidth <= minWidth || document.documentElement.clientHeight <= minHeight) {
    console.warn(`Small screen detected. Screen should be at least ${minWidth}x${minHeight} px for the best experience.`)
  }
}


document.getElementById('clear-data')!.onclick = () => removeFile('data');
document.getElementById('clear-bg')!.onclick = () => removeFile('background');

function removeFile(type: FileImportType): void {
  let removeType: DataType[];
  if (type === 'both') {
    removeType = ['data', 'background'];
  } else {
    removeType = [type];
  }

  for (const id of removeType) {
    spectrumData[id] = [];
    spectrumData[`${id}Time`] = 0;
    (<HTMLInputElement>document.getElementById(id)).value = '';
    document.getElementById(`${id}-form-label`)!.innerText = 'No File Chosen';

    if (id === 'data') dataFileHandle = undefined; // Reset File System Access API handlers
    if (id === 'background') backgroundFileHandle = undefined;
    if (dataFileHandle) {
      showSaveButton(dataFileHandle.name);
    } else if (backgroundFileHandle) {
      showSaveButton(backgroundFileHandle.name);
    } else {
      (<HTMLButtonElement>document.getElementById('overwrite-button')).disabled = true; // Disable save button again, if it could be used
    }

    document.getElementById(id + '-icon')!.classList.add('d-none');
  }

  updateSpectrumCounts();
  updateSpectrumTime();

  plot.resetPlot(spectrumData);
  bindPlotEvents();
}


function addImportLabel(): void {
  document.getElementById('calibration-title')!.classList.remove('d-none');
}


function updateSpectrumCounts() {
  const sCounts = spectrumData.getTotalCounts('data');
  const bgCounts = spectrumData.getTotalCounts('background');

  document.getElementById('total-spec-cts')!.innerText = sCounts.toString();
  document.getElementById('total-bg-cts')!.innerText = bgCounts.toString();

  if (sCounts) document.getElementById('data-icon')!.classList.remove('d-none');
  if (bgCounts) document.getElementById('background-icon')!.classList.remove('d-none');
}


function updateSpectrumTime() {
  document.getElementById('spec-time')!.innerText = getRecordTimeStamp(spectrumData.dataTime);
  document.getElementById('bg-time')!.innerText = getRecordTimeStamp(spectrumData.backgroundTime);
}


document.getElementById('r1')!.onchange = event => selectFileType(<HTMLInputElement>event.target);
document.getElementById('r2')!.onchange = event => selectFileType(<HTMLInputElement>event.target);

function selectFileType(button: HTMLInputElement): void {
  raw.fileType = parseInt(button.value);
  raw.valueIndex = parseInt(button.value);
  saveJSON('fileDataMode', button.id);
}


document.getElementById('reset-plot')!.onclick = () => resetPlot();

function resetPlot(hardReset = true): void {
  if (hardReset) {
    if (plot.xAxis === 'log') changeAxis(<HTMLButtonElement>document.getElementById('xAxis'));
    if (plot.yAxis === 'log') changeAxis(<HTMLButtonElement>document.getElementById('yAxis'));
    if (plot.sma) toggleSma(false, <HTMLInputElement>document.getElementById('sma'));
  }

  plot.clearAnnos();
  (<HTMLInputElement>document.getElementById('check-all-isos')).checked = false; // reset "select all" checkbox
  loadIsotopes(true); // Plot resets all isotope lines, but they stay checked if not force reloaded
  plot.resetPlot(spectrumData);
  bindPlotEvents(); // Fix Reset Bug: Hovering and Clicking not working.
}


document.getElementById('xAxis')!.onclick = event => changeAxis(<HTMLButtonElement>event.target);
document.getElementById('yAxis')!.onclick = event => changeAxis(<HTMLButtonElement>event.target);

function changeAxis(button: HTMLButtonElement): void {
  const id = button.id as 'xAxis' | 'yAxis';
  if (plot[id] === 'linear') {
    plot[id] = 'log';
    button.innerText = 'Log';
    plot.resetPlot(spectrumData); // Fix because of autorange bug in Plotly
    bindPlotEvents();
  } else {
    plot[id] = 'linear';
    button.innerText = 'Linear';
    plot.updatePlot(spectrumData);
  }
}


document.getElementById('sma')!.onclick = event => toggleSma((<HTMLInputElement>event.target).checked);

function toggleSma(value: boolean, thisValue: HTMLInputElement | null = null ): void {
  plot.sma = value;
  if (thisValue) thisValue.checked = false;
  plot.updatePlot(spectrumData);
}


document.getElementById('sma-val')!.onkeydown = event => {
  if (event.key === 'Enter') document.getElementById('sma')?.click(); // ENTER key
};
document.getElementById('sma-val')!.oninput = event => changeSma(<HTMLInputElement>event.target);

function changeSma(input: HTMLInputElement): void {
  const parsedInput = parseInt(input.value);
  if (isNaN(parsedInput)) {
    new ToastNotification('smaError'); //popupNotification('sma-error');
  } else {
    plot.smaLength = parsedInput;
    plot.updatePlot(spectrumData);
    saveJSON('smaLength', parsedInput);
  }
}


function bindPlotEvents(): void {
  if (!plot.plotDiv) return;

  const myPlot = <PlotlyHTMLElement>plot.plotDiv;
  myPlot.on('plotly_hover', hoverEvent);
  myPlot.on('plotly_unhover', unHover);
  myPlot.on('plotly_click', clickEvent);
  myPlot.on('plotly_selected', selectEvent);
  myPlot.addEventListener('contextmenu', (event: MouseEvent) => {
    event.preventDefault(); // Prevent the context menu from opening inside the plot!
  });
}


function hoverEvent(data: PlotHoverEvent): void {
  const dataPoint = data.points[0].x;

  if (typeof dataPoint === 'number') {
    for (const id of calClick) {
      (<HTMLInputElement>document.getElementById(`bin-${id}`)).value = dataPoint.toFixed(2);
    }
  
    if (checkNearIso) closestIso(dataPoint);
  }
}


function unHover(/*data: PlotMouseEvent*/): void {
  for (const id of calClick) {
    (<HTMLInputElement>document.getElementById(`bin-${id}`)).value = (oldCalVals[id] ?? '').toString();
  }
  /*
  if (Object.keys(prevIso).length > 0) {
    closestIso(-maxDist); // Force Reset Iso Highlighting
  }
  */
}


let prevClickLine: number | undefined;

function clickEvent(data: PlotMouseEvent): void {
  const dataPointX = data.points[0].x;
  const dataPointY = data.points[0].y;

  if (typeof dataPointX === 'number' && typeof dataPointY === 'number') {
    const xClickData = dataPointX.toFixed(2);

    document.getElementById('click-data')!.innerText = xClickData + data.points[0].xaxis.ticksuffix + ': ' + dataPointY.toFixed(2) + data.points[0].yaxis.ticksuffix;

    for (const id of calClick) {
      (<HTMLInputElement>document.getElementById(`bin-${id}`)).value = xClickData;
      oldCalVals[id] = dataPointX;
      calClick.delete(id);
      (<HTMLInputElement>document.getElementById(`select-bin-${id}`)).checked = false;
    }

    if (prevClickLine) plot.toggleLine(prevClickLine, prevClickLine.toString(), false); // Delete the last line

    if (data.event.button === 0) { // Left-click. spawn a line in the plot
      const newLine = Math.round(dataPointX);
      plot.toggleLine(newLine, newLine.toString(), true);
      prevClickLine = newLine;
    } else if (data.event.button === 2) { // Right-click, delete old line
      prevClickLine = undefined;
    }
    plot.updatePlot(spectrumData);
  }
}


function selectEvent(data: PlotSelectionEvent): void {
  /* // Just a reminder on how to modify trace color for a specific selection. Doesn't work as expected though.
  data.points.forEach(function(pt: any) {
    x.push(pt.x);
    y.push(pt.y);
    colors[pt.pointNumber] = color1;
  });

  (<any>window).Plotly.restyle(plot.plotDiv, {
    x: [x, y],
    xbins: {}
  }, [1, 2]);

  (<any>window).Plotly.restyle(plot.plotDiv, 'line.color', [colors], [0]);
  */

  const roiElement = document.getElementById('roi-info')!;
  const infoElement = document.getElementById('static-info')!;

  if (!data?.range?.x.length) { // De-select: data undefined or empty
    roiElement.classList.add('d-none');
    infoElement.classList.remove('d-none');
    return;
  }

  roiElement.classList.remove('d-none');
  infoElement.classList.add('d-none');

  let range: number[] = data.range.x;
  range = range.map(value => Math.round(value));

  let start = range[0];
  let end = range[1];

  document.getElementById('roi-range')!.innerText = `${start.toString()} - ${end.toString()}`;
  document.getElementById('roi-range-unit')!.innerText = plot.calibration.enabled ? ' keV' : '';
  
  if (plot.calibration.enabled) { // Convert the keV points back to bins
    const max = Math.max(spectrumData.data.length, spectrumData.background.length);
    const calAxis = plot.getCalAxis(max);
    const axisLength = calAxis.length;

    const findPoints = [start, end];
    const numberOfPoints = findPoints.length;
    const binPoints: number[] = [];
    let compareIndex = 0;

    for (let i = 0; i < axisLength; i++) {
      const value = calAxis[i];
      const compareValue = findPoints[compareIndex];

      if (value > compareValue) {
        binPoints.push(i); // Can be off by +1, doesn't really matter too much though.
        compareIndex++;

        if (compareIndex >= numberOfPoints) break;
      }
    }

    start = binPoints[0];
    end = binPoints[1];
  }

  const total = spectrumData.getTotalCounts('data', start, end);
  const bg = spectrumData.getTotalCounts('background', start, end);
  const net = total - bg;

  document.getElementById('total-counts')!.innerText = total.toString();
  document.getElementById('net-counts')!.innerText = net.toString();
  document.getElementById('bg-counts')!.innerText = bg.toString();
  document.getElementById('bg-ratio')!.innerText = (net / bg * 100).toFixed();
}


function checkAndIncreaseCalibrationEntries(order: number): void {
  const masterDivElement = document.getElementById('calibration-input')!;
  const childElements = masterDivElement.children;

  // Generate more bin input elements if there aren't enough
  for (let i = childElements.length; i <= order; i++) {
    addEnergyCalibrationEntry(i);
  }
}


document.getElementById('add-new-cal-bin')!.onclick = () => addEnergyCalibrationEntry();

function addEnergyCalibrationEntry(numberOffset = 0): void {
  const masterDivElement = document.getElementById('calibration-input')!;
  const masterCoeffElement = document.getElementById('energy-cal-coeff-list')!;

  const calNumber = Math.round(performance.now()) + numberOffset;

  const headDivElement = document.createElement('div');
  headDivElement.classList.add('hstack', 'gap-2');
  headDivElement.id = calNumber.toString();

  // GENERATE LEFT SIDE OF THE CALIBRATION HSTACK
  const binInputGroupElement = document.createElement('div');
  binInputGroupElement.classList.add('input-group', 'input-group-sm');

  // Create label element
  const binLabelElement = document.createElement('label');
  binLabelElement.classList.add('input-group-text');
  binLabelElement.htmlFor = `bin-${calNumber}`;
  binLabelElement.textContent = 'Bin:';
  binInputGroupElement.appendChild(binLabelElement);

  // Create input element
  const binInputElement = document.createElement('input');
  binInputElement.classList.add('form-control', 'form-control-sm', 'cal-setting');
  binInputElement.type = 'number';
  binInputElement.id = `bin-${calNumber}`;
  binInputElement.min = '0';
  binInputElement.value = '';
  binInputElement.title = 'Input bin number';
  binInputElement.placeholder = 'Select Bin Number';
  binInputGroupElement.appendChild(binInputElement);

  // Create checkbox element
  const checkboxElement = document.createElement('input');
  checkboxElement.type = 'checkbox';
  checkboxElement.classList.add('btn-check', 'cal-setting');
  checkboxElement.id = `select-bin-${calNumber}`;
  binInputGroupElement.appendChild(checkboxElement);

  // Add function to click event on select element
  checkboxElement.onclick = () => toggleCalClick(calNumber, checkboxElement.checked);

  // Create label for checkbox
  const labelForCheckbox = document.createElement('label');
  labelForCheckbox.classList.add('btn', 'btn-outline-primary');
  labelForCheckbox.htmlFor = `select-bin-${calNumber}`;
  labelForCheckbox.title = 'Select from plot';
  
  // Create icon inside the label
  const iconElement = document.createElement('i');
  iconElement.classList.add('fa-solid', 'fa-arrow-pointer');
  labelForCheckbox.appendChild(iconElement);
  
  binInputGroupElement.appendChild(labelForCheckbox);

  // GENERATE ARROW ICON IN THE MIDDLE OF THE HSTACK
  const arrowElement = document.createElement('span');
  arrowElement.innerHTML = '<i class="fa-solid fa-angles-right"></i>';

  // GENERATE RIGHT SIDE OF THE CALIBRATION HSTACK
  const energyInputGroupElement = document.createElement('div');
  energyInputGroupElement.classList.add('input-group', 'input-group-sm');

  // Create input element
  const energyInputElement = document.createElement('input');
  energyInputElement.classList.add('form-control', 'form-control-sm', 'cal-setting');
  energyInputElement.type = 'number';
  energyInputElement.id = `cal-${calNumber}`;
  energyInputElement.min = '1';
  energyInputElement.value = '';
  energyInputElement.title = 'Target energy for bin';
  energyInputElement.placeholder = 'Target Bin Energy';
  energyInputGroupElement.appendChild(energyInputElement);

  // Create label element for keV
  const energyLabelElement = document.createElement('label');
  energyLabelElement.classList.add('input-group-text');
  energyLabelElement.htmlFor = `cal-${calNumber}`;
  energyLabelElement.textContent = 'keV';
  energyInputGroupElement.appendChild(energyLabelElement);

  // Create button element for bin removal
  const removeBinEntry = document.createElement('button');
  removeBinEntry.classList.add('btn', 'btn-sm', 'btn-primary', 'del-cal-btn');
  removeBinEntry.type = 'button';
  //removeBinEntry.htmlFor = `cal-${calNumber}`;
  removeBinEntry.title = 'Remove bin from calibration'
  removeBinEntry.innerHTML = '<i class="fa-solid fa-circle-minus"></i>';
  energyInputGroupElement.appendChild(removeBinEntry);

  // Disable buttons if less than two bins are present for calibration (linear!)
  if (masterDivElement.children.length <= 2) {
    removeBinEntry.disabled = true;
  } else {
    removeBinEntry.classList.add('cal-setting');

    removeBinEntry.onclick = () => {
      headDivElement?.remove(); // Remove input HTML element
      calClick.delete(calNumber); // Remove entry from calClick
      delete oldCalVals[calNumber]; // Remove entry from oldCalVals
      masterCoeffElement.lastElementChild?.remove(); // Remove coefficient HTML element
    }
  }

  // ADD ALL THREE PARTS
  headDivElement.appendChild(binInputGroupElement);
  headDivElement.appendChild(arrowElement);
  headDivElement.appendChild(energyInputGroupElement);

  // ADD TO HSTACK
  masterDivElement.insertBefore(headDivElement, document.getElementById('add-new-cal-bin')!.parentElement);

  // GENERATE NEW COEFFICIENT VALUE
  const coeff = document.createElement('p');
  coeff.classList.add('mb-1');
  coeff.innerHTML = `<var>c<sub>${masterCoeffElement.children.length+1}</sub></var>: <span id="coeff-${masterCoeffElement.children.length+1}">0</span>`;

  masterCoeffElement.appendChild(coeff);
}


document.getElementById('apply-cal')!.onclick = event => toggleCal((<HTMLInputElement>event.target).checked);

async function toggleCal(enabled: boolean): Promise<void> {
  const button = document.getElementById('calibration-label')!;

  button.innerHTML = enabled ? '<i class="fa-solid fa-rotate-left"></i> Reset' : '<i class="fa-solid fa-check"></i> Calibrate';

  (<HTMLInputElement>document.getElementById('apply-cal')).checked = enabled;
  /*
    Reset Plot beforehand, to prevent x-range from dying when zoomed?
  */
  if (enabled) {
    if (!plot.calibration.imported) {
      const masterDivElement = document.getElementById('calibration-input')!;
      const childElements = masterDivElement.children;

      const validArray: number[][] = [];

      for (const element of childElements) {
        const id = element.id;

        if (!id) continue; // No idea, skip this element

        const binInput = ((<HTMLInputElement>document.getElementById(`bin-${id}`)).value).trim();
        const energyInput = ((<HTMLInputElement>document.getElementById(`cal-${id}`)).value).trim();

        if (!binInput.length || !energyInput.length) continue; // At least one input is empty

        const bin = parseFloat(binInput);
        const energy = parseFloat(energyInput);

        if (isNaN(bin) || isNaN(energy)) continue; // Something is not a number
        
        validArray.push([bin, energy]);
      }

      // Not enough points for at least a linear calibration
      if (validArray.length < 2) {
        new ToastNotification('calibrationApplyError'); //popupNotification('cal-error');

        const checkbox = <HTMLInputElement>document.getElementById('apply-cal');
        checkbox.checked = false;
        toggleCal(checkbox.checked);

        return;
      }

      // Clear old points
      for (const key in plot.calibration.points) {
        delete plot.calibration.points[key];
      }

      // Add new points
      for (const index in validArray) {
        const bin = validArray[index][0];
        const energy = validArray[index][1];
        plot.calibration.points[bin] = energy;
      }

      await plot.computeCoefficients();
    }
  }
  displayCoeffs();

  plot.calibration.enabled = enabled;
  plot.resetPlot(spectrumData); // Fix because of autorange bug in Plotly
  bindPlotEvents();
}


function displayCoeffs(): void {
  const masterCoeffElement = document.getElementById('energy-cal-coeff-list')!;

  for (let i = 0; i < masterCoeffElement.children.length; i++) {
    document.getElementById(`coeff-${i+1}`)!.innerText = (plot.calibration.coeff[`c${i+1}`] ?? 0).toString();
  }
}


document.getElementById('calibration-reset')!.onclick = () => resetCal();

function resetCal(): void {
  calClick.clear(); // Clear all values from set

  const calSettings = document.getElementsByClassName('cal-setting');
  for (const element of <HTMLCollectionOf<HTMLInputElement>>calSettings) {
    element.disabled = false;
    element.value = '';
  }

  const masterDivElementChilds = document.getElementById('calibration-input')!.children;
  const buttonArray: HTMLButtonElement[] = [];
  for (const child of masterDivElementChilds) {
    const deleteButtons = child.getElementsByClassName('del-cal-btn');
    for (const button of deleteButtons) {
      buttonArray.push(<HTMLButtonElement>button);
    }
  }

  for (const button of buttonArray) {
    button?.click();
  }

  checkAndIncreaseCalibrationEntries(2); // Add at least two calibration bins for linear calibration

  document.getElementById('calibration-title')!.classList.add('d-none');

  plot.clearCalibration();
  toggleCal(false);
}


function toggleCalClick(id: number, add: boolean): void {
  calClick.delete(id); // Remove value from set

  if (add) calClick.add(id); // Add value back if needed
}


document.getElementById('plot-type')!.onclick = () => changeType();

function changeType(): void {
  const button = <HTMLButtonElement>document.getElementById('plot-type');
  if (plot.linePlot) {
    button.innerHTML = '<i class="fas fa-chart-bar"></i> Bar';
  } else {
    button.innerHTML = '<i class="fas fa-chart-line"></i> Line';
  }
  plot.linePlot = !plot.linePlot;
  plot.updatePlot(spectrumData);
}


document.getElementById('plot-cps')!.onclick = event => toggleCps(<HTMLButtonElement>event.target);

function toggleCps(button: HTMLButtonElement): void {
  plot.cps = !plot.cps;

  button.innerText = plot.cps ? 'CPS' : 'Total';
  plot.updatePlot(spectrumData);
}


document.getElementById('cal-input')!.onchange = event => importCalButton(<HTMLInputElement>event.target);

function importCalButton(input: HTMLInputElement): void {
  if (!input.files?.length) return; // File selection has been canceled
  importCal(input.files[0]);
}


function importCal(file: File): void {
  const reader = new FileReader();

  reader.readAsText(file);

  reader.onload = () => {
    try {
      const result = (<string>reader.result).trim(); // A bit unclean for typescript, I'm sorry
      const obj = JSON.parse(result);

      if (obj.imported) {

        const calSettings = document.getElementsByClassName('cal-setting');
        for (const element of calSettings) {
          (<HTMLInputElement>element).disabled = true;
        }

        addImportLabel();

        plot.calibration.coeff = obj.coeff;
        plot.calibration.imported = true;

      } else {
        const masterDivElement = document.getElementById('calibration-input')!;
        const childElements = masterDivElement.children;
        
        checkAndIncreaseCalibrationEntries(Object.keys(obj.points).length);

        let index = 0;

        for (const [bin, energy] of Object.entries(<CoeffPoints>obj.points)) {
          const id = childElements[index].id;
          (<HTMLInputElement>document.getElementById(`bin-${id}`)).value = bin;
          (<HTMLInputElement>document.getElementById(`cal-${id}`)).value = energy.toString();

          oldCalVals[parseFloat(id)] = parseFloat(bin);

          index++;
        }
      }

    } catch(e) {
      console.error('Calibration Import Error:', e);
      new ToastNotification('calibrationImportError'); //popupNotification('cal-import-error');
    }
  };

  reader.onerror = () => {
    new ToastNotification('fileError'); //popupNotification('file-error');
    return;
  };
}


document.getElementById('toggle-calibration-chart')!.onclick = event => toggleCalChart((<HTMLInputElement>event.target).checked);

function toggleCalChart(enabled: boolean): void {
  const buttonLabel = document.getElementById('toggle-cal-chart-label')!;
  buttonLabel.innerHTML = enabled ? '<i class="fa-solid fa-eye-slash fa-beat-fade"></i> Hide Chart' : '<i class="fa-solid fa-eye"></i> Show Chart';

  plot.setChartType(enabled ? 'calibration' : 'default', spectrumData);

  if (!enabled) bindPlotEvents(); // Above call is equivalent to a full reset, so we need to bind the events again!
}


document.getElementById('toggle-evolution-chart')!.onclick = event => toogleEvolChart((<HTMLInputElement>event.target).checked);

function toogleEvolChart(enabled: boolean): void {
  const buttonLabel = document.getElementById('toggle-evol-chart-label')!;
  buttonLabel.innerHTML = enabled ? '<i class="fa-solid fa-eye-slash fa-beat-fade"></i> Hide Evolution' : '<i class="fa-solid fa-eye"></i> Show Evolution';

  plot.setChartType(enabled ? 'evolution' : 'default', spectrumData, cpsValues);

  if (!enabled) bindPlotEvents(); // Above call is equivalent to a full reset, so we need to bind the events again!
}


function addLeadingZero(number: string): string {
  if (parseFloat(number) < 10) return '0' + number;
  return number;
}


function getDateString(): string {
  const time = new Date();
  return time.getFullYear() + '-' + addLeadingZero((time.getMonth() + 1).toString()) + '-' + addLeadingZero(time.getDate().toString()) + '_' + addLeadingZero(time.getHours().toString()) + '-' + addLeadingZero(time.getMinutes().toString());
}


function getDateStringMin(): string {
  const time = new Date();
  return time.getFullYear() + '-' + addLeadingZero((time.getMonth() + 1).toString()) + '-' + addLeadingZero(time.getDate().toString());
}


function toLocalIsoString(date: Date) {
  let localIsoString = date.getFullYear() + '-'
    + addLeadingZero((date.getMonth() + 1).toString()) + '-'
    + addLeadingZero(date.getDate().toString()) + 'T'
    + addLeadingZero(date.getHours().toString()) + ':'
    + addLeadingZero(date.getMinutes().toString()) + ':'
    + addLeadingZero(date.getSeconds().toString());

  localIsoString += (-date.getTimezoneOffset() < 0) ? '-' : '+';
  const tzDate = new Date(0);
  tzDate.setMinutes(Math.abs(date.getTimezoneOffset()));

  localIsoString += addLeadingZero(tzDate.getUTCHours().toString()) + ':' + addLeadingZero(tzDate.getUTCMinutes().toString());
  return localIsoString;
}


document.getElementById('evolution-download-btn')!.onclick = () => downloadEvolution();

function downloadEvolution(): void {
  if (!cpsValues.length) {
    console.error('Time evolution is empty. No cps values to export!');
  }

  download(`evolution_${getDateString()}.csv`, cpsValues.join('\n'), 'EVOL');
}


document.getElementById('calibration-download')!.onclick = () => downloadCal();

function downloadCal(): void {
  const calObj = plot.calibration;

  let outStr = JSON.stringify(calObj);

  if (calObj.coeff.c1 === 0 && calObj.coeff.c2 === 0) {
    outStr = ''; // Nothing is calibrated, do not save anything
  }

  download(`calibration_${getDateString()}.json`, outStr, 'CAL');
}


document.getElementById('xml-export-btn')!.onclick = () => downloadXML();

function downloadXML(): void {
  const filename = `spectrum_${getDateString()}.xml`;
  const content = generateXML();
  download(filename, content, 'XML');
}


function makeXMLSpectrum(type: DataType, name: string): Element {
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
    const coeffs: number[] = [];
    Object.values(plot.calibration.coeff).forEach(c => coeffs.push(c ?? 0));
    for (const val of coeffs) {
      const coeff = document.createElementNS(null, 'Coefficient');
      coeff.textContent = val.toString();
      c.appendChild(coeff);
    }
    ec.appendChild(c);

    const po = document.createElementNS(null, 'PolynomialOrder');
    /*
    // Specifies the number of coefficients in the XML
    if (plot.calibration.coeff.c1 === 0) {
      po.textContent = (1).toString();
    } else {
      po.textContent = (2).toString();
    }
    */
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

  mt.textContent = (Math.round(spectrumData[`${type}Time`]/1000)).toString();
  root.appendChild(mt)

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


function generateXML(): string {
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
  /*
  if (serial) {
    dcrName.textContent = 'Gamma MCA Serial Device';
  } else {
    dcrName.textContent = 'Gamma MCA File';
  }
  */
  dcrName.textContent = (<HTMLInputElement>document.getElementById('device-name')).value.trim();
  dcr.appendChild(dcrName);

  if (startDate) {
    const st = document.createElementNS(null, 'StartTime');
    st.textContent = toLocalIsoString(startDate);
    rd.appendChild(st);

    const et = document.createElementNS(null, 'EndTime');
    rd.appendChild(et);

    if (endDate && endDate.getTime() - startDate.getTime() >= 0) {
      et.textContent = toLocalIsoString(endDate);
    } else {
      et.textContent = toLocalIsoString(new Date());
    }
  }

  const si = document.createElementNS(null, 'SampleInfo');
  rd.appendChild(si);

  const name = document.createElementNS(null, 'Name');
  name.textContent = (<HTMLInputElement>document.getElementById('sample-name')).value.trim();
  si.appendChild(name);

  const l = document.createElementNS(null, 'Location');
  l.textContent = (<HTMLInputElement>document.getElementById('sample-loc')).value.trim();
  si.appendChild(l);

  const t = document.createElementNS(null, 'Time');
  const tval = (<HTMLInputElement>document.getElementById('sample-time')).value.trim();
  if (tval.length) {
    t.textContent = toLocalIsoString(new Date(tval));
    si.appendChild(t);
  }

  const w = document.createElementNS(null, 'Weight');
  const wval = (<HTMLInputElement>document.getElementById('sample-weight')).value.trim();
  if (wval.length) {
    w.textContent = (parseFloat(wval)/1000).toString();
    si.appendChild(w);
  }

  const v = document.createElementNS(null, 'Volume');
  const vval = (<HTMLInputElement>document.getElementById('sample-vol')).value.trim();
  if (vval.length) {
    v.textContent = (parseFloat(vval)/1000).toString();
    si.appendChild(v);
  }

  const note = document.createElementNS(null, 'Note');
  note.textContent = (<HTMLInputElement>document.getElementById('add-notes')).value.trim();
  si.appendChild(note);

  if (spectrumData['data'].length) rd.appendChild(makeXMLSpectrum('data', spectrumName));
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


document.getElementById('npes-export-btn')!.onclick = () => downloadNPES();

function downloadNPES(): void {
  const filename = `spectrum_${getDateString()}.json`;
  const data = generateNPES();
  download(filename, data, 'JSON');
}


function makeJSONSpectrum(type: DataType): NPESv1Spectrum {
  const spec: NPESv1Spectrum = {
    numberOfChannels: spectrumData[type].length,
    validPulseCount: spectrumData.getTotalCounts(type),
    measurementTime: 0,
    spectrum: spectrumData[type]
  }
  spec.measurementTime = Math.round(spectrumData[`${type}Time`]/1000);

  if (plot.calibration.enabled) {
    const calObj = {
      polynomialOrder: 0,
      coefficients: <number[]>[]
    }
    calObj.polynomialOrder = Object.keys(plot.calibration.coeff).length - 1;
    Object.values(plot.calibration.coeff).forEach(c => calObj.coefficients.push(c ?? 0));
    spec.energyCalibration = calObj;
  }

  return spec;
}


function generateNPES(): string | undefined {
  const data: NPESv2 = {
    schemaVersion: 'NPESv2',
    data: []
  }

  const dataPackage: NPESv1 = {
    deviceData: {
      softwareName: 'Gamma MCA, ' + APP_VERSION,
      deviceName: (<HTMLInputElement>document.getElementById('device-name')).value.trim()
    },
    sampleInfo: {
      name: (<HTMLInputElement>document.getElementById('sample-name')).value.trim(),
      location: (<HTMLInputElement>document.getElementById('sample-loc')).value.trim(),
      note: (<HTMLInputElement>document.getElementById('add-notes')).value.trim()
    },
    resultData: {}
  }

  let val = parseFloat((<HTMLInputElement>document.getElementById('sample-weight')).value.trim());
  if (val) dataPackage.sampleInfo!.weight = val;

  val = parseFloat((<HTMLInputElement>document.getElementById('sample-vol')).value.trim());
  if (val) dataPackage.sampleInfo!.volume = val;

  const tval = (<HTMLInputElement>document.getElementById('sample-time')).value.trim();
  if (tval.length && new Date(tval)) dataPackage.sampleInfo!.time = toLocalIsoString(new Date(tval));

  if (startDate) {
    dataPackage.resultData.startTime = toLocalIsoString(startDate);

    if (endDate && endDate.getTime() - startDate.getTime() >= 0) {
      dataPackage.resultData.endTime = toLocalIsoString(endDate);
    } else {
      dataPackage.resultData.endTime = toLocalIsoString(new Date());
    }
  }

  if (spectrumData.data.length && spectrumData.getTotalCounts('data')) dataPackage.resultData.energySpectrum = makeJSONSpectrum('data');
  if (spectrumData.background.length && spectrumData.getTotalCounts('background')) dataPackage.resultData.backgroundEnergySpectrum = makeJSONSpectrum('background');

  // Additionally validate the JSON Schema?
  if (!dataPackage.resultData.energySpectrum && !dataPackage.resultData.backgroundEnergySpectrum) {
    //new ToastNotification('fileEmptyError'); //popupNotification('file-empty-error');
    return undefined;
  }

  data.data.push(dataPackage);

  return JSON.stringify(data);
}


document.getElementById('download-spectrum-btn')!.onclick = () => downloadData('spectrum', 'data');
document.getElementById('download-bg-btn')!.onclick = () => downloadData('background', 'background');

function downloadData(filename: string, data: DataType): void {
  filename += `_${getDateString()}.csv`;

  let text = '';
  spectrumData[data].forEach(item => text += item + '\n');

  download(filename, text, 'CSV');
}


document.getElementById('overwrite-button')!.onclick = () => overwriteFile();

async function overwriteFile(): Promise<void> {
  if (dataFileHandle && backgroundFileHandle) {
    new ToastNotification('saveMultipleAtOnce');
    return;
  }

  if (!dataFileHandle && !backgroundFileHandle) {
    console.error('No file handlers found to save to!');
    return;
  } 

  const handler = (dataFileHandle ?? backgroundFileHandle)!; // CANNOT be undefined, since I checked above, ugh...
  const writable = await handler.createWritable(); // Create a FileSystemWritableFileStream to write to.

  const file = await handler.getFile();
  const fileExtension = file.name.split('.')[1].toLowerCase();
  let content: string | undefined;

  if (fileExtension === 'xml') {
    content = generateXML();
  } else {
    content = generateNPES();
  }

  if (!content?.trim()) { // Check empty string
    new ToastNotification('fileEmptyError'); //popupNotification('file-empty-error');
    return;
  }

  await writable.write(content); // Write the contents of the file to the stream.
  await writable.close(); // Close the file and write the contents to disk.

  new ToastNotification('saveFile');
}


const saveFileTypes: SaveTypeList = {
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
  'EVOL': {
    description: 'Count rate time evolution file',
    accept: {
      'text/csv': ['.csv']
    }
  },
  'CSV': {
    description: 'Single spectrum file',
    accept: {
      'text/csv': ['.csv']
    }
  }
};

async function download(filename: string, text: string | undefined, type: DownloadType): Promise<void> {
  if (!text?.trim()) { // Check empty string
    new ToastNotification('fileEmptyError'); //popupNotification('file-empty-error');
    return;
  }

  if (window.FileSystemHandle && window.showSaveFilePicker) { // Try to use File System Access API
    const saveFilePickerOptions = {
      suggestedName: filename,
      types: [saveFileTypes[type]]
    };

    let newHandle: FileSystemFileHandle;

    try {
      newHandle = await window.showSaveFilePicker(saveFilePickerOptions); // Create a new handle
    } catch(error) {
      console.warn('File SaveAs error:', error);
      return;
    }

    // Update FileHandle for "Save" button
    if (dataFileHandle) {
      dataFileHandle = newHandle;
    } else if (backgroundFileHandle) {
      backgroundFileHandle = newHandle;
    }
    
    const writableStream = await newHandle.createWritable(); // Create a FileSystemWritableFileStream to write to

    await writableStream.write(text); // Write our file
    await writableStream.close(); // Close the file and write the contents to disk.

    new ToastNotification('saveFile');
  } else { // Fallback old download-only method
    const element = document.createElement('a');
    element.setAttribute('href', `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`);

    element.setAttribute('download', filename);

    element.style.display = 'none';
    element.click();
  }

  localStorage.removeItem('autosave'); // Delete autosave data

  const exportModalElement = document.getElementById('export-modal')!; // Close the modal if the file saving has been successful
  const closeButton = <HTMLButtonElement>exportModalElement.querySelector('.btn-close'); // Find some close button
  closeButton.click();
}


document.getElementById('reset-meta-values')!.onclick = () => resetSampleInfo();

function resetSampleInfo(): void {
  const toBeReset = <HTMLCollectionOf<HTMLInputElement>>document.getElementsByClassName('sample-info');
  for (const element of toBeReset) {
    element.value = '';
  }
}


document.getElementById('print-report')!.onclick = () => printReport();

function printReport(): void {
  // If Gaussian mode is not enabled, enable it to better find peaks
  const copyPeakFlag = plot.peakConfig.enabled;
  if (!copyPeakFlag) useGaussPeakMode(<HTMLButtonElement>document.getElementById('peak-finder-btn'));

  const dataArray = plot.computePulseHeightData(spectrumData); // Generate data with current settings + force enabled Gaussian
  const metaDataString = generateNPES();

  // After collecting the data, click twice on the button to get back to the 
  if (!copyPeakFlag) useIdlePeakMode(<HTMLButtonElement>document.getElementById('peak-finder-btn'));

  if (!dataArray.length || !metaDataString) {
    console.error('Nothing to analyze, no data found. Cannot print report!');
    new ToastNotification('reportError');
    return;
  }

  // Open a new tab, generate the report and print it
  const printWindow = window.open('/print.html', '_blank');
  if (printWindow) {
    // Wait for the document to be fully loaded before triggering everything else
    printWindow.onload = () => {
      const printDocument = printWindow.document;
      
      const metaData = (<NPESv2>JSON.parse(metaDataString)).data[0];

      printDocument.getElementById('sample-name')!.innerText = metaData.sampleInfo?.name || 'N/A';
      printDocument.getElementById('sample-loc')!.innerText = metaData.sampleInfo?.location || 'N/A';
      printDocument.getElementById('sample-time')!.innerText = metaData.sampleInfo?.time || 'N/A';
      printDocument.getElementById('note')!.innerText = metaData.sampleInfo?.note || 'N/A';
      printDocument.getElementById('device-name')!.innerText = metaData.deviceData?.deviceName || 'N/A';
      printDocument.getElementById('software-name')!.innerText = metaData.deviceData?.softwareName || 'N/A';
      printDocument.getElementById('start-time')!.innerText = metaData.resultData.startTime ?? 'N/A';
      printDocument.getElementById('end-time')!.innerText = metaData.resultData.endTime ?? 'N/A';
      printDocument.getElementById('total-time-gross')!.innerText = metaData.resultData.energySpectrum?.measurementTime?.toString() || 'N/A';
      printDocument.getElementById('total-time-bg')!.innerText = metaData.resultData.backgroundEnergySpectrum?.measurementTime?.toString() || 'N/A';
      printDocument.getElementById('cal-coeffs')!.innerText = JSON.stringify(plot.calibration.enabled ? plot.calibration.coeff : {c1:0,c2:0,c3:0}) || 'N/A';

      // Generate table and populate with data
      const tableHeadRow = <HTMLTableRowElement>printDocument.getElementById('peak-table-head-row');

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

      const tableBody = <HTMLTableElement>printDocument.getElementById('peak-table-body');

      // Compute data for analysis
      const dataX = dataArray[0].x; // Will be Gauss data, net spectrum or background in this order
      const dataY = dataArray[0].y;

      const peaks = plot.peakFinder(dataY);
      let index = 1;

      for (const peak of peaks) {
        const xPosition = dataX[Math.round(peak)];

        if (xPosition < 0) continue;

        const peakFWHM = new CalculateFWHM([xPosition], dataArray[1].x, dataArray[1].y).compute()[xPosition];
        const energyResolution = new CalculateFWHM([xPosition], dataArray[1].x, dataArray[1].y).getResolution()[xPosition];

        const sigmaMaxCenterDistance = 2 * peakFWHM / (2 * Math.sqrt(2 * Math.LN2)) // Max distance to peak center for 4 sigma of all peaks, approx total count number inside this range
        const peakCounterXMin = xPosition - sigmaMaxCenterDistance;
        const peakCounterXMax = xPosition + sigmaMaxCenterDistance;

        let spectrumValue = 0;
        let backgroundValue = 0;

        for (const i in dataX) {
          const xPos = dataX[i];
          if (xPos >= peakCounterXMin && xPos <= peakCounterXMax) {
            spectrumValue += dataArray[1].y[i];
            if (dataArray.length > 2) backgroundValue += dataArray[2].y[i];
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

      // Last step: Create an image element of the saved plot
      if (plot.plotDiv) {
        Plotly.toImage(plot.plotDiv,{format: 'png', height: 400, width: 1000}).then(
          function (url: string) {
            const img = <HTMLImageElement>printDocument.getElementById('plot-image');
            img.src = url;
  
            img.onload = () => printWindow.print(); // Finally print the window if the image has been loaded
          }
        );
      }
    };

    printWindow.onafterprint = () => printWindow.close(); // Close the new print tab after printing
  } else {
    console.error('Unable to open a new window for printing.');
  }
}


function legacyPopupNotification(id: string): void { // Uses Bootstrap Toasts already defined in HTML
  const element = document.getElementById(id);
  if (element) {
    const toast = new Toast(element);
    if (!toast.isShown()) toast.show();
  }
}


function hideNotification(id: string): void {
  const element = document.getElementById(id);
  if (element) {
    const toast = new Toast(element);
    if (toast.isShown()) toast.hide();
  }
}


function sortTableByColumn(table: HTMLTableElement, columnIndex: number, sortDirection: SortTypes) {
  const tbody = table.tBodies[0];
  const rows = Array.from(tbody.rows);

  rows.sort((a, b) => {
    const aCellValue = a.cells[columnIndex].textContent?.trim() ?? '';
    const bCellValue = b.cells[columnIndex].textContent?.trim() ?? '';

    const aNumValue = parseFloat(aCellValue.replace(/[^\d.-]/g, '')); // Get the mass number of the isotope
    const bNumValue = parseFloat(bCellValue.replace(/[^\d.-]/g, ''));

    if (isNaN(aNumValue) || isNaN(bNumValue)) {
      return aCellValue.localeCompare(bCellValue);
    }

    const comparison = aNumValue - bNumValue;

    return sortDirection === 'asc' ? comparison : -comparison;
  });

  tbody.append(...rows);
}


document.getElementById('toggle-menu')!.onclick = () => loadIsotopes();
document.getElementById('reload-isos-btn')!.onclick = () => loadIsotopes(true);

let loadedIsos = false;

async function loadIsotopes(reload = false): Promise<boolean> { // Load Isotope Energies JSON ONCE
  if (loadedIsos && !reload) return true; // Isotopes already loaded

  const loadingElement = document.getElementById('iso-loading')!;
  loadingElement.classList.remove('d-none');

  const options: RequestInit = {
    cache: 'no-cache',
    headers: {
      'Content-Type': 'text/plain; application/json; charset=UTF-8',
    },
  };


  const isoError = document.getElementById('iso-load-error')!;
  //isoError.innerText = ''; // Remove any old error msges
  isoError.classList.add('d-none'); // Hide any old errors
  let successFlag = true; // Ideally no errors

  try {
    const response = await fetch(currentIsoListURL, options);

    if (response.ok) { // If HTTP-status is 200-299
      const json: IsotopeList = await response.json();
      loadedIsos = true;

      // Clear old isotope list
      isoList = {}; // Reset the isotope list

      const table = <HTMLTableElement>document.getElementById('table');
      const tableElement = <HTMLTableElement>table.querySelector('#iso-table');
      tableElement.innerHTML = ''; // Delete old table

      for (const [key, energyArr] of Object.entries(json)) {
        let index = 0; // Index used to avoid HTML id duplicates

        const lowercaseName = key.toLowerCase().replace(/[^a-z0-9 -]/gi, '').trim(); // Fixes security issue. Clean everything except for letters, numbers and minus. See GitHub: #2
        const name = lowercaseName.charAt(0).toUpperCase() + lowercaseName.slice(1); // Capitalize Name

        for (const energy of energyArr) {
          if (isNaN(energy)) continue; // Not a number, ignore this one

          if (isoList[name]) {
            isoList[name].push(energy);
          } else {
            isoList[name] = [energy];
          }

          const uniqueName = name + '-' + index; // Append index number
          index++;

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

          cell1.innerHTML = `<input class="form-check-input iso-table-label" id="${uniqueName}" type="checkbox" value="${energy}">`; // keV to eV
          cell3.innerText = energy.toFixed(2); //`<label for="${uniqueName}">${energy.toFixed(2)}</label>`;

          const clickBox = <HTMLInputElement>document.getElementById(uniqueName);
          clickBox.onclick = () => plotIsotope(clickBox);

          const strArr = name.split('-');

          cell2.innerHTML = `<sup>${strArr[1]}</sup>${strArr[0]}`; //`<label for="${uniqueName}"><sup>${strArr[1]}</sup>${strArr[0]}</label>`;
        }
      }

      if (isoTableSortDirections[2] !== 'asc') { // Default sort is ascending by isotope energy
        const sortButton = <HTMLTableCellElement>table.querySelector('th[data-sort-by="2"]');
        sortButton.click();
      } else {
        sortTableByColumn(table, 2, 'asc');
      }

      plot.clearAnnos(); // Delete all isotope lines
      plot.updatePlot(spectrumData);
      plot.isotopeSeeker = new SeekClosest(isoList); // Generate new seeker for the plot with the current list
      isotopeSeeker = new SeekClosest(isoList);
    } else {
      isoError.innerText = `Could not load isotope list! HTTP Error: ${response.status}. Please try again.`;
      isoError.classList.remove('d-none');
      successFlag = false;
    }
  } catch (err) { // No network connection!
    console.error(err);
    isoError.innerText = 'Could not load isotope list! Connection refused - you are probably offline.';
    isoError.classList.remove('d-none');
    successFlag = false;
  }

  loadingElement.classList.add('d-none');
  return successFlag;
}


document.getElementById('iso-hover')!.onclick = () => toggleIsoHover();

let prevIso: [string, number] | undefined;

function toggleIsoHover(): void {
  checkNearIso = !checkNearIso;
  closestIso(-100000);
}


let isotopeSeeker: SeekClosest | undefined;

async function closestIso(value: number): Promise<void> {
  if (!await loadIsotopes()) return; // User has not yet opened the settings panel

  if (!isotopeSeeker) isotopeSeeker = new SeekClosest(isoList);
  
  if (prevIso) plot.toggleLine(prevIso[1], prevIso[0], false); // Remove previous isotope line

  const { energy, name } = isotopeSeeker.seek(value, maxDist);

  if (energy && name) {
    const newIso: [string, number] = [name, energy];

    const isNewToggleLine = plot.toggleLine(energy, name);

    // Check if there is already a line for this energy
    if (prevIso !== newIso && isNewToggleLine) prevIso = newIso;

    // If there was a duplicate, the line was not toggled, so we don't set prevIso
    if (!isNewToggleLine) prevIso = undefined;
  }
  plot.updatePlot(spectrumData);
}


function plotIsotope(checkbox: HTMLInputElement): void {
  const wordArray = checkbox.id.split('-');
  plot.toggleLine(parseFloat(checkbox.value), wordArray[0] + '-' + wordArray[1], checkbox.checked);
  plot.updatePlot(spectrumData);
}


document.getElementById('check-all-isos')!.onclick = (event) => selectAll(<HTMLInputElement>event.target);

function selectAll(selectBox: HTMLInputElement): void {
  const tableRows = (<HTMLTableElement>document.getElementById('table')).tBodies[0].rows;

  for (const row of tableRows) {
    const checkBox = <HTMLInputElement>row.cells[0].firstChild;
    checkBox.checked = selectBox.checked;
    if (selectBox.checked) {
      const wordArray = checkBox.id.split('-');
      plot.toggleLine(parseFloat(checkBox.value), wordArray[0] + '-' + wordArray[1], checkBox.checked);
    }
  }
  if (!selectBox.checked) plot.clearAnnos();

  // Bad performance because of Plotly with too many lines!
  plot.updatePlot(spectrumData);
}


function useIdlePeakMode(button: HTMLButtonElement): void {
  plot.clearPeakFinder(); // Delete all old lines
  plot.peakConfig.enabled = false;
  button.innerText = 'None';
}


function useGaussPeakMode(button: HTMLButtonElement): void {
  plot.peakConfig.enabled = true;
  plot.peakConfig.mode = 'gaussian';
  button.innerText = 'Gaussian';
}


function useEnergyPeakMode(button: HTMLButtonElement): void {
  plot.peakConfig.mode = 'energy';
  button.innerText = 'Energy';
}


async function useIsotopePeakMode(button: HTMLButtonElement): Promise<void> {
  plot.clearPeakFinder(); // Delete all old lines
  await loadIsotopes();
  plot.peakConfig.mode = 'isotopes';
  button.innerText = 'Isotopes';
}


document.getElementById('peak-finder-btn')!.onclick = event => findPeaks(<HTMLButtonElement>event.target);

async function findPeaks(button: HTMLButtonElement): Promise<void> {
  if (plot.peakConfig.enabled) {
    switch(plot.peakConfig.mode) {
      case 'gaussian': // Second Mode: Energy
        useEnergyPeakMode(button);
        break;
        
      case 'energy': // Third Mode: Isotopes
        await useIsotopePeakMode(button);
        break;

      case 'isotopes':
        useIdlePeakMode(button);
        break;
    }
  } else { // First Mode: Gauss
    useGaussPeakMode(button);
  }

  plot.updatePlot(spectrumData);
}


function bindHotkeys(): void {
  // Bind ESCAPE key to the settings offcanvas
  document.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key.toLowerCase() === 'escape') {
      const offcanvasElement = document.getElementById('offcanvas');
      if (offcanvasElement && !offcanvasElement.classList.contains('show')) { // Exists and is not shown currently
        if (!offcanvasElement.classList.contains('showing')) { // Don't toggle while in transition
          new Offcanvas(offcanvasElement).show(); // Offcanvas is closed, open it
        }
      }
    }
  });
  const settingsButton = document.getElementById('toggle-menu');
  if (settingsButton) settingsButton.title += ' (ESC)'; // Add hotkey hint to settings button

  // Bind all other standard hotkeys
  for (const [key, buttonId] of Object.entries(hotkeys)) {
    const button = document.getElementById(buttonId);
    document.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.altKey && event.key.toLowerCase() === key.toLowerCase()) {
        event.preventDefault(); // Prevent the browser default action from popping up
        if (!event.repeat) button?.click(); // Call the function to handle the hotkey action only once per keydown
      }
    });
    if (button) button.title += ` (ALT+${key.toUpperCase()})`; // Add hotkey hint to button titles
  }
}


document.getElementById('enhance-eff')!.onclick = (event) => toggelEfficiencyEnhancer(<HTMLInputElement>event.target);

function toggelEfficiencyEnhancer(target: HTMLInputElement): void {
  plot.enhanceEfficiency = target.checked;

  plot.updatePlot(spectrumData);
}

/*
=========================================
  LOADING AND SAVING
=========================================
*/
// These functions are REALLY ugly and a nightmare to maintain, but I don't know how to make it
// better without nuking everything related to the settings and starting again from the ground up.
// I'll probably have to do a complete re-write of the whole settings at one point...

function saveJSON(name: string, value: string | boolean | number): boolean {
  if (localStorageAvailable) {
    localStorage.setItem(name, JSON.stringify(value));
    return true;
  }
  return false;
}


function loadJSON(name: string): unknown {
  return JSON.parse(<string>localStorage.getItem(name));
}


function bindInputs(): void {
  // Bind settings button onclick events and enter press, format: {settingsValueElement: settingsName}
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
  }
  for (const [inputId, settingsName] of Object.entries(settingsEnterPressElements)) {
    const valueElement = <HTMLInputElement>document.getElementById(inputId);
    valueElement.onkeydown = event => {
      //if (event.key === 'Enter') buttonElement.click(); // Press ENTER key;
      if (event.key === 'Enter') changeSettings(settingsName, valueElement);
    };
    const buttonElement = <HTMLButtonElement>document.getElementById(`${inputId}-btn`);
    if (buttonElement) buttonElement.onclick = () => changeSettings(settingsName, valueElement);
  }

  // Bind settings button press or onchange events for settings that do not have the default value input element
  document.getElementById('new-flags')!.onclick = event => changeSettings('newPeakStyle', <HTMLInputElement>event.target); // Checkbox
  document.getElementById('enable-res')!.onclick = event => changeSettings('showEnergyRes', <HTMLInputElement>event.target); // Checkbox
  document.getElementById('fwhm-fast')!.onclick = event => changeSettings('useFWHMFast', <HTMLInputElement>event.target); // Checkbox
  document.getElementById('edit-plot')!.onclick = event => changeSettings('editMode', <HTMLInputElement>event.target); // Checkbox
  document.getElementById('toggle-time-limit')!.onclick = event => changeSettings('timeLimitBool', <HTMLInputElement>event.target); // Checkbox
  document.getElementById('download-format')!.onchange = event => changeSettings('plotDownload', <HTMLSelectElement>event.target); // Select
  document.getElementById('theme-select')!.onchange = event => changeSettings('theme', <HTMLSelectElement>event.target); // Select
  document.getElementById('list-select')!.onchange = event => changeSettings('list', <HTMLSelectElement>event.target); // Select
}


function loadSettingsDefault(): void {
  if (notificationsAvailable) {
    (<HTMLInputElement>document.getElementById('notifications-toggle')).checked = allowNotifications && (Notification.permission === 'granted');
  }
  
  (<HTMLInputElement>document.getElementById('custom-url')).value = customIsoListURL;
  (<HTMLInputElement>document.getElementById('edit-plot')).checked = plot.editableMode;
  (<HTMLInputElement>document.getElementById('custom-delimiter')).value = raw.delimiter;
  (<HTMLInputElement>document.getElementById('custom-file-adc')).value = raw.adcChannels.toString();
  (<HTMLInputElement>document.getElementById('custom-ser-refresh')).value = (refreshRate / 1000).toString(); // Convert ms to s
  (<HTMLInputElement>document.getElementById('custom-ser-buffer')).value = SerialManager.maxSize.toString();
  (<HTMLInputElement>document.getElementById('custom-ser-adc')).value = SerialManager.adcChannels.toString();
  
  const time = new Date(maxRecTime); // Create a date with the time limit
  (<HTMLInputElement>document.getElementById('ser-limit-h')).value = (time.getUTCHours() + (time.getUTCDate() - 1) * 24).toString(); // Grab the hours
  (<HTMLInputElement>document.getElementById('ser-limit-m')).value = time.getUTCMinutes().toString(); // Grab the minutes
  (<HTMLInputElement>document.getElementById('ser-limit-s')).value = time.getUTCSeconds().toString(); // Grab the seconds
  
  (<HTMLInputElement>document.getElementById('toggle-time-limit')).checked = maxRecTimeEnabled;
  (<HTMLInputElement>document.getElementById('iso-hover-prox')).value = maxDist.toString();
  (<HTMLInputElement>document.getElementById('custom-baud')).value = SerialManager.baudRate.toString();
  (<HTMLInputElement>document.getElementById('eol-char')).value = SerialManager.eolChar;

  (<HTMLInputElement>document.getElementById('sma-val')).value = plot.smaLength.toString();

  (<HTMLInputElement>document.getElementById('new-flags')).checked = plot.peakConfig.newPeakStyle;
  (<HTMLInputElement>document.getElementById('enable-res')).checked = plot.peakConfig.showFWHM;
  (<HTMLInputElement>document.getElementById('fwhm-fast')).checked = CalculateFWHM.fastMode;

  (<HTMLInputElement>document.getElementById('peak-thres')).value = plot.peakConfig.thres.toString();
  (<HTMLInputElement>document.getElementById('peak-lag')).value = plot.peakConfig.lag.toString();
  (<HTMLInputElement>document.getElementById('seek-width')).value = SeekClosest.seekWidth.toString();
  (<HTMLInputElement>document.getElementById('gauss-sigma')).value = plot.gaussSigma.toString();

  const formatSelector = <HTMLSelectElement>document.getElementById('download-format');
  const formatLen = formatSelector.options.length;
  const format = plot.downloadFormat;
  for (let i = 0; i < formatLen; i++) {
    if (formatSelector.options[i].value === format) formatSelector.selectedIndex = i;
  }
}


function loadSettingsStorage(): void {
  let setting = loadJSON('allowNotifications');
  if (notificationsAvailable && typeof setting === 'boolean') allowNotifications = setting && (Notification.permission === 'granted');

  setting = loadJSON('customURL');
  if (typeof setting === 'string') customIsoListURL = new URL(setting).href;

  setting = loadJSON('editMode');
  if (typeof setting === 'boolean') plot.editableMode = setting;

  setting = loadJSON('fileDelimiter');
  if (typeof setting === 'string') raw.delimiter = setting;

  setting = loadJSON('fileChannels');
  if (typeof setting === 'number') raw.adcChannels = setting;

  setting = loadJSON('plotRefreshRate');
  if (typeof setting === 'number') refreshRate = setting;

  setting = loadJSON('serBufferSize');
  if (typeof setting === 'number') SerialManager.maxSize = setting;

  setting = loadJSON('timeLimitBool');
  if (typeof setting === 'boolean') maxRecTimeEnabled = setting;

  setting = loadJSON('timeLimit');
  if (typeof setting === 'number') maxRecTime = setting;

  setting = loadJSON('maxIsoDist');
  if (typeof setting === 'number') maxDist = setting;

  setting = loadJSON('baudRate');
  if (typeof setting === 'number') SerialManager.baudRate = setting;

  setting = loadJSON('eolChar');
  if (typeof setting === 'string') SerialManager.eolChar = setting;

  setting = loadJSON('serChannels');
  if (typeof setting === 'number') SerialManager.adcChannels = setting;

  setting = loadJSON('smaLength');
  if (typeof setting === 'number') plot.smaLength = setting;

  setting = loadJSON('peakThres');
  if (typeof setting === 'number') plot.peakConfig.thres = setting;

  setting = loadJSON('peakLag');
  if (typeof setting === 'number') plot.peakConfig.lag = setting;

  setting = loadJSON('seekWidth');
  if (typeof setting === 'number') SeekClosest.seekWidth = setting;

  setting = loadJSON('plotDownload');
  if (setting === 'svg' || setting === 'png' || setting === 'jpeg' || setting === 'webp') plot.downloadFormat = setting;

  // Setting for dark mode is right at the beginning of the file

  setting = loadJSON('gaussSigma');
  if (typeof setting === 'number') plot.gaussSigma = setting;

  setting = loadJSON('showEnergyRes');
  if (typeof setting === 'boolean') plot.peakConfig.showFWHM = setting;

  setting = loadJSON('useFWHMFast');
  if (typeof setting === 'boolean') CalculateFWHM.fastMode = setting;

  setting = loadJSON('newPeakStyle');
  if (typeof setting === 'boolean') plot.peakConfig.newPeakStyle = setting;

  // All of the below is a bit janky, but it works for now
  const themeSelector = <HTMLSelectElement>document.getElementById('theme-select');
  const themeLen = themeSelector.options.length;
  const theme = loadJSON('theme');
  for (let i = 0; i < themeLen; i++) {
    if (themeSelector.options[i].value === theme) themeSelector.selectedIndex = i;
  }

  const listSelector = <HTMLSelectElement>document.getElementById('list-select');
  const listLen = listSelector.options.length;
  const list = loadJSON('list');
  for (let i = 0; i < listLen; i++) {
    if (listSelector.options[i].value === list) listSelector.selectedIndex = i;
  }

  // Set the current isotope list URL from settings
  if (list === 'custom') { // Custom URL selected
    if (customIsoListURL) {
      currentIsoListURL = customIsoListURL;
    }
  } else {
    const isoListURL = defaultIsotopeLists[listSelector.selectedIndex];
    currentIsoListURL = new URL(isoListURL, window.location.origin).href;
  }
}


function changeSettings(name: string, element: HTMLInputElement | HTMLSelectElement): void {
  const stringValue = element.value.trim();
  let result = false;

  if (!element.checkValidity() || !stringValue) {
    new ToastNotification('settingType'); //popupNotification('setting-type');
    return;
  }

  switch (name) {
    case 'editMode': {
      const boolVal = (<HTMLInputElement>element).checked;
      plot.editableMode = boolVal;
      plot.resetPlot(spectrumData); // Modify won't be disabled if you don't fully reset
      bindPlotEvents();

      result = saveJSON(name, boolVal);
      break;
    }
    case 'customURL': {
      try {
        /*
        // Currently not yet supported in this TS version
        // Use new String.prototype.toWellFormed() method if available to sanitize any ill-formed strings
        let tmpStringCopy = stringValue;
        if ('toWellFormed' in String.prototype) {
          tmpStringCopy = tmpStringCopy.toWellFormed();
        }
        */
        customIsoListURL = new URL(stringValue).href;

        loadIsotopes(true);

        result = saveJSON(name, customIsoListURL);

      } catch(e) {
        new ToastNotification('settingError'); //popupNotification('setting-error');
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
      const boolVal = (<HTMLInputElement>element).checked;
      maxRecTimeEnabled = boolVal;

      result = saveJSON(name, boolVal);
      break;
    }
    case 'timeLimit': {
      const timeElements = element.id.split('-');
      const elementIds = ['s', 'm', 'h'];
      let value = 0;
      for (const index in elementIds) {
        value += parseInt((<HTMLInputElement>document.getElementById(`${timeElements[0]}-${timeElements[1]}-${elementIds[index]}`)).value.trim()) * 60**parseInt(index);
      }
      value *= 1000; // Convert s to ms

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
      refreshRate = numVal * 1000; // convert s to ms

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
      plot.downloadFormat = <DownloadFormat>stringValue // Cast to DownloadFormat
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
    case 'list': {
      const isoListSelector = <HTMLSelectElement>document.getElementById('list-select');
      const selectedValue = isoListSelector.options[isoListSelector.selectedIndex].value;
      if (selectedValue === 'custom') { // Custom URL selected
        if (customIsoListURL) {
          currentIsoListURL = customIsoListURL;
        } else {
          new ToastNotification('settingError'); //popupNotification('setting-error');
          break;
        }
      } else {
        const isoListURL = defaultIsotopeLists[isoListSelector.selectedIndex];
        currentIsoListURL = new URL(isoListURL, window.location.origin).href;
      }

      loadIsotopes(true);

      result = saveJSON(name, stringValue);

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
      const boolVal = (<HTMLInputElement>element).checked;
      plot.peakConfig.showFWHM = boolVal;
      plot.updatePlot(spectrumData);

      result = saveJSON(name, boolVal);
      break;
    }
    case 'useFWHMFast': {
      const boolVal = (<HTMLInputElement>element).checked;
      CalculateFWHM.fastMode = boolVal;
      plot.updatePlot(spectrumData);
      
      result = saveJSON(name, boolVal);
      break;
    }
    case 'newPeakStyle': {
      const boolVal = (<HTMLInputElement>element).checked;
      plot.peakConfig.newPeakStyle = boolVal;
      plot.updatePlot(spectrumData);
      
      result = saveJSON(name, boolVal);
      break;
    }
    default: {
      new ToastNotification('settingError'); //popupNotification('setting-error');
      return;
    }
  }

  if (result) new ToastNotification('settingSuccess'); //popupNotification('setting-success'); // Success Toast
}


document.getElementById('reset-gamma-mca')!.onclick = () => resetMCA();

function resetMCA(): void {
  // Maybe also reset service worker?
  if (localStorageAvailable) localStorage.clear();
  window.location.reload();
}

/*
=========================================
  SERIAL CONNECTION DATA
=========================================
*/

let serRecorder: SerialManager | undefined;


document.getElementById('s1')!.onchange = event => selectSerialType(<HTMLInputElement>event.target);
document.getElementById('s2')!.onchange = event => selectSerialType(<HTMLInputElement>event.target);

function selectSerialType(button: HTMLInputElement): void {
  SerialManager.orderType = <DataOrder>button.value;
  saveJSON('serialDataMode', button.id);
}


function serialConnect(/*event: Event*/): void {
  listSerial();
  new ToastNotification('serialConnect'); //popupNotification('serial-connect');
}


function serialDisconnect(event: Event): void {
  if (serRecorder?.isThisPort(<SerialPort | USBDevice>event.target)) disconnectPort(true);

  listSerial();

  new ToastNotification('serialDisconnect'); //popupNotification('serial-disconnect');
}


document.getElementById('serial-list-btn')!.onclick = () => listSerial();

async function listSerial(): Promise<void> {
  const portSelector = <HTMLSelectElement>document.getElementById('port-selector');
  const optionsLen = portSelector.options.length;
  for (let i = optionsLen; i >= 0; i--) { // Remove all "old" ports
    portSelector.remove(i);
  }
  portsAvail = [];
  

  if (navigator.serial) {
    const ports = await navigator.serial.getPorts();
    for (const port of ports) { // List new Ports
      portsAvail.push(new WebSerial(port));
    }
  } else { // Fallback Web USB API, only if Web Serial is not avail
    if (navigator.usb) {
      const ports = await navigator.usb.getDevices();
      for (const port of ports) { // List new Ports
        portsAvail.push(new WebUSBSerial(port));
      }
    }
  }

  let selectIndex = 0;

  for (const index in portsAvail) {
    const option = document.createElement('option');
    option.text = `Port ${index} (${portsAvail[index]?.getInfo()})`;
    portSelector.add(option, parseInt(index));

    const newPort = portsAvail[index]?.getPort();

    if (newPort && serRecorder?.isThisPort(newPort)) {
      selectIndex = parseInt(index);
      option.text = '> ' + option.text;
    }
  }

  const serSettingsElements = document.getElementsByClassName('ser-settings') as HTMLCollectionOf<HTMLInputElement> | HTMLCollectionOf<HTMLSelectElement>;

  if (!portSelector.options.length) {
    const option = document.createElement('option');
    option.text = 'No Ports Available';
    portSelector.add(option);

    for (const element of serSettingsElements) {
      element.disabled = true;
    }
  } else {
    portSelector.selectedIndex = selectIndex;
    
    for (const element of serSettingsElements) {
      element.disabled = false;
    }
  }
}


document.getElementById('serial-add-device')!.onclick = () => requestSerial();

async function requestSerial(): Promise<void> {
  try {
    if (navigator.serial) {
      await navigator.serial.requestPort();
    } else {
      await navigator.usb.requestDevice({
        filters : WebUSBSerial.deviceFilters 
			});
    }
    listSerial();
  } catch(err) {
    console.warn('Aborted adding a new port!', err); // Do nothing.
  }
}


function selectPort(): number {
  const selectedPort = (<HTMLSelectElement>document.getElementById('port-selector')).selectedIndex;
  const newport = portsAvail[selectedPort];

  if (newport) {
    const newPortPort = newport.getPort();

    if (!serRecorder?.isThisPort(newPortPort)) { // serRecorder?.port != newport
      if (serRecorder?.recording) disconnectPort(true); // Important for serial console: Stop recording when opening another device in the console

      serRecorder = new SerialManager(newport);
      clearConsoleLog(); // Clear serial console history

      listSerial(); // Update list to show used port correctly
    }
  }

  return selectedPort;
}


document.getElementById('resume-button')!.onclick = () => startRecord(true, recordingType);
document.getElementById('record-spectrum-btn')!.onclick = () => startRecord(false, 'data');
document.getElementById('record-bg-btn')!.onclick = () => startRecord(false, 'background');

let recordingType: DataType;
let startDate: Date;
let endDate: Date;
let wakeLock: WakeLockSentinel | null;

async function startRecord(pause = false, type: DataType): Promise<void> {
  try {
    selectPort();
    await serRecorder?.startRecord(pause);
  } catch(err) {
    console.error('Connection Error:', err);
    new ToastNotification('serialConnectError'); //popupNotification('serial-connect-error');
    return;
  }

  if (wakeLockAvailable) {
    try {
      wakeLock = await navigator.wakeLock.request('screen'); // Acquire Screen Wake Lock

      document.addEventListener('visibilitychange', async () => {
        if (wakeLock !== null && document.visibilityState === 'visible') {
          // Reacquire wake lock on visibility change (minimizing and maximizing again)
          wakeLock = await navigator.wakeLock.request('screen');
        }
      });
    } catch (err) {
      console.error('Screen Wake Lock Error:', err); // The Wake Lock request has failed - usually system related, such as battery.
    }
  }

  recordingType = type;

  if (!pause) {
    removeFile(type); // Remove old spectrum
    document.getElementById(`${type}-form-label`)!.innerText = 'Serial Recording';
    startDate = new Date();
  }

  (<HTMLInputElement>document.getElementById('toggle-evolution-chart')).disabled = false;
  (<HTMLButtonElement>document.getElementById('stop-button')).disabled = false;
  document.getElementById('pause-button')!.classList.remove('d-none');
  document.getElementById('record-button')!.classList.add('d-none');
  document.getElementById('resume-button')!.classList.add('d-none');

  const spinnerElements = document.getElementsByClassName('recording-spinner');

  for (const ele of spinnerElements) {
    ele.classList.remove('d-none');
  }

  refreshRender(type, !pause); // Start updating the plot
  refreshMeta(type); // Start updating the meta data
  autoSaveData(); // Start data autosaving

  // Check if pause ? Last cps value after pausing is always 0, remove! : Empty if just started to record
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  pause ? cpsValues.pop() : cpsValues = [];

  //plot.updatePlot(spectrumData); // Prevent the plot from moving all over the screen due to other things popping-up
}


document.getElementById('pause-button')!.onclick = () => disconnectPort();
document.getElementById('stop-button')!.onclick = () => disconnectPort(true);

async function disconnectPort(stop = false): Promise<void> {
  document.getElementById('pause-button')!.classList.add('d-none');
  const spinnerElements = document.getElementsByClassName('recording-spinner');

  for (const ele of spinnerElements) {
    ele.classList.add('d-none');
  }

  document.getElementById('resume-button')!.classList.toggle('d-none', stop);

  //(<HTMLInputElement>document.getElementById('toggle-evolution-chart')).disabled = true;

  if (stop) {
    (<HTMLButtonElement>document.getElementById('stop-button')).disabled = true;
    document.getElementById('record-button')!.classList.remove('d-none');

    endDate = new Date();
  }

  wakeLock?.release().then(() => { // Release Screen Wake Lock
    wakeLock = null;
  });

  try {
    clearTimeout(autosaveTimeout);
    clearTimeout(refreshTimeout);
    clearTimeout(metaTimeout);
    clearTimeout(consoleTimeout);
  } catch (err) {
    console.warn('No timeout to clear. Something might be wrong...', err);
  }

  try {
    await serRecorder?.stopRecord();
  } catch(error) {
    // Sudden device disconnect can cause this
    console.error('Misc Serial Read Error:', error);
    new ToastNotification('miscSerialError'); //popupNotification('misc-ser-error');
    launchSysNotification('Recording Crashed!', 'A fatal error occured with the connected serial device and the recording has stopped.');
  }
}


document.getElementById('clear-console-log')!.onclick = () => clearConsoleLog();

function clearConsoleLog(): void {
  document.getElementById('ser-output')!.innerText = '';
  serRecorder?.flushRawData();
}


document.getElementById('serial-console-modal')!.addEventListener('show.bs.modal', (/*event: Event*/): void => { // Adjust Plot Size For Main Tab Menu Content Size
  readSerial();
});

document.getElementById('serial-console-modal')!.addEventListener('hide.bs.modal', async (/*event: Event*/): Promise<void> => { // Adjust Plot Size For Main Tab Menu Content Size
  await serRecorder?.hideConsole();
  clearTimeout(consoleTimeout);
});


async function readSerial(): Promise<void> {
  try {
    const portNumber = selectPort();
    document.getElementById('serial-console-title')!.innerText = `(Port ${portNumber})`;
    await serRecorder?.showConsole();
  } catch(err) {
    console.error('Connection Error:', err);
    new ToastNotification('serialConnectError'); //popupNotification('serial-connect-error');
    return;
  }

  refreshConsole();
}


document.getElementById('ser-command')!.onkeydown = (event) => {
  if (event.key === 'Enter') document.getElementById('send-command')?.click(); // ENTER key
  
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault();
    handleArrowKey(event.key);
  }
  //event.preventDefault();
}


const consoleHistory = {
  history: <string[]>[],
  currentIndex: -1
}

function handleArrowKey(key: string): void {
  const element = <HTMLInputElement>document.getElementById('ser-command');
  if (key === 'ArrowUp' && consoleHistory.currentIndex < consoleHistory.history.length - 1) {
    consoleHistory.currentIndex++;
  } else if (key === 'ArrowDown' && consoleHistory.currentIndex > -1) {
    consoleHistory.currentIndex--;
  }

  if (consoleHistory.currentIndex >= 0 && consoleHistory.currentIndex < consoleHistory.history.length) {
    element.value = consoleHistory.history[consoleHistory.currentIndex];
  } else {
    element.value = '';
  }
}


document.getElementById('send-command')!.onclick = () => sendSerial();

async function sendSerial(): Promise<void> {
  const element = <HTMLInputElement>document.getElementById('ser-command');
  try {
    await serRecorder?.sendString(element.value);
  } catch (err) {
    console.error('Connection Error:', err);
    new ToastNotification('serialConnectError'); //popupNotification('serial-connect-error');
    return;
  }

  // Add message to console history
  const inputValue = element.value.trim();

  if (inputValue.length) {
    consoleHistory.history.unshift(inputValue);
    consoleHistory.currentIndex = -1;
  }

  element.value = '';
}


document.getElementById('reconnect-console-log')!.onclick = () => reconnectConsole();

async function reconnectConsole(): Promise<void> {
  await serRecorder?.hideConsole(); // Same code as closing and re-opening of the console modal
  clearTimeout(consoleTimeout);
  readSerial();
}


let autoscrollEnabled = false;

document.getElementById('autoscroll-console')!.onclick = event => toggleAutoscroll((<HTMLInputElement>event.target).checked);

function toggleAutoscroll(enabled: boolean) {
  autoscrollEnabled = enabled;
  saveJSON('consoleAutoscrollEnabled', autoscrollEnabled);
}


let consoleTimeout: ReturnType<typeof setTimeout>;

function refreshConsole(): void {
  if (serRecorder?.port?.isOpen) {
    document.getElementById('ser-output')!.innerText = serRecorder.getRawData();
    consoleTimeout = setTimeout(refreshConsole, CONSOLE_REFRESH);

    if (autoscrollEnabled) document.getElementById('ser-output')!.scrollIntoView({behavior: 'smooth', block: 'end'});
  }
}


let autosaveTimeout: ReturnType<typeof setTimeout>;

function autoSaveData(): void {
  const autosaveBadgeElement = document.getElementById('autosave-badge')!;
  const data = generateNPES();

  if (data) {
    if(saveJSON('autosave', data)) {
      const formatOptions: Intl.DateTimeFormatOptions = {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        hour12: false, // Set to false for 24-hour format
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


function getRecordTimeStamp(time: number): string {
  const dateTime = new Date(time);
  return addLeadingZero((dateTime.getUTCHours() + (dateTime.getUTCDate() - 1) * 24).toString()) + ':' + addLeadingZero(dateTime.getUTCMinutes().toString()) + ':' + addLeadingZero(dateTime.getUTCSeconds().toString());
}


let metaTimeout: ReturnType<typeof setTimeout>;

function refreshMeta(type: DataType): void {
  if (serRecorder?.port?.isOpen) {
    const nowTime = performance.now();

    const totalTimeElement = document.getElementById('total-record-time')!;

    const totalMeasTime = serRecorder.getTime();

    spectrumData[`${type}Time`] = totalMeasTime; // Update measurementTime in spectrum data
    
    document.getElementById('record-time')!.innerText = getRecordTimeStamp(totalMeasTime);
    const delta = new Date(totalMeasTime);

    const progressBar = document.getElementById('ser-time-progress-bar')!;
    progressBar.classList.toggle('d-none', !maxRecTimeEnabled);

    if (maxRecTimeEnabled) {
      const progressElement = document.getElementById('ser-time-progress')!;
      const progress = Math.round(delta.getTime() / maxRecTime * 100);
      progressElement.style.width = progress + '%';
      progressElement.innerText = progress + '%';
      progressBar.setAttribute('aria-valuenow', progress.toString())

      totalTimeElement.innerText = ' / ' +  getRecordTimeStamp(maxRecTime);
    } else {
      totalTimeElement.innerText = '';
    }

    updateSpectrumTime();

    if (delta.getTime() >= maxRecTime && maxRecTimeEnabled) {
      disconnectPort(true);
      new ToastNotification('autoStop'); //popupNotification('auto-stop');
      launchSysNotification('Recording Stopped!', 'Your desired recording time has expired and the recording has automatically stopped.');
    } else {
      const finishDelta = performance.now() - nowTime;
      metaTimeout = setTimeout(refreshMeta, (REFRESH_META_TIME - finishDelta > 0) ? (REFRESH_META_TIME - finishDelta) : 1, type); // Only re-schedule if still available
    }
  }
}


let lastUpdate = performance.now();
let refreshTimeout: ReturnType<typeof setTimeout>;

function refreshRender(type: DataType, firstLoad = false): void {
  if (serRecorder?.port?.isOpen) {
    const startDelay = performance.now();

    //await serRecorder.stopRecord(); // Maybe?!
    const newData = serRecorder.getData(); // Get all the new data
    const measTime = serRecorder.getTime() ?? 1000;
    //await serRecorder.startRecord(true); // Maybe?!

    if (SerialManager.orderType === 'hist') {
      spectrumData.addHist(type, newData);
    } else if (SerialManager.orderType === 'chron') {
      spectrumData.addPulseData(type, newData, SerialManager.adcChannels);
    }

    spectrumData[`${type}Cps`] = spectrumData[type].map(val => val / measTime * 1000);

    if (firstLoad) {
      plot.resetPlot(spectrumData, cpsValues); // Prevent the overlay going into the toolbar
      bindPlotEvents();
    } else {
      plot.updatePlot(spectrumData, cpsValues);
    }

    const deltaLastRefresh = measTime - lastUpdate;
    lastUpdate = measTime;

    const cpsValue = ((SerialManager.orderType === 'chron') ? newData.length : newData.reduce((acc, curr) => acc+curr, 0)) / deltaLastRefresh * 1000;
    cpsValues.push(cpsValue);

    /* // Only update whenever counts are received
    let cpsValue = 0;

    if (newData.length >= 0) { // Only do whenever new data is received
      const deltaLastRefresh = measTime - lastUpdate;
      lastUpdate = measTime;

      cpsValue = ((SerialManager.orderType === 'chron') ? newData.length : newData.reduce((acc, curr) => acc+curr, 0)) / deltaLastRefresh * 1000;
      cpsValues.push(cpsValue);
    }
    */

    document.getElementById('cps')!.innerText = cpsValue.toFixed(1) + ' cps';

    const mean = cpsValues.reduce((acc, curr) => acc+curr, 0) / cpsValues.length;
    const std = Math.sqrt(cpsValues.reduce((acc, curr) => acc + (curr - mean)**2, 0) / (cpsValues.length - 1));

    document.getElementById('avg-cps')!.innerText = 'Avg: ' + mean.toFixed(1);
    document.getElementById('avg-cps-std')!.innerHTML = ` &plusmn; ${std.toFixed(1)} cps (&#916; ${Math.round(std/mean*100)}%)`;

    updateSpectrumCounts();

    const finishDelta = performance.now() - startDelay;
    refreshTimeout = setTimeout(refreshRender, (refreshRate - finishDelta > 0) ? (refreshRate - finishDelta) : 1, type);
  }
}

/*
=========================================
  SOUNDCARD CONNECTION DATA
=========================================
*/

/*
  STILL A LOT TO DO.
    - See: https://web.dev/articles/media-recording-audio
    - See: https://developer.mozilla.org/en-US/docs/Web/API/MediaStream

  Getting the raw audio data from the mic already works.
  Need to analyze the data now to generate a hist.
*/
/*
let context: AudioContext | null = null;
let worklet: AudioWorkletNode | null = null;
let mediaStream: MediaStream | null = null;
let rawDataArray: Float32Array[] = [];

async function handleSuccess(stream: MediaStream): Promise<void> {
  context = new AudioContext();

  // Get the sample rate of the audio context
  console.log('Sample Rate:', context.sampleRate);

  const source = context.createMediaStreamSource(stream);

  await context.audioWorklet.addModule('/source/webworker/audio-worker.worklet.js'); // MUST BE COMPILED SEPARATELY! See https://github.com/webpack/webpack/issues/11543

  worklet = new AudioWorkletNode(context, 'worklet-processor');

  // Message handler to receive raw audio data from the AudioWorkletProcessor
  worklet.port.onmessage = (event: any) => {
    const rawData: Float32Array = event.data.rawData;
    
    // Process the raw audio data as needed
    // ...

    //console.log('Data:', rawData);

    //const view = new Int32Array(rawData);

    //console.log(view);

    // Store the raw audio data
    rawDataArray.push(rawData);
  };

  source.connect(worklet);
  worklet.connect(context.destination);

  mediaStream = stream;

  console.log('MediaStream', stream);
  console.log('AudioTracks', stream.getAudioTracks());
}


function generateCSV(): void {
  // Flatten the rawDataArray into a single Float32Array
  const flattenedData = new Float32Array(rawDataArray.length * rawDataArray[0].length);
  rawDataArray.forEach((data, index) => flattenedData.set(data, index * data.length));

  // Convert the Float32Array to a CSV string
  const csvContent = flattenedData.join('\n');

  // Create a Blob and trigger a download
  const blob = new Blob([csvContent], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'raw_audio_data.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  // Reset rawDataArray
  rawDataArray = [];
}


document.getElementById('sound-stop-btn')!.onclick = () => stopAudioProcessing();

function stopAudioProcessing(): void {
  if (context && worklet && mediaStream) {
    // Disconnect nodes
    worklet.disconnect();
    context.close();

    // Stop the MediaStream tracks
    mediaStream.getAudioTracks().forEach((track) => track.stop());

    // Save the raw audio data to a CSV file
    generateCSV();

    // Reset variables
    context = null;
    worklet = null;
    mediaStream = null;
    rawDataArray = [];
  }
}


document.getElementById('sound-start-btn')!.onclick = () => openMic();

function openMic(): void {
  navigator.mediaDevices.getUserMedia({ audio: true, video: false }).then(handleSuccess);
}
*/
/*
  LOAD WAV FILE TO TEST DATA PROCESSING
*/
/*
async function readWavFile(file: File): Promise<Float32Array | null> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (event) => {
      const result = event.target?.result as ArrayBuffer;
      const audioContext = new (window.AudioContext || (<any>window).webkitAudioContext)();

      audioContext.decodeAudioData(result, (buffer) => {
        const channelData = buffer.getChannelData(0); // Assuming mono audio

        const float32Array = new Float32Array(channelData);
        resolve(float32Array);
      }, (decodeError) => {
        reject(decodeError);
      });
    };

    reader.onerror = (error) => {
      reject(error);
    };

    reader.readAsArrayBuffer(file);
  });
}


function generateCSV(data: Float32Array, maxLength = 10_000_000): void {
  // Limit the length of the data
  const truncatedData = data.subarray(0, maxLength);

  // Convert the truncated Float32Array to a CSV string
  const csvContent = truncatedData.join('\n');

  // Create a Blob and trigger a download
  const blob = new Blob([csvContent], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'raw_audio_data.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}


function computeMovingAverage(target: number[], length: number): number[] {
  const newData: number[] = Array(target.length);
  const half = Math.round(length/2);

  for (let i = 0; i < newData.length; i++) { // Compute the central moving average
    if (i >= half && i <= target.length - half - 1) { // Shortcut
      const remainderIndexFactor = length % 2;

      const addVal = target[i+half-remainderIndexFactor];
      const removeVal = target[i-half];

      newData[i] = newData[i - 1] + (addVal - removeVal) / length;
      continue; // Skip other computation.
    }

    let val = 0;
    let divider = 0;

    for (let j = 0; j < length; j++) { // Slightly asymetrical to the right with even numbers of smaLength
      if (j < half) {
        if ((i - j) >= 0) {
          val += target[i - j];
          divider++;
        }
      } else {
        if ((i - half+1 + j) < newData.length) {
          val += target[i - half+1 + j];
          divider++;
        }
      }
    }
    newData[i] = val / divider;
  }
  return newData;
}


// Function to map values from 0...1 to 0...4096
function mapToUnsignedIntegers(inputArray: number[]): number[] {
  const newArray: number[] = [];

  for (const value of inputArray) {
      // Scale the floating-point value to the range 0...4096
      const scaledValue = value * 4096 * 2**3;

      // Round the scaled value to the nearest integer
      const roundedValue = Math.round(scaledValue);

      // Store the rounded value in the new array
      newArray.push(roundedValue);
  }

  return newArray;
}


const inputElement = <HTMLInputElement>document.getElementById('audio-input');

inputElement.addEventListener('change', async (event) => {
  const file = (event.target as HTMLInputElement).files?.[0];

  if (file) {
    try {
      const rawData = await readWavFile(file);
      //console.log(rawData);
      
      // Now you can use `rawData` for further analysis or processing

      if (rawData) {
        const desiredLength = 10_000_000; // Specify the desired length to truncate to
        // Truncate the array
        const truncatedArray = new Float32Array(desiredLength);
        truncatedArray.set(rawData.subarray(0, desiredLength)); // Copy elements from the original array

        // truncatedArray now contains the first 1000 elements of the original array
        //console.log(truncatedArray);
        //

        const numArray = Array.from(truncatedArray);

        const a = computeMovingAverage(numArray, 10);
        const b = computeMovingAverage(numArray, 1000);

        let peak = false;
        let max = 0;
        const resultPeaks: number[] = [];

        for (const i in a) {
          const vala = a[i];
          const valb = b[i];

          if (vala > valb) { // Currently a peak
            peak = true;
            const diff = vala - valb;
            if (diff > max) max = diff;
          } else { // Not (anymore) a peak
            if (peak) { // Was a peak previously
              peak = false;
              resultPeaks.push(max); // Push last peak
              max = 0; // Clear peak area
            }
          }
        }

        const lel = mapToUnsignedIntegers(resultPeaks);
        console.log(lel);
        const arr = Array(4096).fill(0);

        for (const val of lel) {
          arr[val]++;
        }

        spectrumData.data = arr;

        plot.updatePlot(spectrumData);
      }

      //if (rawData) generateCSV(rawData);
    } catch (error) {
      console.error('Error reading WAV file:', error);
    }
  }
});
*/