/*

  File String in CSV, XML, TKA, ... format -> Array

  Gamma MCA: free, open-source web-MCA for gamma spectroscopy
  2022, NuclearPhoenix.- Phoenix1747
  https://nuclearphoenix.xyz

*/

import { coeffObj } from './plot.js';

export class RawData {
  valueIndex: number;
  delimiter: string;
  adcChannels: number;
  fileType: number;
  private tempValIndex: number;

  constructor(valueIndex: number, delimiter = ',') {
    this.valueIndex = valueIndex;
    this.delimiter = delimiter;

    this.adcChannels = 4096; // For OSC
    this.fileType = valueIndex;
    this.tempValIndex = valueIndex;
  }

  checkLines(value: string): boolean {
    const values = value.split(this.delimiter);

    const testParseFirst = parseFloat(values[0].trim());
    if (isNaN(testParseFirst)) {
      return false;
    }

    if (values.length === 1){ // Work-Around for files with only one column
      this.tempValIndex = 0;
    }

    return values.length > this.tempValIndex;
  }

  parseLines(value: string): number {
    const values = value.split(this.delimiter);
    return parseFloat(values[this.tempValIndex].trim());
  }

  histConverter(dataArr: number[]): number[] {
    if (this.fileType === 1) {
      return dataArr;
    }

    let xArray: number[] = Array(this.adcChannels).fill(0);

    for(const element of dataArr) {
      xArray[element] += 1;
    }
    return xArray;
  }

  csvToArray(data: string): number[] {
    this.tempValIndex = this.valueIndex; // RESET VALUE INDEX

    const allLines = data.split('\n');

    const dataLines = allLines.filter(this.checkLines, this);
    const cleanData = dataLines.map(this.parseLines, this);

    return this.histConverter(cleanData);
  }

  xmlToArray(data: string): {espectrum: number[], bgspectrum: number[], coeff: coeffObj} {
    const coeff: coeffObj = {
      c1: 0,
      c2: 0,
      c3: 0
    };

    try {
      const parser = new DOMParser();
      let xmlDoc = parser.parseFromString(data, 'text/xml');
      const espec = xmlDoc.getElementsByTagName('EnergySpectrum')[0].getElementsByTagName('DataPoint');
      const bgspec = xmlDoc.getElementsByTagName('BackgroundEnergySpectrum')[0].getElementsByTagName('DataPoint');
      const calCoeffs = xmlDoc.getElementsByTagName('EnergySpectrum')[0].getElementsByTagName('Coefficient');

      const especArray = Array.from(espec);
      const bgspecArray = Array.from(bgspec);
      const calCoeffsArray = Array.from(calCoeffs);

      const espectrum = this.histConverter(especArray.map(item => {
        if (item.textContent === null) {
          return -1;
        }
        return parseFloat(item.textContent);
      }));
      const bgspectrum = this.histConverter(bgspecArray.map(item => {
        if (item.textContent === null) {
          return -1;
        }
        return parseFloat(item.textContent);
      }));

      const coeffNumArray = calCoeffsArray.map(item => {
        if (item.textContent === null) {
          return 0;
        }
        return parseFloat(item.textContent);
      });

      for (const i in coeffNumArray) {
        coeff['c' + (parseInt(i) + 1).toString()] = coeffNumArray[2 - parseInt(i)];
      }

      return {espectrum, bgspectrum, coeff};
    } catch (e) {
      return {espectrum: [], bgspectrum: [], coeff};
    }
  }
}