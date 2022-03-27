/*

  Gamma MCA: free, open-source web-MCA for gamma spectroscopy
  2022, NuclearPhoenix.- Phoenix1747
  https://nuclearphoenix.xyz

/*

  Possible Future Improvements:
    - Sorting isotope list
    - Save settings with cookies
    - Social media share function
    - Peak Finder/Analyzer
    - (!) Polynomial Calibration!
    - Add serial EOL char selection
    - (!) Simple Serial Console to send commands

  Known Performance Issues:
    - Isotope hightlighting
    - (Un)Selecting all isotopes from gamma-ray energies list
*/

const SpectrumData = function() { // Will hold the measurement data globally.
  this.data = [];
  this.background = [];
  this.dataCps = [];
  this.backgroundCps = [];
};
let spectrumData = new SpectrumData();
let plot = new SpectrumPlot('plot');
let raw = new RawData(1); // 2=raw, 1=hist
let ser = new SerialData();

let calClick = { a: false, b: false };
let oldCalVals = { a: '', b: '' };
let portsAvail = {};

let refreshRate = 1000; // Delay in ms between serial plot updates
let maxRecTimeEnabled = false;
let maxRecTime = 1800000; // 30 mins

let isoListURL = '/assets/isotopes_energies_min.json';
let isoList = {};
let checkNearIso = false;
let maxDist = 100; // Max energy distance to highlight

/*
  Startup of the page
*/
document.body.onload = function() {
  const editPlot = document.getElementById('edit-plot');
  editPlot.checked = plot.editableMode;
  const isoURL = document.getElementById('custom-url');
  const url = window.location.href;
  let domain = new URL(url);
  domain = domain.hostname;

  isoURL.value = domain + isoListURL;

  const fileDeli = document.getElementById('custom-delimiter');
  fileDeli.value = raw.delimiter;
  const fileADCNo = document.getElementById('custom-file-adc');
  fileADCNo.value = raw.adcChannels;
  const serRefresh = document.getElementById('custom-ser-refresh');
  serRefresh.value = refreshRate / 1000; // convert ms to s
  const serBuffer = document.getElementById('custom-ser-buffer');
  serBuffer.value = ser.maxSize;
  const serADCNo = document.getElementById('custom-ser-adc');
  serADCNo.value = ser.adcChannels;
  const autoStop = document.getElementById('ser-limit');
  autoStop.value = maxRecTime / 1000; // convert ms to s
  const stopEnabled = document.getElementById('toggle-time-limit');
  stopEnabled.checked = maxRecTimeEnabled;
  autoStop.disabled = !maxRecTimeEnabled;
  const hoverProx = document.getElementById('iso-hover-prox');
  hoverProx.value = maxDist;

  document.getElementById('smaVal').value = plot.smaLength;
  plot.resetPlot(spectrumData);

  if (!("serial" in navigator)) {
    const serError = document.getElementById('serial-error');
    serError.className = serError.className.replaceAll('visually-hidden', '');

    const serSettingsElements = document.getElementsByClassName('ser-settings');
    for (element of serSettingsElements) { // Disable serial controls
      element.disabled = true;
    }

  } else {
    document.getElementById('serial-div').className = 'visible';
    navigator.serial.addEventListener("connect", serialConnect);
    navigator.serial.addEventListener("disconnect", serialDisconnect);
    listSerial(); // List Available Serial Ports
  }

  bindPlotEvents(); // Bind click and hover events provided by plotly

  const loadingSpinner = document.getElementById('loading');
  loadingSpinner.parentNode.removeChild(loadingSpinner); // Delete Loading Thingymajig

  sizeCheck();
  popupNotification('welcomeMsg');
};


// Needed For Responsiveness! DO NOT REMOVE OR THE LAYOUT GOES TO SHIT!!!
document.body.onresize = function() {
  plot.updatePlot(spectrumData);
  sizeCheck();
  //fixHeight('offbody', 'tabcontent');
};


