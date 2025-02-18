/*

  Plot spectra using Plotly JS and do some filtering + statistics.

  Gamma MCA: free, open-source web-MCA for gamma spectroscopy
  2022, NuclearPhoenix.- Phoenix1747
  https://nuclearphoenix.xyz

*/

// Import Plotly.js
import Plotly, { Annotations, Config, Data, Layout, PlotlyHTMLElement, Shape } from 'plotly.js-basic-dist-min';

// Import Regression JS
import regression, { DataPoint } from 'regression';

import { SpectrumData, IsotopeList } from './main';

export interface CoeffObj {
  [key: string]: number | undefined;
}

export interface CoeffPoints { // From [number]: To [number]
  [key: number]: number | undefined;
}

export type PeakModes = 'gaussian' | 'energy' | 'isotopes' | undefined;
export type DownloadFormat = 'svg' | 'png' | 'jpeg' | 'webp';

type ChartType = 'default' | 'evolution' | 'calibration';

interface LegacyIsotopeList {
  [key: number]: string | undefined;
}

interface GaussData {
  dataArray: number[][];
  sigma: number;
}

type ShapePlus = Partial<Shape> & {
  type: string;
  xref: string;
  yref: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  line: {
      color: string;
      width: number;
      dash: string;
  };
}

type AnnoPlus = Partial<Annotations> & {
  x: number;
  y: number;
  xref: string;
  yref: string;
  text: string;
  showarrow: boolean;
  arrowhead: number;
  ax: number;
  ay: number;
  hovertext: string;
  font: {
    size: number;
  };
}

type Trace = Partial<Data> & {
  name: string;
  x: number[];
  y: number[];
  type: 'scatter';
  mode: 'lines' | 'markers' | 'lines+markers' | 'text+markers';
  line?: {
    shape?: 'linear' | 'hvh' | 'spline'
  };
  text?: string[];
};

type LayoutPlus = Partial<Layout> & { // Implement stuff from the docs that are not in the Plotly Types?!
  title: {
    text?: string;
  };
  xaxis: {
    autorangeoptions?: {
      minallowed?: number;
    },
    title: {
      text?: string;
    }
  };
  yaxis: {
    autorangeoptions?: {
      minallowed?: number;
    },
    title: {
      text?: string;
    }
  };
  activeselection?: {
    fillcolor?: string;
    opacity?: number;
  };
  newselection?: {
    line?: {
      color?: string;
      width?: number;
      dash?: string;
    };
  };
  annotations: AnnoPlus[];
};

/*
  Seek the closest matching isotope by energy from an isotope list
*/
export class SeekClosest {
  static seekWidth = 2;
  isoList: LegacyIsotopeList;

  constructor(list: IsotopeList) {
    const conversionList: LegacyIsotopeList = {}; // Convert new isotope list to a legacy list that is easier to iterate

    const isotopeEntry = Object.keys(list);
    for (const key of isotopeEntry) {
      const gammaLines = list[key];
      for (const line of gammaLines) {
        conversionList[line] = key;
      }
    }

    this.isoList = conversionList;
  }
  
