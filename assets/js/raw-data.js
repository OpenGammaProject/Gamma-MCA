/* File String in CSV format -> Array */

class RawData {
  constructor(valueIndex, delimiter = ',') {
    this.valueIndex = valueIndex;
    this.delimiter = delimiter;

    this.adcChannels = 4096; // For OSC
    this.fileType = valueIndex;
    this.tempValIndex = valueIndex;
  }

  checkLines(value) {
    const values = value.split(this.delimiter);

    if (values.length == 1){ // Work-Around for files with only one column
      this.tempValIndex = 0;
    }

    return values.length > this.tempValIndex;
  }

  parseLines(value) {
    const values = value.split(this.delimiter);
    return parseFloat(values[this.tempValIndex].trim());
  }

  histConverter(dataArr) {
    if (this.fileType == 1) {
      return dataArr;
    }

    let xArray = Array(this.adcChannels).fill(0);

    for(const element of dataArr) {
      xArray[element] += 1;
    }
    return xArray;
  }

  csvToArray(data) {
    this.tempValIndex = this.valueIndex; // RESET VALUE INDEX

    const allLines = data.split('\n');

    const dataLines = allLines.filter(this.checkLines, this);
    const cleanData = dataLines.map(this.parseLines, this);

    return this.histConverter(cleanData);
  }
}