function getFileData(input, background = false) { // Gets called when a file has been selected.
  if (input.files.length == 0) { // File selection has been canceled
    return;
  }
  const file = input.files[0];
  let reader = new FileReader();

  const fileEnding = file.name.split('.')[1];

  reader.readAsText(file);

  reader.onload = function() {
    const result = reader.result.trim();

    /*
      TODO: FileType über Dateiendung?
    */
    if (background) {
      const bg = raw.csvToArray(result, fileEnding);
      spectrumData.background = bg;
    } else {
      spectrumData.data = raw.csvToArray(result, fileEnding);
    }

    /*
      Error Msg Problem with RAW Stream selection?
    */
    if (!(spectrumData.background.length == spectrumData.data.length || spectrumData.data.length == 0 || spectrumData.background.length == 0)) {
      popupNotification('data-error');
      if (background) { // Remove file again
        removeFile('background');
      } else {
        removeFile('data');
      }
    }

    plot.plotData(spectrumData);
  };

  reader.onerror = function() {
    popupNotification('file-error');
    return;
  };
}

/*
function fixHeight(parentId, contentId) {
  const offsetMargin = 35;
  const parentElement = document.getElementById(parentId);
  const contentElement = document.getElementById(contentId);

  const totalHeight = parentElement.offsetHeight;
  let reservedHeight = 0;

  for (childElement of parentElement.childNodes) {
    if (childElement.id == contentElement.id || childElement.nodeType == 3) {
      continue;
    }
    reservedHeight += childElement.offsetHeight;
  }
  contentElement.style['max-height'] = totalHeight - reservedHeight - offsetMargin + 'px';
  contentElement.style['overflow-y'] = 'scroll';
}
*/

function sizeCheck() {
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = document.documentElement.clientHeight;
  if (viewportWidth < 1230 || viewportHeight < 730) {
    popupNotification('screen-size-warning');
  }
}


function removeFile(id) {
  spectrumData[id] = [];
  document.getElementById(id).value = '';
  plot.resetPlot(spectrumData);

  bindPlotEvents(); // Re-Bind Events for new plot
}


function bindPlotEvents() {
  const myPlot = document.getElementById(plot.divId);
  myPlot.on('plotly_hover', hoverEvent);
  myPlot.on('plotly_unhover', unHover);
  myPlot.on('plotly_click', clickEvent);
}


function selectFileType(button) {
  raw.fileType = button.value;
  raw.valueIndex = button.value;
}


function resetPlot() {
  if (plot.xAxis == 'log'){
    changeAxis(document.getElementById('xAxis'));
  }
  if (plot.yAxis == 'log'){
    changeAxis(document.getElementById('yAxis'));
  }
  if(plot.sma) {
    toggleSma(false, document.getElementById('sma'));
  }
  plot.resetPlot(spectrumData);
}


function changeAxis(button) {
  if (plot[button.id] == 'linear') {
    plot[button.id] = 'log';
    button.innerText = 'Log';
  } else {
    plot[button.id] = 'linear';
    button.innerText = 'Linear';
  }
  plot.updatePlot(spectrumData);
}


function toggleSma(value, thisValue = null) {
  plot.sma = value;
  if (thisValue !== null) {
    thisValue.checked = false;
  }
  plot.updatePlot(spectrumData);
}


function changeSma(input) {
  if (isNaN(parseInt(input.value))) {
    popupNotification('sma-error');
  } else {
    plot.smaLength = parseInt(input.value);
    plot.updatePlot(spectrumData);
  }
}


function hoverEvent(data) {
  const hoverData = document.getElementById('hover_data');
  hoverData.innerText = data.points[0].x.toFixed(2) + data.points[0].xaxis.ticksuffix + ': ' + data.points[0].y.toFixed(2) + data.points[0].yaxis.ticksuffix;

  for (key in calClick) {
    if (calClick[key]) {
      document.getElementById('adc_' + key).value = data.points[0].x.toFixed(2);
    }
  }

  if (checkNearIso) {
    closestIso(data.points[0].x.toFixed(2));
  }
}


function unHover(data) {
  const hoverData = document.getElementById('hover_data');
  hoverData.innerText = 'None';

  for (key in calClick) {
    if (calClick[key]) {
      document.getElementById('adc_' + key).value = oldCalVals[key];
    }
  }

  /*
  if (Object.keys(prevIso).length > 0) {
    closestIso(-maxDist); // Force Reset Iso Highlighting
  }
  */
}