  seek(value: number, maxDist = SeekClosest.seekWidth): {energy: number, name: string} | {energy: undefined, name: undefined} {
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
  Compute the FWHM and energy resolution of peaks. Takes a list of peaks and the calibrated axis 
*/
export class CalculateFWHM {
  static resolutionLimit = 0.5; // Worst energy res a peak can have before computation just stops for performance reasons; in %
  static fastMode = false; // Better performance by assuming peaks are perfectly symmetrical

  private readonly peakList: number[];
  private readonly calibratedBins: number[];
  private readonly yAxis: number[]
  
  constructor(peakList: number[], calibratedBins: number[], yAxis: number[]) {
    this.peakList = peakList.sort((a, b) => a - b); // Sort numerically
    this.calibratedBins = calibratedBins;
    this.yAxis = yAxis;
  }

  private energyToBin(): number[] {
    const numberOfPeaks = this.peakList.length;
    const axisLength = this.calibratedBins.length;
    const binPeaks: number[] = [];
    let compareIndex = 0;

    for (let i = 0; i < axisLength; i++) {
      const value = this.calibratedBins[i];
      const compareValue = this.peakList[compareIndex];

      if (value > compareValue) {
        binPeaks.push(i); // Can be off by +1, doesn't really matter though.
        compareIndex++;

        if (compareIndex >= numberOfPeaks) break; // All peaks have been found, break the loop
      }
    }

    return binPeaks;
  }

  linearInterp(x1: number, y1: number, x2: number, y2: number, yTarget: number): number {
    const k = (y1 - y2) / (x1 - x2);
    const d = y1 - k * x1;
    return (yTarget - d) / k;
  }

  compute(): {[key: number]: number} {
    const peakBins = this.energyToBin();
    const peakFWHMs: {[key: number]: number} = {};

    for (const index in peakBins) {
      const peakBin = peakBins[index];
      const peakEnergy = this.peakList[index];
      //const peakEnergy = this.calibratedBins[peakBin];
      const limitFWHM = peakEnergy * CalculateFWHM.resolutionLimit;
      const limitMin = peakEnergy - limitFWHM / 2;
      const halfHeight = this.yAxis[peakBin] / 2;

      // Compute FWHM in left direction
      let binLeft = peakBin;
      let energyLeft = this.calibratedBins[binLeft];
      let heightLeft = this.yAxis[binLeft];

      while (energyLeft > limitMin && heightLeft > halfHeight) { // Break if too far away or if under half the height
        binLeft--;
        energyLeft = this.calibratedBins[binLeft];
        heightLeft = this.yAxis[binLeft];
      }

      const fwhmPartLeft = peakEnergy - this.linearInterp(energyLeft, heightLeft, this.calibratedBins[binLeft+1], this.yAxis[binLeft+1], halfHeight);

      if (CalculateFWHM.fastMode) {
        peakFWHMs[peakEnergy] = fwhmPartLeft * 2; // Assume perfectly symmetrical peak and FWHM
        //peakFWHMs.push(fwhmPartLeft * 2); // Assume perfectly symmetrical peak and FWHM
        continue;
      }

      // Compute FWHM in right direction
      const limitMax = peakEnergy + limitFWHM / 2;

      let binRight = peakBin;
      let energyRight = this.calibratedBins[binRight];
      let heightRight = this.yAxis[binRight];

      while (energyRight < limitMax && heightRight > halfHeight) {
        binRight++;
        energyRight = this.calibratedBins[binRight];
        heightRight = this.yAxis[binRight];
      }

      const fwhmPartRight = this.linearInterp(energyRight, heightRight, this.calibratedBins[binRight-1], this.yAxis[binRight-1], halfHeight) - peakEnergy;
      peakFWHMs[peakEnergy] = fwhmPartLeft + fwhmPartRight;
      //peakFWHMs.push(fwhmPartLeft + fwhmPartRight);
    }

    return peakFWHMs;
  }

  getResolution(): {[key: number]: number} {
    const peakFWHMs = this.compute();
    const peakResolutions: {[key: number]: number} = {};

    for (const [stringPeakEnergy, fwhm] of Object.entries(peakFWHMs)) {
      const peakEnergy = parseFloat(stringPeakEnergy);
      
      peakResolutions[peakEnergy] = fwhm / peakEnergy;
      //peakResolutions.push(fwhm / peakEnergy);
    }

    return peakResolutions;
  }
}

/*
  Plotly.js plot control everything
*/
export class SpectrumPlot {
  readonly plotDiv: HTMLElement | null;
  private type: ChartType = 'default';
  xAxis: 'linear' | 'log' = 'linear';
  yAxis: 'linear' | 'log' = 'linear';
  linePlot = false; // 'linear', 'hvh' for 'lines' or 'bar
  downloadFormat: DownloadFormat = 'png';
  darkMode = false;
  private plotBgDark = '#3f4448';
  private plotBgLight = '#ffffff';
  private paperBgDark = '#212529';
  private paperBgLight = '#ffffff';
  private fontColorLight = '#444444';
  private fontColorDark = '#dee2e6';
  private gridColorLight = '#eeeeee';
  private gridColorDark = '#515151';
  private annoBgLight = 'rgba(255,255,255,0.4)';
  private annoBgDark = 'rgba(0,0,0,0.4)';
  cpsSwitchLimit = 1; // Limit of cps below which plot will switch to cpm
  evolutionPointLimit = 10_000; // Limits the number of points for the evolution chart to help performance
  sma = false; // Simple Moving Average
  smaLength = 8;
  calibration = {
    enabled: false,
    imported: false,
    points: <CoeffPoints>{},
    coeff: <CoeffObj>{
      c1: 0,
      c2: 0,
    },
  };
  cps = false;
  enhanceEfficiency = false;
  private shapes: ShapePlus[] = [];
  private annotations: AnnoPlus[] = [];
  editableMode = false;
  isotopeSeeker: SeekClosest | undefined;
  peakConfig = {
    enabled: false,
    mode: <PeakModes>undefined, // Gaussian Correlation: 0, Energy: 1 and Isotope: 2 modes
    thres: 0.008,
    lag: 50,
    showFWHM: true,
    newPeakStyle: true,
    lines: <number[]>[]
  };
  gaussSigma = 2;
  private customExportButton = {
    name: 'exportPlot',
    title: 'Export plot as HTML',
    icon: Plotly.Icons.disk,
    direction: 'up',
    click: (plotElement: PlotlyHTMLElement) => {
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

      const scriptUrl = new URL('https://cdnjs.cloudflare.com/ajax/libs/plotly.js/2.35.3/plotly-basic.min.js', window.location.origin);
      const config = {
        responsive: true,
        displaylogo: false,
        toImageButtonOptions: {
          filename: 'gamma_mca_export',
        }
      };

      const text = `\
      <!DOCTYPE html>
      <!-- Gamma MCA Interactive Export Version 1.2 by NuclearPhoenix. https://spectrum.nuclearphoenix.xyz. -->
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
  private customFullscreenButton = {
    name: 'fullscreen',
    title: 'Toggle Fullscreen',
    icon: Plotly.Icons.drawrect,
    direction: 'up',
    click: (plotElement: PlotlyHTMLElement) => {
      plotElement.classList.toggle('fullscreen');
      Plotly.update(plotElement, {}, {});
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
  }
  /*
    Get An Array with Length == Data.length containing ascending numbers
  */
  private getXAxis(len: number, step: number = 1): number[] {
    const xArray: number[] = [];
    for (let i = 0; i < len; i += step) {
      xArray.push(i);
    }
    return xArray;
  }
  /*
    Delete calibration points and calibration coefficients
  */
  clearCalibration(): void {
    this.calibration.points = <CoeffPoints>{};
    this.calibration.coeff = <CoeffObj>{
      c1: 0,
      c2: 0,
    };
    this.calibration.imported = false;
  }
  /*
    Compute the coefficients used for calibration
  */
  async computeCoefficients(): Promise<void> {
    const data: DataPoint[] = [];

    for (const [bin, energy] of Object.entries(this.calibration.points)) {
      data.push([parseFloat(bin), energy]);
    }

    const result = regression.polynomial(data, { order: data.length - 1, precision: 10 });
    const terms = result.equation.reverse();
    
    for (let i = 0; i < data.length; i++) {
      this.calibration.coeff[`c${i+1}`] = terms[i];
    }
  }
  /*
    Get the calibrated x-axis using the values in this.calibration
  */
  getCalAxis(len: number): number[] {
    const calArray: number[] = [];

    for (let i = 0; i < len; i++) {
      let val = 0;

      for (let j = 0; j < Object.keys(this.calibration.coeff).length; j++) {
        const c = this.calibration.coeff[`c${j+1}`] ?? 0;
        val += c * i ** j;
      }

      calArray.push(val);
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
    Show any peaks that have been found by marking in the plot
  */
  private drawPeakFinder(xAxis: number[], peakArray: number[], heightAxis: number[]): void {
    for (let result of peakArray) {
      const resultBin = Math.round(result);
      const height = heightAxis[resultBin];
      if (this.calibration.enabled) result = xAxis[resultBin];

      if (height >= 0) {
        if (this.peakConfig.mode === 'energy') {
          this.toggleLine(result, Math.round(result).toString(), true, height);
          this.peakConfig.lines.push(result);
        } else if (this.peakConfig.mode === 'isotopes') { // Isotope Mode
          if (!this.isotopeSeeker) throw 'No isotope seeker found!';

          const { energy, name } = this.isotopeSeeker.seek(result/*, size*/);
          if (energy && name) {
            this.toggleLine(energy, name, true, height);
            this.peakConfig.lines.push(energy);
          }
        }
      }
    }
  }
  /*
    Find peaks in the height data by using two different moving averages
  */
  peakFinder(heightData: number[]): number[] {
    this.clearPeakFinder();

    const blankXAxis = this.getXAxis(heightData.length);

    const longData = this.computeMovingAverage(heightData, this.peakConfig.lag);

    const maxVal = Math.max(...heightData);
    const peakLines: number[] = [];

    const shortLen = heightData.length;

    for (let i = 0; i < shortLen; i++) {
      if (heightData[i] - longData[i] > this.peakConfig.thres * maxVal) peakLines.push(blankXAxis[i]);
    }

    let values: number[] = [];
    peakLines.push(0);

    const peakLen = peakLines.length;

    const peakArray: number[] = [];

    for (let i = 0; i < peakLen; i++) {
      values.push(peakLines[i]);

      if (Math.abs(peakLines[i + 1] - peakLines[i]) > 2) { // Check if adjacent bins, i.e. one connected peak
        let result = 0;

        if (values.length === 1) {
          result = peakLines[i];
        } else {
          for (const val of values) {
            result += val;
          }
          result /= values.length;
        }

        peakArray.push(result);

        values = [];
      }
    }

    return peakArray;
  }
  /*
    Convenient Wrapper, could do more in the future
  */
  resetPlot(spectrumData: SpectrumData, cpsValues: number[] = []): void {
    if (this.type === 'calibration') this.plotCalibration(spectrumData, false); // Plot calibration chart
    if (this.type === 'evolution') this.plotEvolution(cpsValues, false); // Plot radiation evolution chart

    this.plotData(spectrumData, false); // Update the default spectrum plot
  }
  /*
    Convenient Wrapper, could do more in the future
  */
  updatePlot(spectrumData: SpectrumData, cpsValues: number[] = []): void {
    if (this.type === 'calibration') this.plotCalibration(spectrumData, true); // Plot calibration chart
    if (this.type === 'evolution') this.plotEvolution(cpsValues, true); // Plot radiation evolution chart

    this.plotData(spectrumData, true); // Update the default spectrum plot
  }
  /*
    Add a line
  */
  toggleLine(energy: number, name: string, enabled = true, height = -1): void {
    //name = name.replaceAll('-',''); // Remove - to save space
    const hovertext = energy.toFixed(2);

    if (enabled) {
      const newLine: ShapePlus = {
        type: 'line',
        xref: 'x',
        yref: 'paper',
        x0: energy,
        y0: 0,
        x1: energy,
        y1: 1,
        //fillcolor: 'black',
        line: {
          color: 'blue',
          width: 0.8,
          dash: 'dot'
        },
        opacity: 0.66
      };
      const newAnno: AnnoPlus = {
        x: this.xAxis === 'log' ? Math.log10(energy) : energy,
        y: 1,
        xref: 'x',
        yref: 'paper',
        text: name,
        showarrow: true,
        arrowcolor: this.darkMode ? this.fontColorDark : this.fontColorLight,
        arrowhead: 7,
        ax: 0,
        ay: -20,
        hovertext: hovertext,
        font: {
          size: 11,
        },
      };

      if (height >= 0 && this.peakConfig.newPeakStyle) {
        //newLine.yref = 'y';
        newLine.y0 = 0;
        //newLine.y1 = height;
        newLine.y1 = 0;
        newLine.line.width = 0;
        //newLine.line.width = 2;

        newAnno.y = (this.yAxis === 'log' ? Math.log10(height) : height) * 1.03;
        newAnno.yref = 'y';
        newAnno.arrowhead = 1;
        newAnno.arrowsize = 0.8;
        newAnno.ay = -40;
        newAnno.bgcolor = this.darkMode ? this.annoBgDark : this.annoBgLight;
      }

      for (const shape of this.shapes) {
        if (shape.x0 === newLine.x0) return;
      }

      for (const anno of this.annotations) {
        if (anno.hovertext === newAnno.hovertext) return;
      }

      // Not a duplicate
      this.shapes.push(newLine);
      this.annotations.push(newAnno);
    } else {
      for (const i in this.shapes) {
        if (this.shapes[i].x0 === energy) this.shapes.splice(parseInt(i),1);
      }
      for (const i in this.annotations) {
        if (this.annotations[i].hovertext === hovertext) this.annotations.splice(parseInt(i),1);
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
    Switch between different chart types
  */
  setChartType(type: ChartType, dataObj: SpectrumData, cpsValues: number[] = []): void {
    this.type = type;

    switch (type) {
      case 'evolution': {
        this.plotEvolution(cpsValues, false)
        break;
      }
      case 'calibration': {
        this.plotCalibration(dataObj, false)
        break;
      }
      default: {
        this.plotData(dataObj, false);
      }
    }
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
    Limit array size by decreasing resolution/number of points to boost performance of plot refreshs
  */
  private limitArraySize(originalArray: number[], targetSize: number): number[] {
    if (targetSize <= 1) {
      return originalArray; // The original array is small enough to be printed without reducing resolution
    }
  
    const resultArray: number[] = [];
    const originalSize = originalArray.length;
  
    for (let i = 0; i < originalSize; i += targetSize) {
      const chunk = originalArray.slice(i, i + targetSize);
      const average = chunk.reduce((sum, value) => sum + value, 0) / chunk.length;
      resultArray.push(average);
    }
  
    return resultArray;
  }
  /*
    Plot Radiation Evolution Chart
  */
  private plotEvolution(cpsValues: number[], update: boolean): void {
    if (!this.plotDiv) return; // No valid HTMLElement for the plot to show

    const targetSize = Math.ceil(cpsValues.length / this.evolutionPointLimit);
    const xAxis = this.getXAxis(cpsValues.length, targetSize);
    const yAxis = this.limitArraySize(cpsValues, targetSize);

    const trace: Trace = {
      name: 'Radiation Evolution',
      x: xAxis,
      y: yAxis,
      mode: 'lines',
      type: 'scatter',
      //fill: 'tozeroy',
      //opacity: 0.8,
      line: {
        color: 'orangered',
        width: 1.5,
        shape: 'spline'
      }
    };

    const averageTrace: Trace = {
      name: 'Moving Average',
      x: xAxis,
      y: this.computeMovingAverage(yAxis),
      mode: 'lines',
      type: 'scatter',
      //fill: 'tozeroy',
      //opacity: 0.8,
      line: {
        color: 'darkblue',
        width: 2,
        shape: 'spline'
      }
    };

    const layout: LayoutPlus = {
      uirevision: 1,
      autosize: true, // Needed for resizing on update
      title: {
        text: 'Radiation Evolution',
      },
      hovermode: 'x',
      legend: {
        orientation: 'h',
        y: -0.35
      },
      xaxis: {
        title: {
          text: 'Data Point [1]'
        },
        mirror: true,
        linewidth: 2,
        autorange: true,
        autorangeoptions: {
          minallowed: 0
        },
        rangeslider: {
          borderwidth: 1
        },
        showspikes: true, //Show spike line for X-axis
        spikethickness: 1,
        spikedash: 'solid',
        spikecolor: 'blue',
        spikemode: 'across',
        ticksuffix: '',
        hoverformat: ',.2~f',
        exponentformat: 'none',
        automargin: true,
        gridcolor: this.darkMode ? this.gridColorDark : this.gridColorLight
      },
      yaxis: {
        title: {
         text: 'Counts Per Second [s<sup>-1</sup>]' 
        },
        mirror: true,
        linewidth: 2,
        autorange: true,
        showspikes: true, //Show spike line for Y-axis
        spikethickness: 1,
        spikedash: 'solid',
        spikecolor: 'blue',
        spikemode: 'across',
        showticksuffix: 'last',
        ticksuffix: 'cps',
        //tickformat: '.02s',
        hoverformat: '.4~s',
        //showexponent: 'last',
        exponentformat: 'SI',
        automargin: true,
        gridcolor: this.darkMode ? this.gridColorDark : this.gridColorLight
      },
      plot_bgcolor: this.darkMode ? this.plotBgDark : this.plotBgLight,
      paper_bgcolor: this.darkMode ? this.paperBgDark : this.paperBgLight,
      font: {
        color:  this.darkMode ? this.fontColorDark : this.fontColorLight,
      },
      margin: {
        l: 40,
        r: 40,
        b: 50,
        t: 55,
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
      annotations: []
    };

    const config: Partial<Config> = {
      responsive: true,
      scrollZoom: false,
      //displayModeBar: true,
      displaylogo: false,
      toImageButtonOptions: {
        format: this.downloadFormat,
        filename: 'gamma_mca_evolution',
      },
      editable: this.editableMode,
      modeBarButtons: [
        ['zoom2d'],
        ['zoomIn2d', 'zoomOut2d'],
        ['autoScale2d', 'resetScale2d'],
        ['toImage'],
        [this.customExportButton],
        [this.customFullscreenButton]
      ]
    };

    Plotly[update ? 'react' : 'newPlot'](this.plotDiv, [trace, averageTrace], layout, config);
  }
  /*
    Plot Calibration Chart
  */
  private plotCalibration(dataObj: SpectrumData, update: boolean): void {
    if (!this.plotDiv) return; // No valid HTMLElement for the plot to show

    let axisSize = dataObj.data.length;

    if (Object.keys(this.calibration.points).length) {
      const maxBin = Object.keys(this.calibration.points).reduce((max, c) => parseFloat(c) > parseFloat(max) ? c : max);
      axisSize = Math.max(dataObj.data.length, parseFloat(maxBin)) + 1;
    }

    const trace: Trace = {
      name: 'Calibration',
      x: this.getXAxis(axisSize),
      y: this.getCalAxis(axisSize),
      mode: 'lines', // Remove lines, "lines", "none"
      type: 'scatter',
      fill: 'tozeroy',
      //opacity: 0.8,
      line: {
        color: 'orangered',
        width: 1,
      }
    };

    const markersTrace: Trace = {
      name: 'Calibration Points',
      x: [],
      y: [],
      mode: 'text+markers',
      type: 'scatter',
      marker: {
        //symbol: 'cross-thin',
        size: 8,
        color: '#444444',
        //line: {
        //  color: 'black',
        //  width: 2
        //}
      },
      text: [],
      textposition: 'top center',
    };

    let index = 0;

    for (const [bin, energy] of Object.entries(this.calibration.points)) {
      markersTrace.x.push(parseFloat(bin));
      markersTrace.y.push(energy);
      markersTrace.text?.push(`Point ${index+1}`);
      index++;
    }

    const layout: LayoutPlus = {
      uirevision: 1,
      autosize: true, // Needed for resizing on update
      title: {
        text: 'Calibration',        
      },
      hovermode: 'x',
      legend: {
        orientation: 'h',
        y: -0.35,
      },
      xaxis: {
        title: {
          text: 'Bin [1]'
        },
        mirror: true,
        linewidth: 2,
        autorange: true,
        autorangeoptions: {
          minallowed: 0
        },
        rangeslider: {
          borderwidth: 1
        },
        showspikes: true, //Show spike line for X-axis
        spikethickness: 1,
        spikedash: 'solid',
        spikecolor: 'blue',
        spikemode: 'across',
        ticksuffix: '',
        hoverformat: ',.2~f',
        exponentformat: 'none',
        automargin: true,
        gridcolor: this.darkMode ? this.gridColorDark : this.gridColorLight
      },
      yaxis: {
        title: {
          text: 'Energy [keV]'
        },
        mirror: true,
        linewidth: 2,
        autorange: true, //'max',
        autorangeoptions: {
          minallowed: 0
        },
        //range: [0, null],
        showspikes: true, //Show spike line for Y-axis
        spikethickness: 1,
        spikedash: 'solid',
        spikecolor: 'blue',
        spikemode: 'across',
        showticksuffix: 'last',
        ticksuffix: ' keV',
        showexponent: 'last',
        exponentformat: 'none',
        hoverformat: ',.2~f',
        automargin: true,
        gridcolor: this.darkMode ? this.gridColorDark : this.gridColorLight
      },
      plot_bgcolor: this.darkMode ? this.plotBgDark : this.plotBgLight,
      paper_bgcolor: this.darkMode ? this.paperBgDark : this.paperBgLight,
      font: {
        color:  this.darkMode ? this.fontColorDark : this.fontColorLight,
      },
      margin: {
        l: 40,
        r: 40,
        b: 50,
        t: 55,
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
      annotations: []
    };

    const config: Partial<Config> = {
      responsive: true,
      scrollZoom: false,
      //displayModeBar: true,
      displaylogo: false,
      toImageButtonOptions: {
        format: this.downloadFormat,
        filename: 'gamma_mca_calibration',
      },
      editable: this.editableMode,
      modeBarButtons: [
        ['zoom2d'],
        ['zoomIn2d', 'zoomOut2d'],
        ['autoScale2d', 'resetScale2d'],
        ['toImage'],
        [this.customExportButton],
        [this.customFullscreenButton]
      ]
    };

    Plotly[update ? 'react' : 'newPlot'](this.plotDiv, [trace, markersTrace], layout, config);
  }
  /*
    Compute data for pulse height histogram with cps, sma, gauss filter and others
  */
  computePulseHeightData(dataObj: SpectrumData): Trace[] {
    const data: Trace[] = [];

    if (dataObj.data.length) {
      const trace: Trace = {
        name: 'Spectrum',
        stackgroup: 'data', // Stack line charts on top of each other

        x: this.getXAxis(dataObj.data.length),
        y: dataObj.data,
        type: 'scatter',
        mode: 'lines', // Remove lines, "lines", "none"
        fill: this.linePlot ? 'none' : 'tonexty',
        //opacity: 0.8,
        line: {
          color: 'orangered',
          width: 1,
          shape: this.linePlot ? 'linear' : 'hvh',
        }
      };

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
        type: 'scatter',
        mode: 'lines', // Remove lines, "lines", "none"
        fill: this.linePlot ? 'none' : 'tonexty',
        //opacity: 1,
        line: {
          color: 'slategrey',
          width: 1,
          shape: this.linePlot ? 'linear' : 'hvh',
        }
      };

      if (this.cps) bgTrace.y = dataObj.backgroundCps;

      if (data.length) {
        const newData: number[] = []; // Compute the corrected data, i.e. data - background

        const dataLen = data[0].y.length;
        for (let i = 0; i < dataLen; i++) {
          newData.push(data[0].y[i] - bgTrace.y[i]);
        }

        data[0].y = newData;
        //data[0].fill = this.linePlot ? 'none' : 'tonexty'; //'tonextx'
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

    /*
      Energy calibration enabled
    */
    if (this.calibration.enabled) {
      for (const element of data) {
        element.x = this.getCalAxis(element.x.length);
      }
    }

    /*
      Qualitative enhancement of detector efficiency
    */
    if (this.enhanceEfficiency) {
      for (const element of data) {
        const coeffArr: number[] = [];
        for (const value of element.x) {
          coeffArr.push(0.00002 * value ** 2 + 0.0045 * value + 0.22);
        }

        const newData: number[] = [];
        for (const index in element.y) {
          newData.push(element.y[index] * coeffArr[index]);
        }

        element.y = newData;
      }
    }

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
        type: 'scatter',
        mode: 'lines', // Remove lines, "lines", "none"
        //fill: 'tozeroy',
        //opacity: 0.8,
        line: {
          color: 'black',
          width: 0.6,
          shape: this.linePlot ? 'linear' : 'hvh',
        },
        marker: {
          color: 'black',
        }
      };

      data.unshift(eTrace);
    }

    return data;
  }
  /*
    Plot All The Data
  */
  private plotData(dataObj: SpectrumData, update: boolean): void {
    if (!this.plotDiv) return; // No valid HTMLElement for the plot to show
    if (this.type !== 'default') return; // Ignore this if the calibration chart is currently shown

    /*
      All The Layout Stuff
    */
    const layout: LayoutPlus = {
      uirevision: 1,
      autosize: true, // Needed for resizing on update
      title: {
        text: 'Energy Spectrum',
      },
      hovermode: 'x',
      legend: {
        orientation: 'h',
        y: -0.35,
      },
      selectdirection: 'h',
      activeselection: {
        fillcolor: 'blue',
        opacity: 0.01
      },
      newselection: {
        line: {
          color: 'blue',
          width: 1,
          dash: 'solid'
        }
      },
      xaxis: {
        title: {
          text: 'Bin [1]'
        },
        mirror: true,
        linewidth: 2,
        autorange: true,
        autorangeoptions: {
          minallowed: 0
        },
        type: this.xAxis, // 'linear' or 'log'
        rangeslider: {
          borderwidth: 1
        },
        showspikes: true, //Show spike line for X-axis
        spikethickness: 1,
        spikedash: 'solid',
        spikecolor: 'blue',
        spikemode: 'across',
        //nticks: 20,
        //tickformat: '.01f',
        hoverformat: ',.2~f',
        ticksuffix: '',
        exponentformat: 'none',
        automargin: true,
        gridcolor: this.darkMode ? this.gridColorDark : this.gridColorLight
      },
      yaxis: {
        title: {
          text: 'Counts [1]'
        },
        mirror: true,
        linewidth: 2,
        autorange: true,
        fixedrange: false,
        type: this.yAxis, // 'linear' or 'log'
        //showspikes: true, //Show spike line for Y-axis
        //spikethickness: 1,
        //spikedash: 'solid',
        //spikecolor: 'blue',
        //spikemode: 'across',
        showticksuffix: 'last',
        ticksuffix: 'cts',
        //tickformat: '.02s',
        hoverformat: '.4~s',
        //showexponent: 'last',
        exponentformat: 'SI',
        automargin: true,
        gridcolor: this.darkMode ? this.gridColorDark : this.gridColorLight
      },
      /*
      yaxis2: {
        overlaying: 'y',
        side: 'right'
      },
      */
      plot_bgcolor: this.darkMode ? this.plotBgDark : this.plotBgLight,
      paper_bgcolor: this.darkMode ? this.paperBgDark : this.paperBgLight,
      font: {
        color:  this.darkMode ? this.fontColorDark : this.fontColorLight,
      },
      margin: {
        l: 40,
        r: 40,
        b: 50,
        t: this.peakConfig.newPeakStyle ? 55 : 80,
        //autoexpand: true
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
      shapes: [],
      annotations: [],
      //shapes: this.shapes,
      //annotations: JSON.parse(JSON.stringify(this.annotations)), // Copy array but do not reference
    };
    /*
      Set calibrated x-axis
    */
    if (this.calibration.enabled) {
      layout.xaxis.title.text = 'Energy [keV]';
      layout.xaxis.ticksuffix = ' keV';
    }

    const config: Partial<Config> = {
      responsive: true,
      scrollZoom: false,
      //displayModeBar: true,
      displaylogo: false,
      toImageButtonOptions: {
        format: this.downloadFormat,
        filename: 'gamma_mca_spectrum',
      },
      editable: this.editableMode,
      modeBarButtons: [
        ['select2d'],
        ['zoom2d'],
        ['zoomIn2d', 'zoomOut2d'],
        ['autoScale2d', 'resetScale2d'],
        ['toImage'],
        [this.customExportButton],
        [this.customFullscreenButton]
      ]
    };

    const data = this.computePulseHeightData(dataObj); // Get all trace data

    /*
      CPS enabled
    */
    if (this.cps) {
      if (data.length > 0) { // Check before, otherwise it will crash recordings instantly when they start!
        if (Math.max(...data[0].y) < this.cpsSwitchLimit) { // Less than 1 cps at max, switch to cpm
          for (const trace of data) {
            trace.y = trace.y.map(value => value * 60);
          }
          layout.yaxis.title.text = 'Counts Per Minute [60 s<sup>-1</sup>]';
          layout.yaxis.ticksuffix = 'cpm';
        } else { // Enough counts for cpm
          layout.yaxis.title.text = 'Counts Per Second [s<sup>-1</sup>]';
          layout.yaxis.ticksuffix = 'cps';
        }
      }
    }

    /*
      Peak Detection Stuff
    */
    if (this.peakConfig.enabled && data.length > 1) {
      const gaussDataX = data[0].x; // Gauss data will always be the first trace
      const gaussDataY = data[0].y;

      const peaks = this.peakFinder(gaussDataY);
      this.drawPeakFinder(gaussDataX, peaks, data[1].y);

      if (this.peakConfig.showFWHM) {
        const peakResolutions = new CalculateFWHM(this.peakConfig.lines, data[1].x, data[1].y).getResolution();
        
        for (const anno of this.annotations) {
          const fwhmValue = peakResolutions[anno.x];
          
          if (fwhmValue > 0 && fwhmValue < 0.9 * CalculateFWHM.resolutionLimit) anno.text += `<br>${(fwhmValue * 100).toFixed(1)}%`;
        }
      }
    }

    if (!this.peakConfig.enabled || !data.length || data.length >= 3) data.reverse(); // Change/Fix data order

    layout.shapes = this.shapes;
    layout.annotations = JSON.parse(JSON.stringify(this.annotations)); //layout.annotations.concat(JSON.parse(JSON.stringify(this.annotations))); // Copy array but do not reference

    if (this.calibration.enabled) {
      for (const anno of layout.annotations) {
        anno.hovertext += layout.xaxis.ticksuffix;
      }
    }

    //setTimeout(Plotly[update ? 'react' : 'newPlot'], 1, this.plotDiv, data, layout, config); // Make plot update async
    Plotly[update ? 'react' : 'newPlot'](this.plotDiv, data, layout, config);
  }
}
