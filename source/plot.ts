/*

  Plot spectra using Plotly JS and do some filtering + statistics.

  Gamma MCA: free, open-source web-MCA for gamma spectroscopy
  2022, NuclearPhoenix.- Phoenix1747
  https://nuclearphoenix.xyz

*/

import PolynomialRegression from './external/regression/PolynomialRegression.min.js';
import { SpectrumData, IsotopeList } from './main.js';

export interface CoeffObj {
  c1: number,
  c2: number,
  c3: number,
  [index: string]: number
}

export type PeakModes = 'gaussian' | 'energy' | 'isotopes' | undefined;
export type DownloadFormat = 'svg' | 'png' | 'jpeg' | 'webp';

type ChartType = 'default' | 'evolution' | 'calibration';

interface LegacyIsotopeList {
  [key: number]: string | undefined
}

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
  line: {
      color: string;
      width: number;
      dash: string;
  };
  opacity?: number;
}

interface Anno {
  x: number;
  y: number;
  xref: string;
  yref: string;
  text: string;
  showarrow: boolean;
  arrowhead: number;
  arrowcolor?: string;
  ax: number;
  ay: number;
  editable?: boolean;
  arrowsize?: number;
  hovertext: string;
  font: {
    size: number;
  };
  bgcolor?: string;
}

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
  type: 'scatter',
  yaxis?: string,
  mode: 'lines' | 'markers' | 'lines+markers' | 'text+markers',
  fill?: string,
  opacity?: number,
  line?: {
    color?: string,
    width?: number,
    shape?: 'linear' | 'hvh' | 'spline'
  },
  marker?: {
    color?: string,
    size?: number,
    symbol?: string
  },
  width?: number,
  text?: string[],
  textposition?: string,
}

/*
  Seek the closest matching isotope by energy from an isotope list
*/
export class SeekClosest {
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

      const avgLeft = (energyLeft + this.calibratedBins[binLeft + 1]) / 2;
      const fwhmPartLeft = peakEnergy - avgLeft;

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