function clickEvent(data) {
  const clickData = document.getElementById('click_data');
  clickData.innerText = data.points[0].x.toFixed(2) + data.points[0].xaxis.ticksuffix + ': ' + data.points[0].y.toFixed(2) + data.points[0].yaxis.ticksuffix;

  for (key in calClick) {
    if (calClick[key]) {
      document.getElementById('adc_' + key).value = data.points[0].x.toFixed(2);
      oldCalVals[key] = data.points[0].x.toFixed(2);
      calClick[key] = false;
      document.getElementById('select_' + key).checked = calClick[key];
    }
  }
}


function toggleCal(enabled = false) {
  /*
    Weird code, use checkbox instead?

    Reset Plot beforehand, to prevent x-range from dying when zoomed?
  */
  if (enabled) {
    const readoutArray = [
      document.getElementById('adc_a').value,
      document.getElementById('adc_b').value,
      document.getElementById('cal_a').value,
      document.getElementById('cal_b').value
    ];

    for (value of readoutArray) {
      if (isNaN(parseFloat(value))) {
        popupNotification('cal-error');
        return;
      }
    }

    plot.calibration.enabled = enabled;

    plot.calibration.aFrom = readoutArray[0];
    plot.calibration.bFrom = readoutArray[1];
    plot.calibration.aTo = readoutArray[2];
    plot.calibration.bTo = readoutArray[3];
  } else {
    plot.calibration.enabled = enabled;
  }
  plot.updatePlot(spectrumData);
}


function toggleCalClick(point, value) {
  calClick[point] = value;
}


function changeType(button) {
  if (plot.plotType == 'scatter') {
    button.innerHTML = '<i class="fas fa-chart-bar"></i> Bar';
    plot.plotType = 'bar';
  } else {
    button.innerHTML = '<i class="fas fa-chart-line"></i> Line';
    plot.plotType = 'scatter';
  }
  plot.updatePlot(spectrumData);
}


function importCal(input) {
  const file = input.files[0];
  let reader = new FileReader();

  reader.readAsText(file);

  reader.onload = function() {
    try {
      const result = reader.result.trim();
      const obj = JSON.parse(result);

      let readoutArray = [
        document.getElementById('adc_a'),
        document.getElementById('cal_a'),
        document.getElementById('adc_b'),
        document.getElementById('cal_b')
      ];

      const inputArr = ['aFrom', 'aTo', 'bFrom', 'bTo'];
      for (index in inputArr) {
        readoutArray[index].value = parseFloat(obj[inputArr[index]]);
      }

      oldCalVals.a = readoutArray[0].value;
      oldCalVals.b = readoutArray[2].value;

    } catch(e) {
      console.log('Calibration Import Error:', e);
      popupNotification('cal-import-error');
    }
  }
}


function addLeadingZero(timeNumber) {
  if (timeNumber < 10) {
    return '0' + timeNumber;
  } else {
    return timeNumber;
  }
}


function getDateString() {
  const time = new Date();
  return time.getFullYear() + addLeadingZero(time.getMonth() + 1) + addLeadingZero(time.getDate()) + addLeadingZero(time.getHours()) + addLeadingZero(time.getMinutes());
}


function downloadCal() {
  filename = 'calibration_' + getDateString() + '.json';
  download(filename, plot.calibration, true);
}


function downloadData(filename, data) {
  filename += '_' + getDateString() + '.csv';

  text = '';
  spectrumData[data].forEach(item => {
    text += item + '\n';
  });

  download(filename, text);
}


function download(filename, text, json=false) {
    var element = document.createElement('a');
    if (json) {
      element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(JSON.stringify(text)));
    } else {
      element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
    }

    element.setAttribute('download', filename);

    element.style.display = 'none';
    document.body.appendChild(element);

    element.click();

    document.body.removeChild(element);
}


