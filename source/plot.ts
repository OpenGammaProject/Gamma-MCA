/*

  Plot spectra using Plotly JS and do some filtering + statistics.

  Gamma MCA: free, open-source web-MCA for gamma spectroscopy
  2022, NuclearPhoenix.- Phoenix1747
  https://nuclearphoenix.xyz

*/

import { SpectrumData, IsotopeList } from './main.js';

export interface CoeffObj {
  c1: number,
  c2: number,
  c3: number,
  [index: string]: number
}

export type PeakModes = 'gaussian' | 'energy' | 'isotopes' | undefined;

interface GaussData {
  dataArray: number[][],
  sigma: number
}

interface Shape {
  type: string;
  xref: string;
  yref: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  editable?: boolean;
  //fillcolor: string,
  line: {
      color: string;
      width: number;
      dash: string;
  };
}

interface Anno {
  x: number;
  y: number;
  xref: string;
  yref: string;
  text: string;
  showarrow: boolean;
  arrowhead: number;
  ax: number;
  ay: number;
  editable?: boolean;
  hovertext: string;
  font: {
    size: number;
  };
}

/*
interface resolutionData {
  start: number, // Start of peak
  end: number, // End of peak
  resolution: number // FWHM of peak in %
}
*/

interface CoeffPoints {
  aFrom: number,
  aTo: number,
  bFrom: number,
  bTo: number,
  cFrom: number | undefined,
  cTo: number | undefined,
  [index: string]: number | undefined
}

interface Trace {
  name: string,
  stackgroup?: string,
  x: number[],
  y: number[],
  type: 'scatter' | 'scattergl',
  yaxis?: string,
  mode: 'lines' | 'markers' | 'lines+markers',
  fill?: string,
  opacity?: number,
  line?: {
    color?: string,
    width?: number,
    shape?: 'linear' | 'hvh',
  },
  marker?: {
    color?: string,
  },
  width?: number
}

/*
  Seek the closest matching isotope by energy from an isotope list
*/
export class SeekClosest {
  isoList: IsotopeList;

  constructor(list: IsotopeList) {
    this.isoList = list;
  }
  
  seek(value: number, maxDist = 100): {energy: number, name: string} | {energy: undefined, name: undefined} {
    // Only allow closest values and disregard undefined
    const closeVals = Object.keys(this.isoList).filter(energy => energy ? (Math.abs(parseFloat(energy) - value) <= maxDist) : false);
    const closeValsNum = closeVals.map(energy => parseFloat(energy)) // After this step there are 100% only numbers left
  
    if (closeValsNum.length) {
      const closest = closeValsNum.reduce((prev, curr) => Math.abs(curr - value) < Math.abs(prev - value) ? curr : prev);
      const endResult = this.isoList[closest];

      if (endResult) return {energy: closest, name: endResult};
    }
    return {energy: undefined, name: undefined};
  }
}