      const avgRight = (energyRight + this.calibratedBins[binRight - 1]) / 2;
      const fwhmPartRight = avgRight - peakEnergy;
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
  isotopeSeeker: SeekClosest | undefined;
  peakConfig = {
    enabled: false,
    mode: <PeakModes>undefined, // Gaussian Correlation: 0, Energy: 1 and Isotope: 2 modes
    thres: 0.005,
    lag: 50,
    seekWidth: 2,
    showFWHM: true,
    newPeakStyle: true,
    lines: <number[]>[]
  };
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
  async computeCoefficients(): Promise<void> {
    const data = [
      {
        x: this.calibration.points.aFrom,
        y: this.calibration.points.aTo
      },
      {
        x: this.calibration.points.bFrom,
        y: this.calibration.points.bTo
      }
    ];

    if (this.calibration.points.cFrom && this.calibration.points.cTo) {
      data.push({
        x: this.calibration.points.cFrom,
        y: this.calibration.points.cTo
      })
    }

    const model = PolynomialRegression.read(data, data.length - 1); // Linear if only 2 points, else quadratic
    const terms = model.getTerms();
    
    this.calibration.coeff.c1 = terms[2] ?? 0; // Reverse order, fallback 0 if only linear
    this.calibration.coeff.c2 = terms[1];
    this.calibration.coeff.c3 = terms[0];
  }
  /*
    Get the calibrated x-axis using the values in this.calibration
  */
  getCalAxis(len: number): number[] {
    const calArray: number[] = [];

    const a = this.calibration.coeff.c1;
    const k = this.calibration.coeff.c2;
    const d = this.calibration.coeff.c3;

    for (let i = 0; i < len; i++) {
      calArray.push(a * i**2 + k * i + d); // x1000 to convert keV to eV for the plot
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
  peakFinder(xAxis: number[], yAxis: number[], heightAxis: number[]): void {
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

      if (Math.abs(peakLines[i + 1] - peakLines[i]) > 2) { // Check if adjacent bins, i.e. one connected peak
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

        const resultBin = Math.round(result);
        const height = heightAxis[resultBin];
        if (this.calibration.enabled) result = this.getCalAxis(xAxis.length)[resultBin];

        if (height >= 0) {
          if (this.peakConfig.mode === 'energy') {
            this.toggleLine(result, Math.round(result).toString(), true, height);
            this.peakConfig.lines.push(result);
          } else if (this.peakConfig.mode === 'isotopes') { // Isotope Mode
            if (!this.isotopeSeeker) throw 'No isotope seeker found!';
  
            const { energy, name } = this.isotopeSeeker.seek(result, size);
            if (energy && name) {
              this.toggleLine(energy, name, true, height);
              this.peakConfig.lines.push(energy);
            }
          }
        }

        values = [];
      }
    }
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
          width: 0.8,
          dash: 'dot'
        },
        opacity: 0.66
      };
      const newAnno: Anno = {
        x: energy,
        y: 1,
        xref: 'x',
        yref: 'paper',
        text: name,
        showarrow: true,
        arrowcolor: this.darkMode ? this.fontColorDark : this.fontColorLight,
        arrowhead: 7,
        ax: 0,
        ay: -20,
        editable: false,
        hovertext: energy.toFixed(2),
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

        newAnno.y = height * 1.03;
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
        if (this.annotations[i].x === energy) this.annotations.splice(parseInt(i),1);
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
    Plot Radiation Evolution Chart
  */
  private plotEvolution(cpsValues: number[], update: boolean): void {
    const trace: Trace = {
      name: 'Radiation Evolution',
      x: this.getXAxis(cpsValues.length),
      y: cpsValues,
      mode: 'lines+markers', // Remove lines, "lines", "none"
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
      x: this.getXAxis(cpsValues.length),
      y: this.computeMovingAverage(cpsValues),
      mode: 'lines', // Remove lines, "lines", "none"
      type: 'scatter',
      //fill: 'tozeroy',
      //opacity: 0.8,
      line: {
        color: 'darkblue',
        width: 2,
        shape: 'spline'
      }
    };

    const layout = {
      uirevision: 1,
      autosize: true, // Needed for resizing on update
      title: 'Radiation Evolution',
      hovermode: 'x',
      legend: {
        orientation: 'h',
        y: -0.35,
      },
      xaxis: {
        title: 'Measurement Point [1]',
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
        title: 'Counts Per Second [s<sup>-1</sup>]',
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
      annotations: <Anno[]>[]
    };

    const config = {
      responsive: true,
      scrollZoom: false,
      //displayModeBar: true,
      displaylogo: false,
      toImageButtonOptions: {
        format: this.downloadFormat,
        filename: 'gamma_mca_evolution',
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

    (<any>window).Plotly[update ? 'react' : 'newPlot'](this.plotDiv, [trace, averageTrace], layout, config);
  }
  /*
    Plot Calibration Chart
  */
  private plotCalibration(dataObj: SpectrumData, update: boolean): void {
    const trace: Trace = {
      name: 'Calibration',
      x: this.getXAxis(dataObj.data.length),
      y: this.getCalAxis(dataObj.data.length),
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
            markersTrace.text?.push('Point ' + (parseInt(index)+1).toString());
          }
        }
      }
    }

    const layout = {
      uirevision: 1,
      autosize: true, // Needed for resizing on update
      title: 'Calibration',
      hovermode: 'x',
      legend: {
        orientation: 'h',
        y: -0.35,
      },
      xaxis: {
        title: 'Bin [1]',
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
        title: 'Energy [keV]',
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
    if (this.type !== 'default') return; // Ignore this if the calibration chart is currently shown

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
        title: 'Bin [1]',
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
        title: 'Counts [1]',
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
      CPS enabled
    */
    if (this.cps) {
      if (Math.max(...data[0].y) < 1) { // Less than 1 cps at max, switch to cpm
        for (const trace of data) {
          trace.y = trace.y.map(value => value * 60);
        }
        layout.yaxis.title = 'Counts Per Minute [60 s<sup>-1</sup>]';
        layout.yaxis.ticksuffix = 'cpm';
      } else { // Enough counts for cpm
        layout.yaxis.title = 'Counts Per Second [s<sup>-1</sup>]';
        layout.yaxis.ticksuffix = 'cps';
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

      this.peakFinder(this.getXAxis(gaussData.length), gaussData, data[0].y);

      if (this.peakConfig.showFWHM) {
        const peakResolutions = new CalculateFWHM(this.peakConfig.lines, data[0].x, data[0].y).getResolution();
        
        for (const anno of this.annotations) {
          const fwhmValue = peakResolutions[anno.x];
          
          if (fwhmValue > 0 && fwhmValue < 0.9 * CalculateFWHM.resolutionLimit) anno.text += `<br>${(fwhmValue * 100).toFixed(1)}%`;
        }
      }

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