function popupNotification(id) {
  // Uses Bootstrap Toasts already defined in HTML
  const element = document.getElementById(id);
  const toast = new bootstrap.Toast(element);
  toast.show();
}


let loadedIsos = false;

async function loadIsotopes() { // Load Isotope Energies JSON ONCE
  if (loadedIsos) { // Isotopes already loaded
    return;
  }

  //fixHeight('offbody', 'tabcontent');
  const options = {
    cache: 'no-cache',
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
    },
  };

  let response = await fetch(isoListURL, options);

  if (response.ok) { // If HTTP-status is 200-299
    const json = await response.json();
    loadedIsos = true;

    const tableElement = document.getElementById('iso-table');

    let intKeys = Object.keys(json);
    intKeys.sort((a, b) => a - b); // Sort Energies numerically

    for (key of intKeys) {
      isoList[key] = json[key];

      const row = tableElement.insertRow();
      const cell1 = row.insertCell(0);
      const cell2 = row.insertCell(1);
      const cell3 = row.insertCell(2);

      cell2.addEventListener('click', function(evnt) {
        try {
          evnt.target.parentNode.firstChild.firstChild.click();
        } catch(e) { // Catch press on <sup> element
          evnt.target.parentNode.parentNode.firstChild.firstChild.click();
        }
      });
      cell3.addEventListener('click', function(evnt) {
        try {
          evnt.target.parentNode.firstChild.firstChild.click();
        } catch(e) { // Catch press on <sup> element
          evnt.target.parentNode.parentNode.firstChild.firstChild.click();
        }
      });

      cell2.style.cursor = 'pointer'; // change cursor pointer
      cell3.style.cursor = 'pointer';

      const energy = parseFloat(key.trim());
      const name = json[key].trim();

      cell1.innerHTML = '<input class="form-check-input" id="' + name + '" type="checkbox" value="' + energy + '" onclick="plotIsotope(this)">';
      cell3.innerText = energy.toFixed(2);

      const strArr = name.split('-');

      cell2.innerHTML = '<sup>' + strArr[1] + '</sup>' + strArr[0];
    }

  } else {
    const isoError = document.getElementById('iso-load-error');
    isoError.innerText = 'Could not load isotope list! Please try again. HTTP Error: ' + response.status;
  }

  try {
    const isoLoading = document.getElementById('iso-loading');
    isoLoading.parentNode.removeChild(isoLoading);
  } catch (e) {
    ; // Do nothing
  }
}


let prevIso = {};

function toggleIsoHover() {
  checkNearIso = !checkNearIso;
  closestIso(-100000);
}


async function closestIso(value) {
  // VERY BAD PERFORMANCE, EXPERIMENTAL FEATURE!
  if (!loadedIsos) { // User has not yet opened the settings panel
    await loadIsotopes();
  }

  const keys = Object.keys(isoList);
  const closeKeys = keys.filter((energy) => {return Math.abs(energy - value) <= maxDist});

  if (closeKeys.length !== 0) {
    let closest = closeKeys.reduce(function(prev, curr) {
      return (Math.abs(curr - value) < Math.abs(prev - value) ? curr : prev);
    });

    plot.toggleLine(Object.keys(prevIso)[0], Object.values(prevIso)[0], false);

    let newIso = {};
    newIso[parseFloat(closest).toFixed(2)] = isoList[closest];

    if (prevIso !== newIso) {
      prevIso = newIso;
    }

    plot.toggleLine(parseFloat(closest).toFixed(2), isoList[closest], true);
    plot.updatePlot(spectrumData);
  } else if (Object.keys(prevIso).length !== 0) {
    plot.toggleLine(Object.keys(prevIso)[0], Object.values(prevIso)[0], false);
    plot.updatePlot(spectrumData);
  }

}


function plotIsotope(checkbox) {
  plot.toggleLine(checkbox.value, checkbox.id, checkbox.checked);
  plot.updatePlot(spectrumData);
}