/*
  Plotly.js plot control everything
*/
export class SpectrumPlot {
  readonly plotDiv: HTMLElement | null;
  private showCalChart = false;
  fallbackGL = false;
  xAxis: 'linear' | 'log' = 'linear';
  yAxis: 'linear' | 'log' = 'linear';
  linePlot = false; // 'linear', 'hvh' for 'lines' or 'bar
  downloadFormat = 'png'; // one of png, svg, jpeg, webp
  sma = false; // Simple Moving Average
  smaLength = 8;
  calibration = {
    enabled: false,
    imported: false,
    points: <CoeffPoints>{
      aFrom: 0,
      aTo: 0,
      bFrom: 0,
      bTo: 0,
      cFrom: 0,
      cTo: 0,
    },
    coeff: <CoeffObj>{
      c1: 0,
      c2: 0,
      c3: 0,
    },
  };
  cps = false;
  private shapes: Shape[] = [];
  private annotations: Anno[] = [];
  editableMode = false;
  isoList: IsotopeList = {};
  peakConfig = {
    enabled: false,
    mode: <PeakModes>undefined, // Gaussian Correlation: 0, Energy: 1 and Isotope: 2 modes
    thres: 0.005,
    lag: 50,
    width: 5,
    seekWidth: 2,
    lines: <number[]>[]
  };
  //resolutionValues: resolutionData[] = [];
  gaussSigma = 2;
  private customDownloadModeBar = {
    name: 'downloadPlot',
    title: 'Download plot as HTML',
    icon: (<any>window).Plotly.Icons['disk'],
    direction: 'up',
    click: (plotElement: any) => {
      const newLayout = JSON.parse(JSON.stringify(plotElement.layout));
      newLayout.images[0].source = new URL('/assets/logo.svg', window.location.origin).href;

      const newAnno = {
        x: 1,
        y: 0,
        opacity: 0.9,
        xref: 'paper',
        yref: 'paper',
        xanchor: 'right',
        yanchor: 'bottom',
        text: window.location.origin,
        showarrow: false,
        font: {
          size: 10,
        },
      };
      newLayout.annotations.push(newAnno);

      //let newConfig = JSON.parse(JSON.stringify(plotElement.config));
      //delete newConfig.modeBarButtonsToAdd; // remove this section, otherwise there will be problems!

      const scriptUrl = new URL('/assets/js/external/plotly-basic.min.js', window.location.origin);
      const config = {
        responsive: true,
        displaylogo: false,
        toImageButtonOptions: {
          filename: 'gamma_mca_export',
        }
      };

      const text = `\
      <!DOCTYPE html>
      <!-- Gamma MCA Interactive Export Version 1.1 by NuclearPhoenix. https://spectrum.nuclearphoenix.xyz. -->
      <html>
        <head>
          <meta charset="utf-8">
        </head>
        <body style="margin:0;padding:0">
          <div id="plotly-output" style="width:99vw;height:99vh"></div>
          <script src="${scriptUrl}"></script>
          <script type="text/javascript">Plotly.newPlot('plotly-output',${JSON.stringify(plotElement.data)},${JSON.stringify(newLayout)},${JSON.stringify(config)})</script>
        </body>
      </html>\
      `;

      const element = document.createElement('a');
      element.setAttribute('href', `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`);
      element.setAttribute('download', 'gamma_mca_export.html');
      element.style.display = 'none';
      element.click();
  }};
  gaussValues: GaussData = {
    dataArray: [],
    sigma: 0
  };