function selectAll(selectBox) {
  // Bad performance ofc
  const tableElement = selectBox.closest('table');
  const tableBody = tableElement.tBodies[0];
  const tableRows = tableBody.rows;

  for (row of tableRows) {
    const checkBox = row.cells[0].firstChild;
    checkBox.checked = selectBox.checked;
    if (selectBox.checked) {
      plot.toggleLine(checkBox.value, checkBox.id, checkBox.checked);
    }
  }
  if (!selectBox.checked) {
    plot.shapes = [];
    plot.annotations = [];
  }

  plot.updatePlot(spectrumData);
}


function changeSettings(name, value, type) {
  if (typeof value !== type || value == null || value == undefined || (typeof value == 'number' && isNaN(value))) {
    popupNotification('setting-type');
    return;
  }

  switch (name) {
    case 'editMode':
      plot.editableMode = value;
      plot.resetPlot(spectrumData);
      break;

    case 'customURL':
      const pre = document.getElementById('custom-url-pre').innerText;

      try {
        const newUrl = new URL(pre + value);
        isoListURL = newUrl.href;

        loadedIsos = false;
        document.getElementById('iso-table').innerHTML = '';
        loadIsotopes();
      } catch(e) {
        popupNotification('setting-error');
        console.log('Custom URL Error', e);
      }
      break;

    case 'delimiter':
      raw.delimiter = value;
      break;

    case 'fileChannels':
      raw.adcChannels = value;
      break;

    case 'timeLimitBool':
      const a = document.getElementById('ser-limit');
      a.disabled = !value;
      const b = document.getElementById('ser-limit-btn');
      b.disabled = !value;

      maxRecTimeEnabled = value;
      break;

    case 'timeLimit':
      maxRecTime = value * 1000; // convert s to ms
      break;

    case 'hoverProx':
      maxDist = value;
      break;

    case 'plotRefresh':
      refreshRate = value * 1000; // convert s to ms
      break;

    case 'serBuffer':
      ser.maxSize = value;
      break;

    case 'serChannels':
      ser.adcChannels = value;
      break;

    default:
      popupNotification('setting-error');
      return;
  }
  popupNotification('setting-success');
  // Success Toast
}

/*
=========================================
  SERIAL DATA
=========================================
*/

function serialConnect(event) {
  listSerial();
  popupNotification('serial-connect');
};


function serialDisconnect(event) {
  for (key in portsAvail) {
    if (portsAvail[key] == event.target) {
      delete portsAvail[key];
      break;
    }
  }
  if (event.target == ser.port) {
    disconnectPort(true);
  }

  listSerial();

  popupNotification('serial-disconnect');
};


async function listSerial() {
  const portSelector = document.getElementById('port_selector');
  for (index in portSelector.options) { // Remove all "old" ports
    portSelector.remove(index);
  }

  const ports = await navigator.serial.getPorts();

  for (index in ports) { // List new Ports
    portsAvail[index] = ports[index];

    const option = document.createElement("option");
    option.text = 'Port ' + index + ' (Id: ' + ports[index].getInfo().usbProductId + ')';
    portSelector.add(option, index);
  }

  const serSettingsElements = document.getElementsByClassName('ser-settings');

  if (ports.length == 0) {
    const option = document.createElement("option");
    option.text = 'No Ports Available';
    portSelector.add(option, index);

    for (element of serSettingsElements) {
      element.disabled = true;
    }
  } else {
    for (element of serSettingsElements) {
      element.disabled = false;
    }
  }
}


async function requestSerial() {
  try {
    const port = await navigator.serial.requestPort();

    if (Object.keys(portsAvail).length == 0) {
      portsAvail[0] = port;
    } else {
      const keys = Object.keys(portsAvail);
      const max = Math.max(...keys);
      portsAvail[max+1] = port; // Put new port in max+1 index  to get a new, unused number
    }
    listSerial();
  } catch(err) {
    console.log('Aborted adding a new port!', err); // Do nothing.
  }
}


function toggleCps(button, off = false) {
  if (off) { // Override
    plot.cps = false;
  }
  plot.cps = !plot.cps;

  if (plot.cps) {
    button.innerText = 'CPS';
  } else {
    button.innerText = 'Total';
  }
  plot.updatePlot(spectrumData);
}


let keepReading = true;
let reader;
let recordingType = '';
let startTime = 0;
let timeDone = 0;

async function startRecord(pause = false, type = recordingType) {
  try {
    const selector = document.getElementById('port_selector');
    const index = selector.selectedIndex;
    ser.port = portsAvail[index];

    await ser.port.open({ baudRate: 115200 }); // Baud-Rate optional

    keepReading = true; // Reset keepReading
    recordingType = type;

    if (!pause) {
      removeFile(recordingType); // Remove old spectrum
    }

    document.getElementById('export-button').disabled = false;
    document.getElementById('stop-button').disabled = false;
    document.getElementById('pause-button').className = document.getElementById('pause-button').className.replaceAll(' visually-hidden','');
    document.getElementById('record-button').className += ' visually-hidden';
    document.getElementById('resume-button').className += ' visually-hidden';
    document.getElementById('recording-spinner').className = document.getElementById('recording-spinner').className.replaceAll(' visually-hidden','');

    const timer = new Date();
    startTime = timer.getTime();

    refreshRender(recordingType); // Start updating the plot
    refreshMeta(recordingType); // Start updating the meta data

    while (ser.port.readable && keepReading) {
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
        console.log('Misc Serial Read Error:', err);
        popupNotification('misc-ser-error');
      } finally {
        // Allow the serial port to be closed later.
        reader.releaseLock();
        reader = undefined;
      }
    }

    await ser.port.close();
  } catch(err) {
    console.log('Connection Error:', err);
    popupNotification('serial-connect-error');
  }
}


function disconnectPort(stop = false) {
  const nowTime = new Date();
  timeDone += nowTime.getTime() - startTime;

  document.getElementById('pause-button').className += ' visually-hidden';
  document.getElementById('recording-spinner').className += ' visually-hidden';

  if (stop) {
    document.getElementById('stop-button').disabled = true;
    document.getElementById('record-button').className = document.getElementById('record-button').className.replaceAll(' visually-hidden','');
    document.getElementById('resume-button').className += ' visually-hidden';
    recordingType = '';
    timeDone = 0;

    const cpsButton = document.getElementById('plot-cps');
    toggleCps(cpsButton, true); // Disable CPS again
  } else {
    document.getElementById('resume-button').className = document.getElementById('resume-button').className.replaceAll('visually-hidden','');
  }

  keepReading = false;
  ser.flushData(); // Remove all old data

  try {
    if (typeof reader !== undefined) {
      reader.cancel();
    }
  } catch(err) {
    console.log('Nothing to disconnect.', err);
  }
}


function refreshMeta(type) {
  if (ser.port.readable && keepReading) {
    const timeElement = document.getElementById('record-time');
    const nowTime = new Date();
    const delta = new Date(nowTime.getTime() - startTime + timeDone);
    timeElement.innerText = addLeadingZero(delta.getUTCHours()) + ' : ' + addLeadingZero(delta.getUTCMinutes()) + ' : ' + addLeadingZero(delta.getUTCSeconds());

    if (delta > maxRecTime && maxRecTimeEnabled) {
      disconnectPort(true);
      popupNotification('auto-stop');
    } else {
      setTimeout(refreshMeta, 1000, type); // 1s, only re-schedule if still valid
    }
  }
}


let lastUpdate = new Date();

function refreshRender(type) {
  if (ser.port.readable && keepReading) {
    const timeElement = document.getElementById('record-time');
    const nowTime = new Date();
    const delta = new Date(nowTime.getTime() - startTime + timeDone);

    const newData = ser.getData();

    spectrumData[type] = ser.updateData(spectrumData[type], newData); // Depends on Background/Spectrum Aufnahme
    spectrumData[type + 'Cps'] = spectrumData[type].map(val => val/delta.getTime()*1000);

    plot.updatePlot(spectrumData);

    const deltaLastRefresh = new Date(nowTime.getTime() - lastUpdate.getTime());
    lastUpdate = nowTime;

    document.getElementById('cps').innerText = (newData.length/deltaLastRefresh.getTime()*1000).toFixed(1) + ' cps';

    setTimeout(refreshRender, refreshRate, type); // Only re-schedule if still avail
  }
}