  /*
    Constructor
  */
  constructor(divId: string) {
    this.plotDiv = document.getElementById(divId);
    //console.info('Plotly.js version: ' + (<any>window).Plotly.version);
  }
  /*
    Get An Array with Length == Data.length containing ascending numbers
  */
  private getXAxis(len: number): number[] {
    const xArray: number[] = [];
    for (let i = 0; i < len; i++) {
      xArray.push(i);
    }
    return xArray;
  }
  /*
    Delete calibration points and calibration coefficients
  */
  clearCalibration(): void {
    this.calibration.points = <CoeffPoints>{
      aFrom: 0,
      aTo: 0,
      bFrom: 0,
      bTo: 0,
      cFrom: 0,
      cTo: 0,
    };
    this.calibration.coeff = <CoeffObj>{
      c1: 0,
      c2: 0,
      c3: 0,
    };
    this.calibration.imported = false;
  }
  /*
    Compute the coefficients used for calibration
  */
  computeCoefficients(): void {
    const aF = this.calibration.points.aFrom;
    const bF = this.calibration.points.bFrom;
    const cF = this.calibration.points.cFrom ?? -1;
    const aT = this.calibration.points.aTo;
    const bT = this.calibration.points.bTo;
    const cT = this.calibration.points.cTo ?? -1;

    if (cT >= 0 && cF >= 0) { // Pretty ugly hard scripted, could be dynamically calculated for n-poly using Math.js and matrices. Meh.

      const denom = (aF - bF) * (aF - cF) * (bF - cF);
      this.calibration.coeff.c1 = (cF * (bT - aT) + bF * (aT - cT) + aF * (cT - bT)) / denom;
      this.calibration.coeff.c2 = (cF**2 * (aT - bT) + aF**2 * (bT - cT) + bF**2 * (cT - aT)) / denom;
      this.calibration.coeff.c3 = (bF * (bF - cF) * cF * aT + aF * cF * (cF - aF) * bT + aF * (aF - bF) * bF * cT) / denom;

    } else {

      const k = (aT - bT)/(aF - bF);
      const d = aT - k * aF;

      this.calibration.coeff.c1 = 0;
      this.calibration.coeff.c2 = k;
      this.calibration.coeff.c3 = d;
    }
  }
  /*
    Get the calibrated x-axis using the values in this.calibration
  */
  private getCalAxis(len: number): number[] {
    const calArray: number[] = [];

    const a = this.calibration.coeff.c1;
    const k = this.calibration.coeff.c2;
    const d = this.calibration.coeff.c3;

    for (let i = 0; i < len; i++) {
      calArray.push(parseFloat((a * i**2 + k * i + d).toFixed(2)));
    }

    return calArray;
  }
  /*
    Get The Moving Average
  */
  private computeMovingAverage(target: number[], length = this.smaLength): number[] {
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
  /*
    Clear all lines placed by the peak finder
  */
  clearPeakFinder(): void {
    if (this.peakConfig.lines.length) {
      const lines = this.peakConfig.lines
      for (const line of lines) {
        this.toggleLine(line, '', false);
      }
      this.peakConfig.lines = [];
    }
  }
  /*
    Find and mark energy peaks by using two different moving averages
  */
  peakFinder(xAxis: number[], yAxis: number[]): void {
    this.clearPeakFinder();

    const longData = this.computeMovingAverage(yAxis, this.peakConfig.lag);

    const maxVal = Math.max(...yAxis);
    const peakLines: number[] = [];

    const shortLen = yAxis.length;

    for (let i = 0; i < shortLen; i++) {
      if (yAxis[i] - longData[i] > this.peakConfig.thres * maxVal) peakLines.push(xAxis[i]);
    }

    let values: number[] = [];
    peakLines.push(0);

    const peakLen = peakLines.length;

    for (let i = 0; i < peakLen; i++) {
      values.push(peakLines[i]);

      if (Math.abs(peakLines[i + 1] - peakLines[i]) > this.peakConfig.width) {
        let result = 0;
        let size: number;

        if (values.length === 1) {
          result = peakLines[i];
          size = this.peakConfig.seekWidth;
        } else {
          for (const val of values) {
            result += val;
          }
          result /= values.length;
          size = this.peakConfig.seekWidth * (Math.max(...values) - Math.min(...values));
        }

        if (this.peakConfig.mode === 'energy') {
          this.toggleLine(result, result.toFixed(2));
          this.peakConfig.lines.push(result);
        } else if (this.peakConfig.mode === 'isotopes') { // Isotope Mode
          const { energy, name } = new SeekClosest(this.isoList).seek(result, size);
          if (energy && name) {
            this.toggleLine(energy, name);
            this.peakConfig.lines.push(energy);
          }
        }

        values = [];
      }
    }
  }
  /*
    Convenient Wrapper, could do more in the future
  */
  resetPlot(spectrumData: SpectrumData): void {
    this[this.showCalChart ? 'plotCalibration' : 'plotData'](spectrumData, false); // Not Updating
  }
  /*
    Convenient Wrapper, could do more in the future
  */
  updatePlot(spectrumData: SpectrumData): void {
    this[this.showCalChart ? 'plotCalibration' : 'plotData'](spectrumData, true); // Update either spectrum plot or calibration chart
  }
  /*
    Add a line
  */
  toggleLine(energy: number, name: string, enabled = true): void {
    name = name.replaceAll('-',''); // Remove - to save space
    if (enabled) {
      const newLine: Shape = {
        type: 'line',
        xref: 'x',
        yref: 'paper',
        x0: energy,
        y0: 0,
        x1: energy,
        y1: 1,
        //fillcolor: 'black',
        editable: false,
        line: {
          color: 'blue',
          width: .5,
          dash: 'solid'
        },
      };
      const newAnno: Anno = {
        x: parseFloat(energy.toFixed(2)),
        y: 1,
        xref: 'x',
        yref: 'paper',
        text: name,
        showarrow: true,
        arrowhead: 7,
        ax: 0,
        ay: -20,
        editable: false,
        hovertext: energy.toFixed(2),
        font: {
          size: 11,
        },
      };

      for (const shape of this.shapes) {
        if (shape.x0 === newLine.x0) return;
      }

      for (const anno of this.annotations) {
        if (anno.x === newAnno.x) return;
      }

      // Not a duplicate
      this.shapes.push(newLine);
      this.annotations.push(newAnno);
    } else {
      for (const i in this.shapes) {
        if (this.shapes[i].x0 === energy) this.shapes.splice(parseInt(i),1);
      }
      for (const i in this.annotations) {
        if (this.annotations[i].x === parseFloat(energy.toFixed(2))) this.annotations.splice(parseInt(i),1);
      }
    }
  }
  /*
    Clear annotations and shapes
  */
  clearAnnos(): void {
    this.shapes = [];
    this.annotations = [];
  }
  /*
    Toggle the calibration chart on or off
  */
  toggleCalibrationChart(dataObj: SpectrumData, override: boolean): void {
    this.showCalChart = (typeof override === 'boolean') ? override : !this.showCalChart;
    this.showCalChart ? this.plotCalibration(dataObj, false) : this.plotData(dataObj, false); // Needs to be false, otherwise the xaxis range won't update correctly.
  }
  /*
    Compute gaussValues for the Gaussian correlation filter
  */
  computeGaussValues(index: number, xMin: number, xMax: number): number[] {
    const gaussValues: number[] = [];
    for (let k = xMin; k < xMax; k++) {
      gaussValues.push(Math.exp(- k * k / (2 * index)));
    }

    let avg = 0;
    for (const value of gaussValues) {
      avg += value;
    }
    avg /= (xMax - xMin);

    let squaredSum = 0;
    for (const value of gaussValues) {
      squaredSum += (value - avg) * (value - avg);
    }

    for (const index in gaussValues) {
      gaussValues[index] = (gaussValues[index] - avg) / squaredSum;
    }

    return gaussValues;
  }
  /*
    Gaussian correlation filter using the PRA algorithm
  */
  private gaussianCorrel(data: number[], sigma = 2): number[] {
    const correlValues = Array(data.length);
    let computeNew = false;

    // Only compute values once, until other factors change
    if (data.length !== this.gaussValues.dataArray.length || sigma !== this.gaussValues.sigma) {
      this.gaussValues.dataArray = Array(data.length);
      this.gaussValues.sigma = sigma;
      computeNew = true;
    }

    for (let index = 0; index < data.length; index++) {
      const std = Math.sqrt(index);
      const xMin = - Math.round(sigma * std);
      const xMax = Math.round(sigma * std);

      if (computeNew) this.gaussValues.dataArray[index] = this.computeGaussValues(index, xMin, xMax);

      const gaussValues = this.gaussValues.dataArray[index];

      let resultVal = 0;

      for (let k = xMin; k < xMax; k++) {
        resultVal += data[index + k] * gaussValues[k - xMin];
      }

      const value = (resultVal && resultVal > 0 ) ? resultVal : 0;
      correlValues[index] = value;
    }

    const scalingFactor = .8 * Math.max(...data) / Math.max(...correlValues); // Scale GCF values depending on the spectrum data
    correlValues.forEach((value, index, array) => array[index] = value * scalingFactor);

    return correlValues;
  }
  /*
    Plot Calibration Chart
  */
  private plotCalibration(dataObj: SpectrumData, update: boolean): void {
    const trace = {
      name: 'Calibration',
      x: this.getXAxis(dataObj.data.length),
      y: this.getCalAxis(dataObj.data.length),
      mode: 'lines', // Remove lines, "lines", "none"
      fill: 'tozeroy',
      //opacity: 0.8,
      line: {
        color: 'orangered',
        width: 1,
      }
    };

    const markersTrace = {
      name: 'Calibration Points',
      x: <number[]>[],
      y: <number[]>[],
      mode: 'markers+text',
      type: this.fallbackGL ? 'scatter' : 'scattergl', // 'scatter' for SVG, 'scattergl' for WebGL
      marker: {
        symbol: 'cross-thin',
        size: 10,
        color: 'black',
        line: {
          color: 'black',
          width: 2
        }
      },
      text: <string[]>[],
      textposition: 'top',
    };

    if (this.calibration.points) {
      const charArr = ['a', 'b', 'c'];
      for (const index in charArr) {
        const char = charArr[index];
        const fromVar = `${char}From`;
        const toVar = `${char}To`;
        if (fromVar in this.calibration.points && toVar in this.calibration.points) {
          const fromVal = this.calibration.points[fromVar];
          const toVal = this.calibration.points[toVar];
          if (fromVal && toVal) {
            markersTrace.x.push(fromVal);
            markersTrace.y.push(toVal);
            markersTrace.text.push('Point ' + (parseInt(index)+1).toString());
          }
        }
      }
    }

    const maxXValue = trace.x.at(-1) ?? 1;
    const maxYValue = trace.y.at(-1) ?? 1;

    const layout = {
      uirevision: 1,
      autosize: true, // Needed for resizing on update
      title: 'Calibration Chart',
      hovermode: 'x',
      legend: {
        orientation: 'h',
        y: -0.35,
      },
      xaxis: {
        title: 'Bin [1]',
        mirror: true,
        linewidth: 2,
        autorange: false,
        fixedrange: false,
        range: [0,maxXValue],
        rangeslider: {
          borderwidth: 1,
          autorange: false,
          range: [0,maxXValue],
        },
        showspikes: true, //Show spike line for X-axis
        spikethickness: 1,
        spikedash: 'solid',
        spikecolor: 'black',
        spikemode: 'across',
        ticksuffix: '',
        exponentformat: 'SI',
        automargin: true
      },
      yaxis: {
        title: 'Energy [keV]',
        mirror: true,
        linewidth: 2,
        autorange: true,
        fixedrange: false,
        range: [0,maxYValue],
        showspikes: true, //Show spike line for Y-axis
        spikethickness: 1,
        spikedash: 'solid',
        spikecolor: 'black',
        spikemode: 'across',
        showticksuffix: 'last',
        ticksuffix: ' keV',
        showexponent: 'last',
        exponentformat: 'SI',
        automargin: true
      },
      plot_bgcolor: 'white', // Change depending on dark mode
      paper_bgcolor: '#f8f9fa', // Bootstrap bg-light, bg-dark: 212529
      margin: {
        l: 80,
        r: 40,
        b: 60,
        t: 60,
        //pad: 4,
      },
      images: [{
        x: 0.99,
        y: 0.99,
        opacity: 0.4,
        sizex: 0.15,
        sizey: 0.15,
        source: '/assets/logo.svg',
        xanchor: 'right',
        xref: 'paper',
        yanchor: 'top',
        yref: 'paper',
      }],
      annotations: <Anno[]>[]
    };

    const config = {
      responsive: true,
      scrollZoom: false,
      //displayModeBar: true,
      displaylogo: false,
      toImageButtonOptions: {
        format: this.downloadFormat,
        filename: 'gamma_mca_calibration',
      },
      editable: this.editableMode,
      modeBarButtons: <any[][]>[
        ['zoom2d'],
        ['zoomIn2d', 'zoomOut2d'],
        ['autoScale2d', 'resetScale2d'],
        ['toImage'],
        [this.customDownloadModeBar]
      ]
    };

    (<any>window).Plotly[update ? 'react' : 'newPlot'](this.plotDiv, [trace, markersTrace], layout, config);
  }
  /*
    Plot All The Data
  */
  private plotData(dataObj: SpectrumData, update: boolean): void {
    if (this.showCalChart) return; // Ignore this if the calibration chart is currently shown

    const data: Trace[] = [];
    let maxXValue = 0;

    if (dataObj.data.length) {
      const trace: Trace = {
        name: 'Spectrum',
        stackgroup: 'data', // Stack line charts on top of each other

        x: this.getXAxis(dataObj.data.length),
        y: dataObj.data,
        type: this.fallbackGL ? 'scatter' : 'scattergl', // 'scatter' for SVG, 'scattergl' for WebGL
        mode: 'lines', // Remove lines, "lines", "none"
        fill: 'tozeroy',
        //opacity: 0.8,
        line: {
          color: 'orangered',
          width: .5,
          shape: this.linePlot ? 'linear' : 'hvh',
        }
      };

      maxXValue = trace.x.at(-1) ?? 1;
      if (this.cps) trace.y = dataObj.dataCps;
      data.push(trace);
    }

    /*
      Compute Background and Corrected Spectrum
    */
    if (dataObj.background.length) { //== dataObj.data.length)
      const bgTrace: Trace = {
        name: 'Background',
        stackgroup: 'data', // Stack line charts on top of each other

        x: this.getXAxis(dataObj.background.length),
        y: dataObj.background,
        type: this.fallbackGL ? 'scatter' : 'scattergl', // 'scatter' for SVG, 'scattergl' for WebGL
        mode: 'lines', // Remove lines, "lines", "none"
        fill: 'tozeroy',
        //opacity: 1,
        line: {
          color: 'slategrey',
          width: .5,
          shape: this.linePlot ? 'linear' : 'hvh',
        }
      };

      if (bgTrace.x.length > maxXValue) maxXValue = bgTrace.x.at(-1) ?? 1;

      if (this.cps) bgTrace.y = dataObj.backgroundCps;

      if (data.length) {
        const newData: number[] = []; // Compute the corrected data, i.e. data - background

        const dataLen = data[0].y.length;
        for (let i = 0; i < dataLen; i++) {
          newData.push(data[0].y[i] - bgTrace.y[i]);
        }

        data[0].y = newData;
        data[0].fill = 'tonexty'; //'tonextx'
        data[0].name = 'Net Spectrum';
      }

      //data.unshift(bgTrace);
      data.push(bgTrace);
    }
    /*
      Set Simple Moving Average
    */
    if (this.sma) { // SIMPLE MOVING AVERAGE. MAYBE PLOT IT AS DIFFERENT LINE?
      for (const element of data) {
        element.y = this.computeMovingAverage(element.y);
      }
    }

    if (this.xAxis === 'log') maxXValue = Math.log10(maxXValue);
    
    /*
      All The Layout Stuff
    */
    const layout = {
      uirevision: 1,
      autosize: true, // Needed for resizing on update
      title: 'Energy Spectrum',
      hovermode: 'x',
      legend: {
        orientation: 'h',
        y: -0.35,
      },
      selectdirection: 'h',
      /*
      activeselection: {
        fillcolor: 'grey',
        opacity: 0.01
      },
      */
      newselection: {
        line: {
          color: 'red',
          width: 1,
          dash: 'solid'
        }
      },
      xaxis: {
        title: 'Bin [1]',
        mirror: true,
        linewidth: 2,
        autorange: false,
        fixedrange: false,
        range: [0,maxXValue],
        type: this.xAxis, // 'linear' or 'log'
        rangeslider: {
          borderwidth: 1,
          autorange: false,
          range: [0,maxXValue],
        },
        showspikes: true, //Show spike line for X-axis
        spikethickness: 1,
        spikedash: 'solid',
        spikecolor: 'black',
        spikemode: 'across',
        //nticks: 20,
        //tickformat: '.02f',
        ticksuffix: '',
        exponentformat: 'SI',
        automargin: true
      },
      yaxis: {
        title: 'Counts [1]',
        mirror: true,
        linewidth: 2,
        autorange: true,
        fixedrange: false,
        type: this.yAxis, // 'linear' or 'log'
        showspikes: true, //Show spike line for Y-axis
        spikethickness: 1,
        spikedash: 'solid',
        spikecolor: 'black',
        spikemode: 'across',
        showticksuffix: 'last',
        ticksuffix: ' cts',
        //tickformat: '.02f',
        showexponent: 'last',
        exponentformat: 'SI',
        automargin: true
      },
      /*
      yaxis2: {
        overlaying: 'y',
        side: 'right'
      },
      */
      plot_bgcolor: 'white', // Change depending on dark mode
      paper_bgcolor: '#f8f9fa', // Bootstrap bg-light, bg-dark: 212529
      margin: {
        l: 40,
        r: 40,
        b: 60,
        t: 60,
        //pad: 4,
      },
      images: [{
        x: 0.99,
        y: 0.99,
        opacity: 0.4,
        sizex: 0.15,
        sizey: 0.15,
        source: '/assets/logo.svg',
        xanchor: 'right',
        xref: 'paper',
        yanchor: 'top',
        yref: 'paper',
      }],
      shapes: <Shape[]>[],
      annotations: <Anno[]>[],
      //shapes: this.shapes,
      //annotations: JSON.parse(JSON.stringify(this.annotations)), // Copy array but do not reference
    };
    /*
      Set calibrated x-axis
    */
    if (this.calibration.enabled) {
      for (const element of data) {
        element.x = this.getCalAxis(element.x.length);
      }
      layout.xaxis.title = 'Energy [keV]';
      layout.xaxis.ticksuffix = ' keV';

      let newMax = Math.max(data[0]?.x.at(-1) ?? 1, data[1]?.x.at(-1) ?? 1);
      if (this.xAxis === 'log') newMax = Math.log10(newMax);
      layout.xaxis.range = [0,newMax];
      layout.xaxis.rangeslider.range = [0,newMax];
    }
    /*
      CPS enabled
    */
    if (this.cps) {
      layout.yaxis.title = 'Counts Per Second [Hz]';
      layout.yaxis.ticksuffix = ' cps';
    }

    const config = {
      responsive: true,
      scrollZoom: false,
      //displayModeBar: true,
      displaylogo: false,
      toImageButtonOptions: {
        format: this.downloadFormat,
        filename: 'gamma_mca_spectrum',
      },
      editable: this.editableMode,
      modeBarButtons: <any[][]>[
        ['select2d'],
        ['zoom2d'],
        ['zoomIn2d', 'zoomOut2d'],
        ['autoScale2d', 'resetScale2d'],
        ['toImage'],
        [this.customDownloadModeBar]
      ]
    };

    /*
      Peak Detection Stuff
    */
    if (this.peakConfig.enabled && data.length) {
      // Gaussian Correlation Filter
      const gaussData = this.gaussianCorrel(data[0].y, this.gaussSigma);

      const eTrace: Trace = {
        name: 'Gaussian Correlation',
        //stackgroup: 'data', // Stack line charts on top of each other
        x: data[0].x,
        y: gaussData,
        //yaxis: 'y2',
        type: this.fallbackGL ? 'scatter' : 'scattergl', // 'scatter' for SVG, 'scattergl' for WebGL
        mode: 'lines', // Remove lines, "lines", "none"
        //fill: 'tozeroy',
        //opacity: 0.8,
        line: {
          color: 'black',
          width: 0.5,
          shape: this.linePlot ? 'linear' : 'hvh',
        },
        marker: {
          color: 'black',
        }
      };

      this.peakFinder(data[0].x, gaussData);

      data.unshift(eTrace);
    }

    if (!this.peakConfig.enabled || !data.length || data.length >= 3) data.reverse(); // Change/Fix data order

    layout.shapes = this.shapes;
    layout.annotations = JSON.parse(JSON.stringify(this.annotations)); //layout.annotations.concat(JSON.parse(JSON.stringify(this.annotations))); // Copy array but do not reference

    if (this.calibration.enabled) {
      for (const anno of layout.annotations) {
        anno.hovertext += layout.xaxis.ticksuffix;
      }
    }
    
    (<any>window).Plotly[update ? 'react' : 'newPlot'](this.plotDiv, data, layout, config);
  }
}
